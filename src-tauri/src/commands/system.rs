use std::{path::Path, process::Command};
#[cfg(target_os = "macos")]
use std::{io::{BufRead, BufReader, Write}, process::Stdio};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::state::AppState;

static PENDING_NOTIFICATION_MESSAGE: OnceLock<Mutex<Option<i64>>> = OnceLock::new();
const GMAIL_ICON_URL: &str = "https://upload.wikimedia.org/wikipedia/commons/2/2e/Gmail_2020.png";

fn pending_notification_message() -> &'static Mutex<Option<i64>> {
    PENDING_NOTIFICATION_MESSAGE.get_or_init(|| Mutex::new(None))
}

pub fn message_id_from_args(args: &[String]) -> Option<i64> {
    let index = args.iter().position(|arg| arg == "--open-message")?;
    args.get(index + 1)?.parse::<i64>().ok().filter(|id| *id > 0)
}

#[cfg(test)]
mod notification_tests {
    use super::message_id_from_args;

    #[test]
    fn notification_click_requires_a_positive_message_id() {
        assert_eq!(message_id_from_args(&["onemail".into(), "--open-message".into(), "42".into()]), Some(42));
        assert_eq!(message_id_from_args(&["onemail".into(), "--open-message".into(), "0".into()]), None);
        assert_eq!(message_id_from_args(&["onemail".into(), "--open-message".into()]), None);
    }
}

pub fn queue_notification_message(message_id: i64) {
    if let Ok(mut pending) = pending_notification_message().lock() {
        *pending = Some(message_id);
    }
}

pub fn open_notification_message(app: &AppHandle, message_id: i64) {
    queue_notification_message(message_id);
    let _ = app.emit("notifications/openMessage", message_id);
}

#[tauri::command]
pub fn system_take_notification_message() -> Option<i64> {
    pending_notification_message().lock().ok()?.take()
}

async fn provider_icon(app: &AppHandle, provider_key: Option<&str>) -> Option<std::path::PathBuf> {
    let provider_key = provider_key?;
    let directory = app.path().app_cache_dir().ok()?.join("notification-providers");
    std::fs::create_dir_all(&directory).ok()?;
    if provider_key == "gmail" {
        let path = directory.join("gmail-online.png");
        if path.metadata().is_ok_and(|metadata| metadata.len() > 8) {
            return Some(path);
        }
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build().ok()?
            .get(GMAIL_ICON_URL).send().await.ok()?;
        if !response.status().is_success() { return None; }
        let bytes = response.bytes().await.ok()?;
        if bytes.len() < 8 || bytes.len() > 64 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return None;
        }
        std::fs::write(&path, bytes).ok()?;
        return Some(path);
    }
    let (name, bytes): (&str, &[u8]) = match provider_key {
        "qq" => ("qq.png", include_bytes!("../../icons/notification-providers/qq.png")),
        "aliyun" | "aliyunEnterprise" => ("aliyun.png", include_bytes!("../../icons/notification-providers/aliyun.png")),
        "icloud" => ("icloud.png", include_bytes!("../../icons/notification-providers/icloud.png")),
        "mailru" => ("mailru.png", include_bytes!("../../icons/notification-providers/mailru.png")),
        "sina" => ("sina.png", include_bytes!("../../icons/notification-providers/sina.png")),
        "outlook" => ("outlook.png", include_bytes!("../../icons/notification-providers/outlook.png")),
        "163" => ("netease.png", include_bytes!("../../icons/notification-providers/netease.png")),
        _ => return None,
    };
    let path = directory.join(name);
    std::fs::write(&path, bytes).ok()?;
    Some(path)
}

#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> Value {
    json!({
        "platform": javascript_platform(),
        "appVersion": state.app_version,
        "databasePath": state.database_path.to_string_lossy(),
        "userDataPath": state.user_data_path.to_string_lossy()
    })
}

#[tauri::command]
pub fn system_set_title_bar_theme(window: WebviewWindow, theme: String) -> Result<bool, String> {
    let next_theme = match theme.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return Ok(false),
    };
    window
        .set_theme(Some(next_theme))
        .map_err(|error| format!("更新窗口主题失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn system_reveal_database(state: State<'_, AppState>) -> Result<bool, String> {
    reveal_path(&state.database_path)?;
    Ok(true)
}

#[tauri::command]
pub fn system_reveal_path(path: String) -> Result<bool, String> {
    let target = path.trim();
    if target.is_empty() {
        return Ok(false);
    }
    reveal_path(Path::new(target))?;
    Ok(true)
}

#[tauri::command]
pub fn system_open_external(url: String) -> Result<bool, String> {
    let target = url.trim();
    if !target.starts_with("https://") && !target.starts_with("http://") {
        return Ok(false);
    }
    open::that(target).map_err(|error| format!("打开链接失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn system_send_notification(
    app: AppHandle,
    title: String,
    body: String,
    sound: Option<String>,
    message_id: Option<i64>,
    provider_key: Option<String>,
) -> Result<(), String> {
    let icon = provider_icon(&app, provider_key.as_deref()).await;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let _ = app;
            return send_mac_notification(&title, &body, sound.as_deref(), icon.as_deref(), message_id);
        }

        #[cfg(not(target_os = "macos"))]
        {
            #[cfg(target_os = "windows")]
            let app_id = app.config().identifier.clone();
            let mut notification = notify_rust::Notification::new();
            notification.summary(&title).body(&body);
            #[cfg(target_os = "windows")]
            if !tauri::is_dev() {
                notification.app_id(&app_id);
            }
            #[cfg(target_os = "linux")]
            notification.appname("OneMail");
            if let Some(sound) = sound.as_deref() {
                notification.sound_name(sound);
            }
            if let Some(icon) = icon.as_deref().and_then(Path::to_str) {
                notification.image_path(icon);
            }
            let handle = notification.show().map_err(|error| error.to_string())?;
            if let Some(message_id) = message_id.filter(|id| *id > 0) {
                std::thread::spawn(move || {
                    let _ = handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                        if response.is_default_action() {
                            open_notification_message(&app, message_id);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    });
                });
            }
            Ok(())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn send_mac_notification(
    title: &str,
    body: &str,
    sound: Option<&str>,
    icon: Option<&Path>,
    message_id: Option<i64>,
) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let helper = if tauri::is_dev() {
        executable
            .parent()
            .ok_or("无法定位开发版可执行文件")?
            .join("bundle/macos/OneMail Dev.app/Contents/MacOS/onemail")
    } else {
        executable
    };
    let mut child = Command::new(&helper)
        .arg("--notify-stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动开发版通知程序 {}: {error}", helper.display()))?;
    let payload = serde_json::to_vec(&json!({
        "title": title,
        "body": body,
        "sound": sound,
        "iconPath": icon.and_then(Path::to_str),
        "messageId": message_id.filter(|id| *id > 0)
    }))
        .map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or("无法写入通知内容")?
        .write_all(&payload)
        .map_err(|error| error.to_string())?;
    let mut ready = String::new();
    BufReader::new(child.stdout.take().ok_or("无法读取通知程序状态")?)
        .read_line(&mut ready)
        .map_err(|error| error.to_string())?;
    if ready.trim() == "ready" {
        std::thread::spawn(move || { let _ = child.wait(); });
        Ok(())
    } else {
        let output = child.wait_with_output().map_err(|error| error.to_string())?;
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

#[tauri::command]
pub fn accounts_open_add_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("add-account") {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("打开添加账号窗口失败：{error}"))?;
        return Ok(true);
    }

    WebviewWindowBuilder::new(
        &app,
        "add-account",
        WebviewUrl::App("index.html#/accounts/new".into()),
    )
    .title("添加账号 - OneMail")
    .inner_size(440.0, 460.0)
    .min_inner_size(440.0, 460.0)
    .max_inner_size(440.0, 460.0)
    .resizable(false)
    .center()
    .build()
    .map_err(|error| format!("创建添加账号窗口失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn accounts_close_add_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("add-account") {
        window
            .close()
            .map_err(|error| format!("关闭添加账号窗口失败：{error}"))?;
    }
    Ok(true)
}

fn javascript_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    return "darwin";
    #[cfg(target_os = "windows")]
    return "win32";
    #[cfg(target_os = "linux")]
    return "linux";
    #[allow(unreachable_code)]
    "unknown"
}

fn reveal_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(path).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status();

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .status();

    status
        .map_err(|error| format!("打开文件管理器失败：{error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("文件管理器未能打开目标路径。".to_string())
            }
        })
}
