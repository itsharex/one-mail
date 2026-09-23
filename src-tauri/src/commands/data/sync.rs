use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::{mail::sync as mail_sync, state::AppState};

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> Result<Value, String> {
    let account_ids = state.sync_tracker.account_ids()?;
    Ok(json!({ "running": !account_ids.is_empty(), "accountIds": account_ids }))
}

#[tauri::command]
pub async fn sync_start_all(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: Option<String>,
) -> Result<Value, String> {
    let result = mail_sync::sync_all(&state, mode.as_deref(), |result, completed, total| {
        emit_sync_events(&app, result, mode.as_deref());
        let _ = app.emit("sync/progress", json!({
            "accountId": result["accountId"], "completed": completed, "total": total,
            "ok": result["ok"], "skipped": result.get("skipped").and_then(Value::as_bool).unwrap_or(false),
            "error": result.get("error").and_then(Value::as_str)
        }));
    }).await?;
    Ok(result)
}

#[tauri::command]
pub async fn sync_start_account(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: i64,
    mode: Option<String>,
) -> Result<Value, String> {
    let result = mail_sync::sync_account(&state, account_id, mode.as_deref()).await?;
    emit_sync_events(&app, &result, mode.as_deref());
    Ok(result)
}

#[tauri::command]
pub fn notifications_status() -> Value {
    json!({ "desktopSupported": true })
}

fn emit_sync_events(app: &AppHandle, result: &Value, mode: Option<&str>) {
    let account_results = result
        .get("accounts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(result));

    for account_result in account_results {
        if account_result.get("ok").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(account_id) = account_result.get("accountId").and_then(Value::as_i64) else {
            continue;
        };
        let changed_at = crate::db::now_iso();
        let _ = app.emit(
            "sync/mailboxChanged",
            json!({
                "accountId": account_id,
                "reason": "manual",
                "changedAt": changed_at
            }),
        );

        if let Some(notification) = new_mail_notification(account_result, mode) {
            let _ = app.emit("notifications/newMail", notification);
        }
    }
}

fn new_mail_notification(account_result: &Value, mode: Option<&str>) -> Option<Value> {
    if mode == Some("initial") {
        return None;
    }
    let account_id = account_result.get("accountId").and_then(Value::as_i64)?;
    let message_count = account_result
        .get("newMessageCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let messages = account_result
        .get("newMessages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if message_count == 0 || messages.is_empty() {
        return None;
    }

    Some(json!({
        "notificationId": format!(
            "{account_id}-{}",
            chrono::Utc::now().timestamp_millis()
        ),
        "accountId": account_id,
        "accountEmail": account_result.get("accountEmail").cloned(),
        "reason": "manual",
        "messageCount": message_count,
        "messages": messages,
        "notifiedAt": crate::db::now_iso()
    }))
}

#[cfg(test)]
mod tests {
    use super::new_mail_notification;
    use serde_json::json;

    #[test]
    fn initial_sync_never_creates_a_new_mail_notification() {
        let result = json!({
            "accountId": 1,
            "newMessageCount": 1,
            "newMessages": [{ "messageId": 10, "accountId": 1 }]
        });

        assert_eq!(new_mail_notification(&result, Some("initial")), None);
    }

    #[test]
    fn refresh_only_notifies_when_new_messages_were_inserted() {
        let empty = json!({ "accountId": 1, "newMessageCount": 0, "newMessages": [] });
        assert_eq!(new_mail_notification(&empty, Some("refresh")), None);

        let result = json!({
            "accountId": 1,
            "accountEmail": "owner@example.com",
            "newMessageCount": 1,
            "newMessages": [{ "messageId": 10, "accountId": 1, "subject": "New" }]
        });
        let notification =
            new_mail_notification(&result, Some("refresh")).expect("new mail notification");

        assert_eq!(notification["messageCount"], 1);
        assert_eq!(notification["messages"][0]["messageId"], 10);
    }
}
