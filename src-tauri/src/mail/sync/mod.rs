mod gmail_api;
mod graph_api;
mod imap;

use imap::{sync_account_imap, ImapSyncScope};

use futures_util::{stream, StreamExt};
use std::future::Future;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::{db, mail::transport as mail_transport, state::{AppState, SYNC_CONCURRENCY}};

const ACCOUNT_SYNC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60 * 60);

pub type SyncStepCallback<'a> = dyn Fn(i64, &str, Option<&str>) + Send + Sync + 'a;

pub async fn sync_all(state: &AppState, mode: Option<&str>, on_complete: impl Fn(&Value, usize, usize), on_step: Option<&SyncStepCallback<'_>>) -> Result<Value, String> {
    let accounts = {
        let connection = db::open(state)?;
        let mut statement = connection
            .prepare(
                "SELECT account_id,email,account_label,display_name,auth_type,status,connection_state,last_error
                 FROM onemail_mail_accounts
                 WHERE sync_enabled=1 AND status <> 'disabled'
                 ORDER BY sort_order,account_id",
            )
            .map_err(|error| format!("读取同步账号失败：{error}"))?;
        let accounts = statement
            .query_map([], |row| {
                Ok(SyncAccountTarget {
                    account_id: row.get(0)?,
                    email: row.get(1)?,
                    account_label: row.get(2)?,
                    display_name: row.get(3)?,
                    auth_type: row.get(4)?,
                    status: row.get(5)?,
                    connection_state: row.get(6)?,
                    last_error: row.get(7)?,
                })
            })
            .map_err(|error| format!("读取同步账号失败：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取同步账号失败：{error}"))?;
        accounts
    };

    let tasks = accounts.into_iter().map(|account| async move {
        if let Some(error) = sync_skip_reason(&account) {
            return account_sync_skipped(&account, error);
        }
        loop {
            match sync_account(state, account.account_id, mode, on_step).await {
                Ok(value) if value.get("busy").and_then(Value::as_bool) == Some(true) => {
                    if let Err(error) = state.sync_tracker.wait_until_idle(account.account_id).await {
                        break json!({ "accountId": account.account_id, "ok": false, "error": error });
                    }
                }
                Ok(value) => break value,
                Err(error) => break json!({ "accountId": account.account_id, "ok": false, "error": error }),
            }
        }
    }).collect();
    let results = run_sync_tasks(tasks, on_complete).await;
    Ok(json!({ "mode": mode, "accounts": results }))
}

async fn run_sync_tasks<F: Future<Output = Value>>(tasks: Vec<F>, on_complete: impl Fn(&Value, usize, usize)) -> Vec<Value> {
    let total = tasks.len();
    let mut pending = stream::iter(tasks.into_iter().enumerate().map(|(index, task)| async move {
        (index, task.await)
    })).buffer_unordered(SYNC_CONCURRENCY);
    let mut results = Vec::with_capacity(total);
    while let Some((index, result)) = pending.next().await {
        on_complete(&result, results.len() + 1, total);
        results.push((index, result));
    }
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, result)| result).collect()
}

#[derive(Clone, Debug)]
struct SyncAccountTarget {
    account_id: i64,
    email: String,
    account_label: Option<String>,
    display_name: Option<String>,
    auth_type: String,
    status: String,
    connection_state: String,
    last_error: Option<String>,
}

fn sync_skip_reason(account: &SyncAccountTarget) -> Option<String> {
    let stale_imap_access_error = account.auth_type == "oauth2"
        && account.last_error.as_deref().is_some_and(|error|
            error.to_ascii_lowercase().contains("authenticated but not connected"));
    if stale_imap_access_error {
        return None;
    }
    if account.connection_state == "reauthorize" {
        return Some(
            non_empty_error(account)
                .unwrap_or_else(|| "账号需要重新授权，请点击重新授权后再刷新。".to_string()),
        );
    }

    if account.status == "auth_error" {
        return Some(non_empty_error(account).unwrap_or_else(|| {
            if account.auth_type == "oauth2" {
                "账号需要重新授权，请点击重新授权后再刷新。".to_string()
            } else {
                "账号凭据无效，请编辑账号并更新授权码或应用密码后再刷新。".to_string()
            }
        }));
    }

    None
}

fn non_empty_error(account: &SyncAccountTarget) -> Option<String> {
    account
        .last_error
        .as_deref()
        .map(str::trim)
        .filter(|error| !error.is_empty())
        .map(str::to_string)
}

fn account_sync_skipped(account: &SyncAccountTarget, error: String) -> Value {
    json!({
        "accountId": account.account_id,
        "email": account.email,
        "accountLabel": account.account_label,
        "displayName": account.display_name,
        "status": account.status,
        "connectionStatus": account.connection_state,
        "ok": false,
        "skipped": true,
        "error": error
    })
}

pub async fn sync_account(
    state: &AppState,
    account_id: i64,
    mode: Option<&str>,
    on_step: Option<&SyncStepCallback<'_>>,
) -> Result<Value, String> {
    let _slot = state.sync_tracker.acquire_slot().await?;
    let _sync_guard = match state.sync_tracker.start(account_id)? {
        Some(guard) => guard,
        None => return Ok(json!({ "accountId": account_id, "ok": false, "skipped": true, "busy": true, "error": "账号正在同步。" })),
    };
    let account = mail_transport::load_account(state, account_id)?;
    let _network_request = state.network_activity.begin_for_account("sync", account_id);
    if let Some(emit) = on_step { emit(account_id, "connecting", None); }
    set_syncing(state, account_id)?;

    let result = tokio::time::timeout(ACCOUNT_SYNC_TIMEOUT, sync_account_inner(state, &account, mode, on_step))
        .await
        .unwrap_or_else(|_| Err("账号同步超过 60 分钟，已停止本次同步。".to_string()));
    drop(_network_request);
    let outcome = match result {
        Ok(mut value) => {
            let sync_error = (value.get("ok").and_then(Value::as_bool) == Some(false))
                .then(|| value.get("error").and_then(Value::as_str).unwrap_or("部分文件夹同步失败。"));
            let connection = db::open(state)?;
            connection
                .execute(
                    "UPDATE onemail_mail_accounts SET status=CASE WHEN ?2 IS NULL THEN 'active' ELSE 'sync_error' END,
                       last_sync_at=CASE WHEN ?2 IS NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_sync_at END,
                       last_error=?2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
                    params![account_id, sync_error],
                )
                .map_err(|error| format!("更新同步状态失败：{error}"))?;
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "accountEmail".to_string(),
                    Value::String(account.email.clone()),
                );
                object.insert(
                    "mode".to_string(),
                    mode.map(str::to_string).map_or(Value::Null, Value::String),
                );
            }
            Ok(value)
        }
        Err(error) => {
            let connection = db::open(state)?;
            connection
                .execute(
                    "UPDATE onemail_mail_accounts SET status=CASE WHEN connection_state='reauthorize' THEN 'auth_error' ELSE 'sync_error' END,
                       last_error=?2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
                    params![account_id, error],
                )
                .map_err(|db_error| format!("保存同步错误失败：{db_error}"))?;
            Err(error)
        }
    };
    let connection = db::open(state)?;
    db::clear_imap_read_overrides(&connection, Some(account_id))?;
    outcome
}

async fn sync_account_inner(
    state: &AppState,
    account: &mail_transport::MailAccount,
    mode: Option<&str>,
    on_step: Option<&SyncStepCallback<'_>>,
) -> Result<Value, String> {
    let imap_scope = match mode {
        Some("background-inbox") => ImapSyncScope::Inbox,
        Some("background-other-folders") => ImapSyncScope::OtherFolders,
        _ => ImapSyncScope::All,
    };
    if imap_scope == ImapSyncScope::OtherFolders {
        return sync_account_imap(state, account, imap_scope, on_step).await;
    }
    let provider_key = account.provider_key.to_ascii_lowercase();
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "gmail" | "google") {
        if let Some(emit) = on_step { emit(account.account_id, "requesting", None); }
        match gmail_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                if let Some(error) = reason.strip_prefix("API_RETRYABLE:") {
                    return Err(error.trim().to_string());
                }
                let value = sync_account_imap(state, account, imap_scope, on_step).await?;
                return Ok(with_api_fallback(value, "gmail-history", reason));
            }
        }
    }
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "outlook" | "microsoft") {
        if let Some(emit) = on_step { emit(account.account_id, "requesting", None); }
        match graph_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                if let Some(error) = reason.strip_prefix("API_RETRYABLE:") {
                    return Err(error.trim().to_string());
                }
                let value = sync_account_imap(state, account, imap_scope, on_step).await?;
                return Ok(with_api_fallback(value, "graph-delta", reason));
            }
        }
    }
    sync_account_imap(state, account, imap_scope, on_step).await
}

fn with_api_fallback(mut value: Value, api: &str, reason: String) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("syncPath".to_string(), Value::String("imap".to_string()));
        object.insert("apiFallback".to_string(), Value::String(api.to_string()));
        object.insert("apiFallbackReason".to_string(), Value::String(reason));
    }
    value
}

#[derive(Default)]
pub(crate) struct FetchedMessage {
    pub(crate) participants: Vec<crate::mail::body::ParticipantHeader>,
    pub(crate) uid: i64,
    subject: Option<String>,
    message_id: Option<String>,
    from_name: Option<String>,
    from_email: Option<String>,
    received_at: Option<String>,
    internal_date: Option<String>,
    in_reply_to: Option<String>,
    references_header: Option<String>,
    snippet: Option<String>,
    size_bytes: u32,
    is_read: bool,
    has_attachments: bool,
    remote_deleted: bool,
}

impl FetchedMessage {
    fn deleted(uid: i64) -> Self {
        Self { uid, remote_deleted: true, ..Self::default() }
    }
}

pub(crate) fn read_cursor(
    connection: &Connection,
    folder_id: i64,
    prefix: &str,
) -> Result<Option<String>, String> {
    let value = connection
        .query_row(
            "SELECT highest_modseq FROM onemail_folder_sync_states WHERE folder_id=?1",
            [folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("读取同步游标失败：{error}"))?
        .flatten();
    Ok(value
        .filter(|value| value.starts_with(prefix))
        .map(|value| value[prefix.len()..].to_string()))
}

pub(crate) fn apply_messages(
    connection: &Connection,
    account_id: i64,
    folder_id: i64,
    folder_path: &str,
    messages: &[FetchedMessage],
    cursor: Option<&str>,
    sync_path: &str,
) -> Result<Value, String> {
    let transaction = rusqlite::Transaction::new_unchecked(connection, rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("开始保存同步批次失败：{error}"))?;
    let mut inserted_count = 0;
    let mut new_messages = Vec::new();
    for message in messages {
        let inserted_message_id = upsert_message(connection, account_id, folder_id, message)?;
        if inserted_message_id.is_some() && !message.remote_deleted {
            inserted_count += 1;
        }
        if let Some(message_id) = inserted_message_id
            .filter(|_| !message.remote_deleted && folder_path.eq_ignore_ascii_case("INBOX"))
        {
            new_messages.push(json!({
                "messageId": message_id,
                "accountId": account_id,
                "subject": message.subject.clone(),
                "fromName": message.from_name.clone(),
                "fromEmail": message.from_email.clone(),
                "receivedAt": message.received_at.clone(),
                "snippet": message.snippet.clone()
            }));
        }
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_folder_sync_states(folder_id,account_id) VALUES (?1,?2)",
            params![folder_id, account_id],
        )
        .map_err(|error| format!("初始化同步状态失败：{error}"))?;
    let last_uid = messages.iter().map(|message| message.uid).max();
    connection
        .execute(
            "UPDATE onemail_folder_sync_states SET
               highest_modseq=COALESCE(?2,highest_modseq),last_uid=MAX(last_uid,COALESCE(?3,last_uid)),
               uid_validity=(SELECT uid_validity FROM onemail_mail_folders WHERE folder_id=?1),
               last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),status='idle',last_error=NULL,
               finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE folder_id=?1",
            params![folder_id, cursor, last_uid],
        )
        .map_err(|error| format!("保存同步游标失败：{error}"))?;
    connection
        .execute(
            "UPDATE onemail_mail_folders SET total_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND remote_deleted=0 AND user_hidden=0),
               unread_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND is_read=0 AND remote_deleted=0 AND user_hidden=0),
               last_sync_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE folder_id=?1",
            [folder_id],
        )
        .map_err(|error| format!("更新文件夹同步状态失败：{error}"))?;

    transaction.commit().map_err(|error| format!("提交同步批次失败：{error}"))?;

    Ok(json!({
        "accountId": account_id,
        "folder": folder_path,
        "fetchedCount": messages.iter().filter(|message| !message.remote_deleted).count(),
        "scannedCount": messages.len(),
        "insertedCount": inserted_count,
        "newMessageCount": new_messages.len(),
        "newMessages": new_messages,
        "deletedCount": messages.iter().filter(|message| message.remote_deleted).count(),
        "syncPath": sync_path,
        "ok": true
    }))
}

fn upsert_message(
    connection: &Connection,
    account_id: i64,
    folder_id: i64,
    message: &FetchedMessage,
) -> Result<Option<i64>, String> {
    let existing_message_id = connection
        .query_row(
            "SELECT message_id FROM onemail_mail_messages
             WHERE account_id=?1 AND folder_id=?2 AND uid=?3",
            params![account_id, folder_id, message.uid],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("读取邮件摘要失败：{error}"))?;
    connection
        .execute(
            "INSERT INTO onemail_mail_messages
                   (account_id,folder_id,uid,rfc822_message_id,in_reply_to,references_header,subject,
                    from_name,from_email,received_at,internal_date,snippet,size_bytes,is_read,
                    has_attachments,flags_json,remote_deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'[]',?16)
                 ON CONFLICT(account_id,folder_id,uid) DO UPDATE SET
                   rfc822_message_id=COALESCE(NULLIF(TRIM(excluded.rfc822_message_id),''),onemail_mail_messages.rfc822_message_id),
                   in_reply_to=COALESCE(NULLIF(TRIM(excluded.in_reply_to),''),onemail_mail_messages.in_reply_to),
                   references_header=COALESCE(NULLIF(TRIM(excluded.references_header),''),onemail_mail_messages.references_header),
                   subject=COALESCE(NULLIF(TRIM(excluded.subject),''),onemail_mail_messages.subject),
                   from_name=COALESCE(NULLIF(TRIM(excluded.from_name),''),onemail_mail_messages.from_name),
                   from_email=COALESCE(NULLIF(TRIM(excluded.from_email),''),onemail_mail_messages.from_email),
                   received_at=COALESCE(NULLIF(TRIM(excluded.received_at),''),onemail_mail_messages.received_at),
                   internal_date=COALESCE(NULLIF(TRIM(excluded.internal_date),''),onemail_mail_messages.internal_date),
                   snippet=COALESCE(NULLIF(TRIM(excluded.snippet),''),onemail_mail_messages.snippet),
                   size_bytes=CASE WHEN excluded.size_bytes>0 THEN excluded.size_bytes ELSE onemail_mail_messages.size_bytes END,
                   is_read=COALESCE(onemail_mail_messages.read_state_override,excluded.is_read),
                   read_state_override=CASE WHEN onemail_mail_messages.read_state_override=excluded.is_read
                     THEN NULL ELSE onemail_mail_messages.read_state_override END,
                   has_attachments=excluded.has_attachments,remote_deleted=excluded.remote_deleted,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                account_id,
                folder_id,
                message.uid,
                message.message_id,
                message.in_reply_to,
                message.references_header,
                message.subject,
                message.from_name,
                message.from_email,
                message.received_at,
                message.internal_date,
                message.snippet,
                i64::from(message.size_bytes),
                message.is_read,
                message.has_attachments,
                message.remote_deleted,
            ],
        )
        .map_err(|error| format!("保存邮件摘要失败：{error}"))?;
    let message_id = existing_message_id.unwrap_or_else(|| connection.last_insert_rowid());
    crate::mail::body::persist_participants(connection, message_id, &message.participants)?;
    Ok(existing_message_id.is_none().then_some(message_id))
}

fn ensure_inbox(connection: &Connection, account_id: i64) -> Result<i64, String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_mail_folders
               (account_id,path,name,role,sync_enabled,sort_order)
             VALUES (?1,'INBOX','INBOX','inbox',1,0)",
            [account_id],
        )
        .map_err(|error| format!("保存收件箱失败：{error}"))?;
    connection
        .query_row(
            "SELECT folder_id FROM onemail_mail_folders WHERE account_id=?1 AND path='INBOX'",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("读取收件箱失败：{error}"))
}

fn set_syncing(state: &AppState, account_id: i64) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET status='syncing',last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
            [account_id],
        )
        .map(|_| ())
        .map_err(|error| format!("更新同步状态失败：{error}"))
}

#[cfg(test)]
mod tests;
