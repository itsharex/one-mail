use std::{
    collections::{BTreeMap, VecDeque},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::client_log;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRequest {
    id: u64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<i64>,
    started_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    revision: u64,
    requests: Vec<NetworkRequest>,
    recent: Vec<CompletedNetworkRequest>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedNetworkRequest {
    id: u64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<i64>,
    started_at: u64,
    finished_at: u64,
    duration_ms: u64,
}

#[derive(Default)]
struct ActivityState {
    revision: u64,
    next_id: u64,
    requests: BTreeMap<u64, NetworkRequest>,
    recent: VecDeque<CompletedNetworkRequest>,
}

pub struct NetworkActivity {
    app: AppHandle,
    state: Mutex<ActivityState>,
}

impl NetworkActivity {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            state: Mutex::new(ActivityState::default()),
        }
    }

    pub fn snapshot(&self) -> NetworkSnapshot {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        NetworkSnapshot {
            revision: state.revision,
            requests: state.requests.values().cloned().collect(),
            recent: state.recent.iter().rev().cloned().collect(),
        }
    }

    pub fn begin(&self, kind: &'static str) -> NetworkActivityGuard<'_> {
        self.begin_request(kind, None)
    }

    pub fn begin_for_account(
        &self,
        kind: &'static str,
        account_id: i64,
    ) -> NetworkActivityGuard<'_> {
        self.begin_request(kind, Some(account_id))
    }

    fn begin_request(
        &self,
        kind: &'static str,
        account_id: Option<i64>,
    ) -> NetworkActivityGuard<'_> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.next_id = state.next_id.wrapping_add(1);
        let id = state.next_id;
        state.requests.insert(
            id,
            NetworkRequest {
                id,
                kind,
                account_id,
                started_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            },
        );
        state.revision = state.revision.wrapping_add(1);
        drop(state);
        self.publish();
        NetworkActivityGuard { activity: self, id }
    }

    fn finish(&self, id: u64) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let finished = state.requests.remove(&id);
        let finished_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if let Some(request) = &finished {
            if request.kind != "icon" {
                state.recent.push_back(CompletedNetworkRequest {
                    id: request.id,
                    kind: request.kind,
                    account_id: request.account_id,
                    started_at: request.started_at,
                    finished_at,
                    duration_ms: finished_at.saturating_sub(request.started_at),
                });
                if state.recent.len() > 20 {
                    state.recent.pop_front();
                }
            }
        }
        state.revision = state.revision.wrapping_add(1);
        drop(state);
        self.publish();
        if let Some(request) = finished {
            let duration_ms = finished_at.saturating_sub(request.started_at);
            let account_id = request.account_id.map_or("-".to_string(), |id| id.to_string());
            let _ = client_log::write(&self.app, &format!(
                "INFO Network request finished kind={} account_id={account_id} duration_ms={duration_ms}",
                request.kind,
            ));
        }
    }

    fn publish(&self) {
        let _ = self.app.emit("network/activity", self.snapshot());
    }
}

pub struct NetworkActivityGuard<'a> {
    activity: &'a NetworkActivity,
    id: u64,
}

impl Drop for NetworkActivityGuard<'_> {
    fn drop(&mut self) {
        self.activity.finish(self.id);
    }
}
