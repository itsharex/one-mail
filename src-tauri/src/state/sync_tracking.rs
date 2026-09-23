use std::{collections::HashSet, sync::Mutex};
use serde_json::Value;
use tokio::sync::{watch, Semaphore, SemaphorePermit};

pub const SYNC_CONCURRENCY: usize = 4;

pub struct SyncTracker {
    active: Mutex<HashSet<i64>>,
    slots: Semaphore,
    changed: watch::Sender<u64>,
}

impl Default for SyncTracker {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashSet::new()),
            slots: Semaphore::new(SYNC_CONCURRENCY),
            changed: watch::channel(0).0,
        }
    }
}

impl SyncTracker {
    pub async fn acquire_slot(&self) -> Result<SemaphorePermit<'_>, String> {
        self.slots.acquire().await.map_err(|_| "同步队列已关闭。".to_string())
    }

    pub fn start(&self, account_id: i64) -> Result<Option<SyncGuard<'_>>, String> {
        let mut active = self.active.lock().map_err(|_| "无法获取同步状态锁。")?;
        if !active.insert(account_id) {
            return Ok(None);
        }
        Ok(Some(SyncGuard {
            tracker: self,
            account_id,
        }))
    }

    pub fn account_ids(&self) -> Result<Vec<i64>, String> {
        let active = self.active.lock().map_err(|_| "无法获取同步状态锁。")?;
        let mut ids = active.iter().copied().collect::<Vec<_>>();
        ids.sort_unstable();
        Ok(ids)
    }

    pub async fn wait_until_idle(&self, account_id: i64) -> Result<(), String> {
        let mut changed = self.changed.subscribe();
        loop {
            let is_active = {
                let active = self.active.lock().map_err(|_| "无法获取同步状态锁。")?;
                active.contains(&account_id)
            };
            if !is_active {
                return Ok(());
            }
            changed.changed().await.map_err(|_| "同步状态通道已关闭。".to_string())?;
        }
    }
}

pub struct SyncGuard<'a> {
    tracker: &'a SyncTracker,
    account_id: i64,
}

impl Drop for SyncGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.tracker.active.lock() {
            active.remove(&self.account_id);
            drop(active);
            self.tracker.changed.send_modify(|version| *version = version.wrapping_add(1));
        }
    }
}

type BatchResult = Result<Value, String>;

#[derive(Default)]
pub struct SyncBatchTracker {
    active: Mutex<Option<(Option<String>, watch::Sender<Option<BatchResult>>)>>,
}

pub enum BatchStart<'a> {
    Leader(BatchGuard<'a>),
    Join(watch::Receiver<Option<BatchResult>>),
    WaitOther(watch::Receiver<Option<BatchResult>>),
}

impl SyncBatchTracker {
    pub fn start(&self, mode: Option<&str>) -> Result<BatchStart<'_>, String> {
        let key = mode.map(str::to_owned);
        let mut active = self.active.lock().map_err(|_| "无法获取批次同步状态锁。")?;
        if let Some((active_mode, sender)) = active.as_ref() {
            return Ok(if *active_mode == key {
                BatchStart::Join(sender.subscribe())
            } else {
                BatchStart::WaitOther(sender.subscribe())
            });
        }
        let (sender, _) = watch::channel(None);
        *active = Some((key, sender.clone()));
        Ok(BatchStart::Leader(BatchGuard { tracker: self, sender }))
    }
}

pub struct BatchGuard<'a> {
    tracker: &'a SyncBatchTracker,
    sender: watch::Sender<Option<BatchResult>>,
}

impl BatchGuard<'_> {
    pub fn complete(self, result: BatchResult) {
        self.sender.send_replace(Some(result));
    }
}

impl Drop for BatchGuard<'_> {
    fn drop(&mut self) {
        if self.sender.borrow().is_none() {
            self.sender.send_replace(Some(Err("同步任务已中断。".to_string())));
        }
        if let Ok(mut active) = self.tracker.active.lock() {
            *active = None;
        }
    }
}

pub async fn wait_for_batch(mut receiver: watch::Receiver<Option<BatchResult>>) -> BatchResult {
    loop {
        if let Some(result) = receiver.borrow_and_update().clone() {
            return result;
        }
        receiver.changed().await.map_err(|_| "同步任务已中断。".to_string())?;
    }
}

#[cfg(test)]
mod tests {
    use super::{wait_for_batch, BatchStart, SyncBatchTracker, SyncTracker, SYNC_CONCURRENCY};
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn tracks_active_accounts_and_releases_them_on_drop() {
        let tracker = SyncTracker::default();
        let first = tracker.start(2).unwrap().unwrap();
        let second = tracker.start(1).unwrap().unwrap();
        assert!(tracker.start(2).unwrap().is_none());
        assert_eq!(tracker.account_ids().unwrap(), vec![1, 2]);
        drop(first);
        drop(second);
        assert!(tracker.account_ids().unwrap().is_empty());
        assert!(tracker.start(2).unwrap().is_some());
    }

    #[tokio::test]
    async fn limits_all_sync_callers_to_four_slots() {
        let tracker = SyncTracker::default();
        let mut permits = Vec::new();
        for _ in 0..SYNC_CONCURRENCY {
            permits.push(tracker.acquire_slot().await.unwrap());
        }
        assert!(tokio::time::timeout(Duration::from_millis(20), tracker.acquire_slot()).await.is_err());
        permits.pop();
        assert!(tokio::time::timeout(Duration::from_millis(20), tracker.acquire_slot()).await.is_ok());
    }

    #[tokio::test]
    async fn waiting_for_an_active_account_resumes_on_guard_drop() {
        let tracker = SyncTracker::default();
        let guard = tracker.start(7).unwrap().unwrap();
        let wait = tracker.wait_until_idle(7);
        tokio::pin!(wait);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut wait).await.is_err());
        drop(guard);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut wait).await.is_ok());
    }

    #[tokio::test]
    async fn joins_same_mode_and_serializes_other_modes() {
        let tracker = SyncBatchTracker::default();
        let BatchStart::Leader(leader) = tracker.start(Some("refresh")).unwrap() else {
            panic!("first batch must lead");
        };
        let BatchStart::Join(joined) = tracker.start(Some("refresh")).unwrap() else {
            panic!("same mode must join");
        };
        let BatchStart::WaitOther(other) = tracker.start(Some("initial")).unwrap() else {
            panic!("different mode must wait");
        };
        leader.complete(Ok(json!({"accounts": []})));
        assert_eq!(wait_for_batch(joined).await.unwrap(), json!({"accounts": []}));
        assert_eq!(wait_for_batch(other).await.unwrap(), json!({"accounts": []}));
        assert!(matches!(tracker.start(Some("initial")).unwrap(), BatchStart::Leader(_)));
    }

    #[tokio::test]
    async fn interrupted_leader_wakes_joiners() {
        let tracker = SyncBatchTracker::default();
        let BatchStart::Leader(leader) = tracker.start(None).unwrap() else { panic!() };
        let BatchStart::Join(joined) = tracker.start(None).unwrap() else { panic!() };
        drop(leader);
        assert_eq!(wait_for_batch(joined).await.unwrap_err(), "同步任务已中断。");
        assert!(matches!(tracker.start(None).unwrap(), BatchStart::Leader(_)));
    }
}
