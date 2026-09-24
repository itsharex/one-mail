use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use async_imap::extensions::idle::IdleResponse;
use chrono::{DateTime, Utc};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
#[cfg(target_os = "windows")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tokio::{
    sync::{watch, Semaphore},
    task::JoinHandle,
    time,
};

use crate::{
    client_log,
    commands::{
        data::sync::{publish_sync_result, sync_start_all},
        system,
    },
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
static PENDING_COMPOSE: AtomicBool = AtomicBool::new(false);

pub struct BackgroundWake(watch::Sender<u64>);

pub fn start(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, "toggle", "显示/隐藏 OneMail", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let compose = MenuItem::with_id(app, "compose", "写邮件", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let sync_all = MenuItem::with_id(app, "sync_all", "立即同步全部邮箱", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出 OneMail", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &compose, &sync_all, &settings, &separator, &quit])
        .map_err(|error| error.to_string())?;
    let sync_menu_item = sync_all.clone();
    let mut tray = TrayIconBuilder::with_id("onemail")
        .menu(&menu)
        .tooltip("OneMail")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            "compose" => {
                PENDING_COMPOSE.store(true, Ordering::Release);
                show_main_window(app);
                if let Err(error) = app.emit_to("main", "tray/compose", ()) {
                    eprintln!("OneMail 托盘打开写信窗口失败：{error}");
                }
            }
            "sync_all" => {
                let app = app.clone();
                let sync_menu_item = sync_menu_item.clone();
                let _ = sync_menu_item.set_enabled(false);
                let _ = sync_menu_item.set_text("正在同步邮箱…");
                tauri::async_runtime::spawn(async move {
                    if let Some(tray) = app.tray_by_id("onemail") {
                        let _ = tray.set_tooltip(Some("OneMail · 正在同步邮箱"));
                    }
                    let state = app.state::<AppState>();
                    let tooltip = match sync_start_all(app.clone(), state, Some("refresh".to_string())).await {
                        Ok(result) => {
                            let failed = result["accounts"].as_array().map_or(0, |accounts| {
                                accounts.iter().filter(|account| account["ok"] != true).count()
                            });
                            if failed == 0 {
                                "OneMail · 同步完成".to_string()
                            } else {
                                format!("OneMail · {failed} 个邮箱未同步")
                            }
                        }
                        Err(error) => {
                            eprintln!("OneMail 托盘同步邮箱失败：{error}");
                            "OneMail · 同步失败".to_string()
                        }
                    };
                    if let Some(tray) = app.tray_by_id("onemail") {
                        let _ = tray.set_tooltip(Some(tooltip));
                    }
                    let _ = sync_menu_item.set_text("立即同步全部邮箱");
                    let _ = sync_menu_item.set_enabled(true);
                });
            }
            "settings" => {
                if let Err(error) = system::settings_open_window(app.clone(), Some("general".to_string())) {
                    eprintln!("OneMail 托盘打开设置失败：{error}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    #[cfg(target_os = "macos")]
    {
        tray = tray
            .icon(tauri::include_image!("./icons/tray-macos.png"))
            .icon_as_template(true);
    }
    #[cfg(target_os = "windows")]
    {
        let scale = app.get_webview_window("main")
            .and_then(|window| window.scale_factor().ok())
            .unwrap_or(1.0);
        let icon = if scale >= 1.5 {
            tauri::include_image!("./icons/tray-windows-32.png")
        } else {
            tauri::include_image!("./icons/tray-windows-16.png")
        };
        tray = tray.icon(icon)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if matches!(event, TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }) {
                    show_main_window(tray.app_handle());
                }
            });
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(|error| error.to_string())?;

    let (sender, receiver) = watch::channel(0_u64);
    app.manage(BackgroundWake(sender));
    tauri::async_runtime::spawn(supervise(app.clone(), receiver));
    Ok(())
}

#[tauri::command]
pub fn tray_take_compose_request() -> bool {
    PENDING_COMPOSE.swap(false, Ordering::AcqRel)
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

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
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

fn reconciliation_delay(last_sync_at: Option<&str>, interval: Duration, now: DateTime<Utc>) -> Duration {
    let Some(last_sync_at) = last_sync_at.and_then(|value| DateTime::parse_from_rfc3339(value).ok()) else {
        return Duration::ZERO;
    };
    let elapsed = now.signed_duration_since(last_sync_at.with_timezone(&Utc))
        .to_std()
        .unwrap_or_default();
    interval.saturating_sub(elapsed)
}

fn next_reconciliation(app: &AppHandle, account_id: i64) -> Instant {
    let last = last_sync_at(app, account_id);
    Instant::now() + reconciliation_delay(last.as_deref(), reconciliation_interval(app), Utc::now())
}

fn last_sync_at(app: &AppHandle, account_id: i64) -> Option<String> {
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
}

fn never_synced(app: &AppHandle, account_id: i64) -> bool {
    last_sync_at(app, account_id).is_none()
}

async fn run_account(
    app: AppHandle,
    account_id: i64,
    mut wake: watch::Receiver<u64>,
    sync_slots: Arc<Semaphore>,
) {
    time::sleep(Duration::from_secs(account_id.rem_euclid(11) as u64)).await;
    let mut backoff = Duration::from_secs(5);
    let mut next_full = next_reconciliation(&app, account_id);
    let mut next_folders = Instant::now() + FOLDER_POLL;
    let mut check_inbox = false; // Reuse recent local mail on startup and wake.
    loop {
        // Reconcile before opening IDLE, including after network or system resume.
        if Instant::now() >= next_full {
            let initial = never_synced(&app, account_id);
            let mode = if initial { "initial" } else { "background" };
            if !run_sync(&app, account_id, mode, "poll", &sync_slots).await {
                tokio::select! {
                    _ = time::sleep(backoff) => {},
                    changed = wake.changed() => { if changed.is_err() { break; } next_full = next_reconciliation(&app, account_id); },
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
            next_full = Instant::now() + reconciliation_interval(&app);
            next_folders = Instant::now() + FOLDER_POLL;
        } else if check_inbox {
            run_sync(&app, account_id, "background-inbox", "poll", &sync_slots).await;
            run_due_folder_sync(&app, account_id, &mut next_folders, &sync_slots).await;
        }
        check_inbox = true;
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
        let _network_request = state.network_activity.begin_for_account("imap-monitor", account_id);
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
                check_inbox = false;
                tokio::select! {
                    _ = time::sleep(INBOX_POLL.saturating_sub(connect_started.elapsed())) => {},
                    changed = wake.changed() => { if changed.is_err() { break; } next_full = next_reconciliation(&app, account_id); },
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
        drop(_network_request);
        if !supports_idle {
            let _ = time::timeout(IMAP_COMMAND_TIMEOUT, session.logout()).await;
            let mut next_poll = Instant::now() + INBOX_POLL;
            loop {
                tokio::select! {
                    _ = time::sleep(next_poll.saturating_duration_since(Instant::now())) => {},
                    changed = wake.changed() => { if changed.is_err() { return; } next_full = next_reconciliation(&app, account_id); check_inbox = false; break; },
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
                next_full = next_reconciliation(&app, account_id);
                check_inbox = false;
                break;
            }
            let has_changes = matches!(result.as_ref(), Some(Ok(Ok(IdleResponse::NewData(_)))));
            match result.unwrap() {
                Ok(Ok(IdleResponse::NewData(_))) | Ok(Ok(IdleResponse::Timeout)) | Err(_) => {}
                _ => break,
            }
            if Instant::now() >= next_full {
                break;
            }
            if has_changes {
                run_sync(&app, account_id, "background-inbox", "idle", &sync_slots).await;
            }
            run_due_folder_sync(&app, account_id, &mut next_folders, &sync_slots).await;
        }
        // A fresh connection and a full sync recover missed IDLE events and sleep gaps.
        if let Some(mut session) = session {
            let _ = time::timeout(IMAP_COMMAND_TIMEOUT, session.logout()).await;
        }
        if connected_at.elapsed() < IDLE_RECONNECT && Instant::now() < next_full {
            tokio::select! {
                _ = time::sleep(backoff) => {},
                changed = wake.changed() => { if changed.is_err() { return; } next_full = next_reconciliation(&app, account_id); check_inbox = false; },
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
    let skipped = result.get("skipped").and_then(Value::as_bool) == Some(true);
    let (level, outcome) = if skipped { ("INFO", "skipped") } else if ok { ("INFO", "complete") } else { ("WARN", "failed") };
    let _ = client_log::write(app, &format!("{level} Background sync account {account_id} {outcome} mode={mode} reason={reason}"));
    publish_sync_result(app, &result, Some(mode), reason);
    let _ = app.emit("sync/backgroundResult", json!({
        "accountId": account_id,
        "ok": ok,
        "skipped": skipped,
    }));
    ok || skipped
}

#[cfg(test)]
mod tests {
    use super::reconciliation_delay;
    use chrono::{DateTime, Utc};
    use std::time::Duration;

    #[test]
    fn recent_sync_uses_cached_data_until_interval_expires() {
        let now = DateTime::parse_from_rfc3339("2026-09-24T12:15:00Z").unwrap().with_timezone(&Utc);
        let interval = Duration::from_secs(15 * 60);
        assert_eq!(reconciliation_delay(Some("2026-09-24T12:10:00.000Z"), interval, now), Duration::from_secs(10 * 60));
        assert_eq!(reconciliation_delay(Some("2026-09-24T12:00:00Z"), interval, now), Duration::ZERO);
    }

    #[test]
    fn missing_or_invalid_sync_time_is_due_now() {
        let now = DateTime::parse_from_rfc3339("2026-09-24T12:15:00Z").unwrap().with_timezone(&Utc);
        let interval = Duration::from_secs(15 * 60);
        assert_eq!(reconciliation_delay(None, interval, now), Duration::ZERO);
        assert_eq!(reconciliation_delay(Some("invalid"), interval, now), Duration::ZERO);
        assert_eq!(reconciliation_delay(Some("2026-09-24T12:20:00Z"), interval, now), interval);
    }
}
