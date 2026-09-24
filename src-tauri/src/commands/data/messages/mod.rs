mod detail;

pub(crate) use detail::get_message_detail;
use detail::message_has_cached_body_but_missing_headers;

use rusqlite::{params, OptionalExtension};
use async_imap::types::Flag;
use serde_json::{json, Value};
use std::time::Duration;
use futures_util::TryStreamExt;
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout;

use crate::{db, mail::{body as mail_body, transport as mail_transport}, state::AppState};

use super::utils::database_error;

#[tauri::command]
pub fn messages_stats(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT m.account_id, COUNT(*) AS total_count,
                    SUM(CASE WHEN m.is_read=0 THEN 1 ELSE 0 END) AS unread_count,
                    MAX(COALESCE(unixepoch(m.received_at),unixepoch(m.internal_date),unixepoch(m.created_at))) AS latest_message_at
             FROM onemail_mail_messages m
             WHERE m.remote_deleted=0 AND m.user_hidden=0
             GROUP BY m.account_id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "accountId": row.get::<_, i64>(0)?,
                "totalCount": row.get::<_, i64>(1)?,
                "unreadCount": row.get::<_, i64>(2)?,
                "latestMessageAt": row.get::<_, Option<i64>>(3)?
            }))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(Value::Array(rows))
}

#[tauri::command]
pub async fn messages_get(
    state: State<'_, AppState>,
    message_id: i64,
) -> Result<Option<Value>, String> {
    let connection = db::open(&state)?;
    let participants_missing = mail_body::participants_need_repair(&connection, message_id)?;
    let detail = get_message_detail(&connection, message_id)?;
    let should_repair = participants_missing || detail
        .as_ref()
        .is_some_and(message_has_cached_body_but_missing_headers);
    drop(connection);

    if !should_repair
        || mail_body::repair_message_metadata(&state, message_id)
            .await
            .is_err()
    {
        return Ok(detail);
    }

    let connection = db::open(&state)?;
    get_message_detail(&connection, message_id)
}

#[tauri::command]
pub async fn messages_load_body(
    state: State<'_, AppState>,
    message_id: i64,
) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let body = connection
        .query_row(
            "SELECT body_text,body_html_sanitized,external_images_blocked
             FROM onemail_message_bodies WHERE message_id=?1",
            [message_id],
            |row| {
                Ok(json!({
                    "messageId": message_id,
                    "bodyText": row.get::<_, Option<String>>(0)?,
                    "bodyHtmlSanitized": row.get::<_, Option<String>>(1)?,
                    "externalImagesBlocked": row.get::<_, i64>(2)? != 0
                }))
            },
        )
        .optional()
        .map_err(database_error)?;

    if let Some(body) = body {
        let participants_missing = mail_body::participants_need_repair(&connection, message_id)?;
        drop(connection);
        if participants_missing {
            let error = mail_body::repair_message_metadata(&state, message_id).await.err();
            return Ok(json!({ "body": body, "error": error }));
        }
        return Ok(json!({ "body": body, "error": null }));
    }

    drop(connection);
    match mail_body::load_message_body(&state, message_id).await {
        Ok(body) => Ok(json!({ "body": body, "error": null })),
        Err(error) => Ok(json!({ "body": null, "error": error })),
    }
}

#[tauri::command]
pub async fn messages_set_read_state(
    app: AppHandle,
    state: State<'_, AppState>,
    message_id: i64,
    is_read: bool,
) -> Result<Value, String> {
    let update = set_read_state(&state, message_id, is_read).await?;
    emit_read_state_change(&app, &update);
    Ok(update)
}

async fn set_read_state(
    state: &AppState,
    message_id: i64,
    is_read: bool,
) -> Result<Value, String> {
    let connection = db::open(state)?;
    let target = connection
        .query_row(
            "SELECT m.account_id,m.folder_id,f.path,m.uid,f.uid_validity,s.highest_modseq
             FROM onemail_mail_messages m
             JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
             LEFT JOIN onemail_folder_sync_states s ON s.folder_id=m.folder_id
             WHERE m.message_id=?1 AND m.remote_deleted=0",
            [message_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or_else(|| "邮件不存在。".to_string())?;
    drop(connection);
    if target.5.as_deref().is_some_and(|cursor| cursor.starts_with("gmail-history:") || cursor.starts_with("graph-delta:")) {
        persist_read_state(state, message_id, target.0, target.1, is_read, false)?;
        return Ok(json!({
            "messageId": message_id, "accountId": target.0, "folderId": target.1,
            "isRead": is_read, "remoteSynced": false
        }));
    }
    let uid = u32::try_from(target.3).map_err(|_| "邮件 UID 无效，无法更新已读状态。".to_string())?;
    let account = mail_transport::load_account(state, target.0)?;
    let mut session = timeout(Duration::from_secs(30), mail_transport::connect_authenticated(state, &account))
        .await.map_err(|_| "连接 IMAP 服务器超时，已读状态未更改。".to_string())??;
    let mailbox = timeout(Duration::from_secs(30), session.select(&target.2))
        .await.map_err(|_| "打开邮件文件夹超时，已读状态未更改。".to_string())?
        .map_err(|error| format!("打开邮件文件夹失败，已读状态未更改：{error}"))?;
    if target.4.as_deref().is_some_and(|expected| mailbox.uid_validity.map(|actual| actual.to_string()).as_deref() != Some(expected)) {
        return Err("邮件文件夹 UID 已变化，请先刷新邮箱再重试。".to_string());
    }
    let flag = if is_read { "+FLAGS.SILENT (\\Seen)" } else { "-FLAGS.SILENT (\\Seen)" };
    let mut responses = timeout(Duration::from_secs(30), session.uid_store(uid.to_string(), flag))
        .await.map_err(|_| "更新远端已读状态超时。".to_string())?
        .map_err(|error| format!("更新远端已读状态失败：{error}"))?;
    while timeout(Duration::from_secs(30), responses.try_next())
        .await.map_err(|_| "等待远端已读状态确认超时。".to_string())?
        .map_err(|error| format!("远端已读状态未确认：{error}"))?.is_some() {}
    drop(responses);
    let mut fetched = timeout(Duration::from_secs(30), session.uid_fetch(uid.to_string(), "(UID FLAGS)"))
        .await.map_err(|_| "验证远端已读状态超时。".to_string())?
        .map_err(|error| format!("验证远端已读状态失败：{error}"))?;
    let mut confirmed = false;
    while let Some(message) = timeout(Duration::from_secs(30), fetched.try_next())
        .await.map_err(|_| "等待远端已读状态验证超时。".to_string())?
        .map_err(|error| format!("读取远端已读状态失败：{error}"))? {
        if message.uid == Some(uid) {
            confirmed = message.flags().any(|flag| matches!(flag, Flag::Seen)) == is_read;
        }
    }
    drop(fetched);
    if !confirmed {
        return Err("服务器未确认已读状态，请刷新邮箱后重试。".to_string());
    }
    let _ = timeout(Duration::from_secs(10), session.logout()).await;
    persist_read_state(state, message_id, target.0, target.1, is_read, true)?;
    Ok(json!({
        "messageId": message_id,
        "accountId": target.0,
        "folderId": target.1,
        "isRead": is_read,
        "remoteSynced": true
    }))
}

fn persist_read_state(state: &AppState, message_id: i64, account_id: i64, folder_id: i64, is_read: bool, remote_synced: bool) -> Result<(), String> {
    let mut connection = db::open(state)?;
    let protect_from_in_flight_sync = !remote_synced || state.sync_tracker.account_ids()?.contains(&account_id);
    let transaction = connection.transaction().map_err(database_error)?;
    transaction
        .execute(
            "UPDATE onemail_mail_messages SET is_read=?2,read_state_override=CASE WHEN ?3 THEN ?2 ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE message_id=?1",
            params![message_id, is_read, protect_from_in_flight_sync],
        )
        .map_err(database_error)?;
    transaction.execute(
        "UPDATE onemail_mail_folders SET unread_count=(SELECT COUNT(*) FROM onemail_mail_messages
         WHERE folder_id=?1 AND is_read=0 AND remote_deleted=0 AND user_hidden=0) WHERE folder_id=?1",
        [folder_id],
    ).map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(())
}

fn emit_read_state_change(app: &AppHandle, update: &Value) {
    let _ = app.emit("sync/mailboxChanged", json!({
        "accountId": update["accountId"],
        "reason": "read-state",
        "changedAt": db::now_iso()
    }));
}

#[cfg(test)]
mod tests {
    use super::message_has_cached_body_but_missing_headers;
    use serde_json::json;

    #[test]
    fn only_repairs_missing_headers_when_a_body_is_already_cached() {
        assert!(message_has_cached_body_but_missing_headers(&json!({
            "subject": null,
            "fromName": null,
            "fromEmail": null,
            "body": { "bodyText": "cached" }
        })));
        assert!(!message_has_cached_body_but_missing_headers(&json!({
            "subject": null,
            "fromName": null,
            "fromEmail": null,
            "body": null
        })));
        assert!(!message_has_cached_body_but_missing_headers(&json!({
            "subject": "真实主题",
            "fromName": null,
            "fromEmail": null,
            "body": { "bodyText": "cached" }
        })));
    }
}
