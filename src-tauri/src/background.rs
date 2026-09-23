use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use async_imap::extensions::idle::IdleResponse;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tokio::{
    sync::{watch, Semaphore},
    task::JoinHandle,
    time,
};

use crate::{
    client_log,
    commands::data::sync::publish_sync_result,
    db,
    mail::{sync, transport},
    state::AppState,
};

const INBOX_POLL: Duration = Duration::from_secs(60);
const FOLDER_POLL: Duration = Duration::from_secs(2 * 60);
const IDLE_RECONNECT: Duration = Duration::from_secs(25 * 60);
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const IMAP_SETUP_TIMEOUT: Duration = Duration::from_secs(30);
const IMAP_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

pub struct BackgroundWake(watch::Sender<u64>);

pub fn start(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, "show", "显示 OneMail", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出 OneMail", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|error| error.to_string())?;
    let mut tray = TrayIconBuilder::with_id("onemail")
        .menu(&menu)
        .tooltip("OneMail")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(|error| error.to_string())?;

    let (sender, receiver) = watch::channel(0_u64);
    app.manage(BackgroundWake(sender));
    tauri::async_runtime::spawn(supervise(app.clone(), receiver));
    Ok(())
}

pub fn wake(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundWake>() {
        let next = state.0.borrow().wrapping_add(1);
        let _ = state.0.send(next);
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

async fn supervise(app: AppHandle, mut wake: watch::Receiver<u64>) {
    let mut workers: HashMap<i64, JoinHandle<()>> = HashMap::new();
    let sync_slots = Arc::new(Semaphore::new(4));
    loop {
        match account_ids(&app) {
            Ok(ids) => {
                workers.retain(|account_id, handle| {
                    if ids.contains(account_id) && !handle.is_finished() {
                        true
                    } else {
                        handle.abort();
                        false
                    }
                });
                for account_id in ids {
                    workers.entry(account_id).or_insert_with(|| {
                        tokio::spawn(run_account(
                            app.clone(),
                            account_id,
                            wake.clone(),
                            sync_slots.clone(),
                        ))
                    });
                }
            }
            Err(error) => eprintln!("OneMail 后台读取账号失败：{error}"),
        }
        tokio::select! {
            _ = time::sleep(DISCOVERY_INTERVAL) => {},
            changed = wake.changed() => { if changed.is_err() { break; } },
        }
    }
    for handle in workers.into_values() {
        handle.abort();
    }
}

fn account_ids(app: &AppHandle) -> Result<Vec<i64>, String> {
    let state = app.state::<AppState>();
    let connection = db::open(&state)?;
    let enabled = connection.query_row(
        "SELECT setting_value FROM onemail_app_settings WHERE setting_key='sync_interval_minutes'",
        [],
        |row| row.get::<_, String>(0),
    ).optional().map_err(|error| error.to_string())?;
    if enabled
        .as_deref()
        .unwrap_or("15")
        .parse::<i64>()
        .unwrap_or(15)
        <= 0
    {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "SELECT account_id FROM onemail_mail_accounts WHERE sync_enabled=1 AND status <> 'disabled' AND connection_state <> 'reauthorize' AND (status <> 'auth_error' OR (auth_type='oauth2' AND lower(coalesce(last_error,'')) LIKE '%authenticated but not connected%')) ORDER BY sort_order,account_id",
    ).map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ids)
}

fn reconciliation_interval(app: &AppHandle) -> Duration {
    let state = app.state::<AppState>();
    db::open(&state).ok().and_then(|connection| {
        connection.query_row(
            "SELECT setting_value FROM onemail_app_settings WHERE setting_key='sync_interval_minutes'",
            [],
            |row| row.get::<_, String>(0),
        ).optional().ok().flatten()
    }).and_then(|value| value.parse::<u64>().ok())
      .map(|minutes| Duration::from_secs(minutes.clamp(1, 24 * 60) * 60))
      .unwrap_or(Duration::from_secs(15 * 60))
}

fn never_synced(app: &AppHandle, account_id: i64) -> bool {
    let state = app.state::<AppState>();
    db::open(&state)
        .ok()
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT last_sync_at FROM onemail_mail_accounts WHERE account_id=?1",
                    [account_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .ok()
                .flatten()
        })
        .flatten()
        .is_none()
}

async fn run_account(
    app: AppHandle,
    account_id: i64,
    mut wake: watch::Receiver<u64>,
    sync_slots: Arc<Semaphore>,
) {
    time::sleep(Duration::from_secs(account_id.rem_euclid(11) as u64)).await;
    let mut backoff = Duration::from_secs(5);
    let mut next_full = Instant::now();
    let mut next_folders = Instant::now() + FOLDER_POLL;
    loop {
        // Reconcile before opening IDLE, including after network or system resume.
        if Instant::now() >= next_full {
            let initial = never_synced(&app, account_id);
            if !initial {
                run_sync(&app, account_id, "background-inbox", "poll", &sync_slots).await;
            }
            let mode = if initial { "initial" } else { "background" };
            if !run_sync(&app, account_id, mode, "poll", &sync_slots).await {
                tokio::select! {
                    _ = time::sleep(backoff) => {},
                    changed = wake.changed() => { if changed.is_err() { break; } },
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
            next_full = Instant::now() + reconciliation_interval(&app);
            next_folders = Instant::now() + FOLDER_POLL;
        } else {
            run_sync(&app, account_id, "background-inbox", "poll", &sync_slots).await;
            run_due_folder_sync(&app, account_id, &mut next_folders, &sync_slots).await;
        }
        backoff = Duration::from_secs(5);

        let state = app.state::<AppState>();
        let account = match transport::load_account(&state, account_id) {
            Ok(account) => account,
            Err(error) => {
                eprintln!("OneMail 后台加载账号 {account_id} 失败：{error}");
                break;
            }
        };
        let connect_started = Instant::now();
        let mut session = match time::timeout(
            IMAP_SETUP_TIMEOUT,
            transport::connect_authenticated(&state, &account),
        )
        .await
        {
            Ok(Ok(session)) => session,
            failed => {
                let error = match failed {
                    Ok(Err(error)) => error,
                    Err(_) => "IMAP 监控连接超时".to_owned(),
                    Ok(Ok(_)) => unreachable!(),
                };
                eprintln!("OneMail 后台 IMAP 连接 {account_id} 失败：{error}");
                tokio::select! {
                    _ = time::sleep(INBOX_POLL.saturating_sub(connect_started.elapsed())) => {},
                    changed = wake.changed() => { if changed.is_err() { break; } next_full = Instant::now(); },
                }
                continue;
            }
        };
        let supports_idle = match time::timeout(IMAP_COMMAND_TIMEOUT, session.capabilities()).await
        {
            Ok(Ok(capabilities)) => capabilities.has_str("IDLE"),
            _ => false,
        };
        if supports_idle
            && !matches!(
                time::timeout(IMAP_COMMAND_TIMEOUT, session.select("INBOX")).await,
                Ok(Ok(_))
            )
        {
            time::sleep(backoff).await;
            backoff = (backoff * 2).min(MAX_BACKOFF);
            continue;
        }
        if !supports_idle {
            let _ = time::timeout(IMAP_COMMAND_TIMEOUT, session.logout()).await;
            let mut next_poll = Instant::now() + INBOX_POLL;
            loop {
                tokio::select! {
                    _ = time::sleep(next_poll.saturating_duration_since(Instant::now())) => {},
                    changed = wake.changed() => { if changed.is_err() { return; } next_full = Instant::now(); break; },
                }
                if Instant::now() >= next_full {
                    break;
                }
                let poll_started = Instant::now();
                run_sync(&app, account_id, "background-inbox", "poll", &sync_slots).await;
                run_due_folder_sync(&app, account_id, &mut next_folders, &sync_slots).await;
                next_poll = poll_started + INBOX_POLL;
            }
            continue;
        }
        let mut session = Some(session);
        let connected_at = Instant::now();
        loop {
            if Instant::now() >= next_full || connected_at.elapsed() >= IDLE_RECONNECT {
                break;
            }
            let mut reason = "poll";
            let mut idle = session.take().expect("IDLE session missing").idle();
            if !matches!(
                time::timeout(IMAP_COMMAND_TIMEOUT, idle.init()).await,
                Ok(Ok(()))
            ) {
                break;
            }
            let (wait, _) = idle.wait_with_timeout(INBOX_POLL);
            let result = tokio::select! {
                result = time::timeout(INBOX_POLL, wait) => Some(result),
                changed = wake.changed() => { if changed.is_err() { return; } None },
            };
            session = match time::timeout(IMAP_COMMAND_TIMEOUT, idle.done()).await {
                Ok(Ok(session)) => Some(session),
                _ => break,
            };
            if result.is_none() {
                next_full = Instant::now();
                break;
            }
            if matches!(result.as_ref(), Some(Ok(Ok(IdleResponse::NewData(_))))) {
                reason = "idle";
            }
            match result.unwrap() {
                Ok(Ok(IdleResponse::NewData(_))) | Ok(Ok(IdleResponse::Timeout)) | Err(_) => {}
                _ => break,
            }
            if Instant::now() >= next_full {
                break;
            }
            run_sync(&app, account_id, "background-inbox", reason, &sync_slots).await;
            run_due_folder_sync(&app, account_id, &mut next_folders, &sync_slots).await;
        }
        // A fresh connection and a full sync recover missed IDLE events and sleep gaps.
        if let Some(mut session) = session {
            let _ = time::timeout(IMAP_COMMAND_TIMEOUT, session.logout()).await;
        }
        if connected_at.elapsed() < IDLE_RECONNECT && Instant::now() < next_full {
            tokio::select! {
                _ = time::sleep(backoff) => {},
                changed = wake.changed() => { if changed.is_err() { return; } next_full = Instant::now(); },
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    }
}

async fn run_due_folder_sync(
    app: &AppHandle,
    account_id: i64,
    next_folders: &mut Instant,
    sync_slots: &Semaphore,
) {
    if Instant::now() < *next_folders {
        return;
    }
    *next_folders = Instant::now() + FOLDER_POLL;
    let state = app.state::<AppState>();
    let Ok(connection) = db::open(&state) else {
        return;
    };
    let has_other_folders = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM onemail_mail_folders WHERE account_id=?1 AND sync_enabled=1 AND is_selectable=1 AND upper(path)<>'INBOX')",
            [account_id],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if has_other_folders {
        run_sync(
            app,
            account_id,
            "background-other-folders",
            "poll",
            sync_slots,
        )
        .await;
    }
}

async fn run_sync(
    app: &AppHandle,
    account_id: i64,
    mode: &str,
    reason: &str,
    sync_slots: &Semaphore,
) -> bool {
    let Ok(_slot) = sync_slots.acquire().await else {
        return false;
    };
    let state = app.state::<AppState>();
    let result = match sync::sync_account(&state, account_id, Some(mode), None).await {
        Ok(value) => value,
        Err(error) => json!({ "accountId": account_id, "ok": false, "error": error }),
    };
    let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if !ok && result.get("skipped").and_then(Value::as_bool) != Some(true) {
        let _ = client_log::write(app, &format!("WARN Background sync account {account_id} failed ({mode})"));
    }
    publish_sync_result(app, &result, Some(mode), reason);
    ok || result
        .get("skipped")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}
