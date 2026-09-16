#[path = "gmail_api.rs"]
mod gmail_api;
#[path = "graph_api.rs"]
mod graph_api;

use async_imap::types::{Flag, Mailbox};
use futures_util::TryStreamExt;
use futures_util::{stream, StreamExt};
use std::future::Future;
use mailparse::MailHeaderMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::{db, mail_transport, state::AppState};

const MAX_MESSAGES: usize = 200;
const SYNC_CONCURRENCY: usize = 4;
const IMAP_SUMMARY_QUERY: &str = "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])";

pub async fn sync_all(state: &AppState, mode: Option<&str>, on_complete: impl Fn(&Value, usize, usize)) -> Result<Value, String> {
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
        match sync_account(state, account.account_id, mode).await {
            Ok(value) => value,
            Err(error) => json!({ "accountId": account.account_id, "ok": false, "error": error }),
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
) -> Result<Value, String> {
    let account = mail_transport::load_account(state, account_id)?;
    set_syncing(state, account_id)?;

    let result = sync_account_inner(state, &account).await;
    match result {
        Ok(mut value) => {
            let connection = db::open(state)?;
            connection
                .execute(
                    "UPDATE onemail_mail_accounts SET status='active',last_sync_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                       last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
                    [account_id],
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
    }
}

async fn sync_account_inner(
    state: &AppState,
    account: &mail_transport::MailAccount,
) -> Result<Value, String> {
    let provider_key = account.provider_key.to_ascii_lowercase();
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "gmail" | "google") {
        match gmail_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                let value = sync_account_imap(state, account).await?;
                return Ok(with_api_fallback(value, "gmail-history", reason));
            }
        }
    }
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "outlook" | "microsoft") {
        match graph_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                let value = sync_account_imap(state, account).await?;
                return Ok(with_api_fallback(value, "graph-delta", reason));
            }
        }
    }
    sync_account_imap(state, account).await
}

fn with_api_fallback(mut value: Value, api: &str, reason: String) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("syncPath".to_string(), Value::String("imap".to_string()));
        object.insert("apiFallback".to_string(), Value::String(api.to_string()));
        object.insert("apiFallbackReason".to_string(), Value::String(reason));
    }
    value
}

async fn sync_account_imap(
    state: &AppState,
    account: &mail_transport::MailAccount,
) -> Result<Value, String> {
    let folders = load_imap_sync_folders(state, account.account_id)?;
    let mut session = mail_transport::connect_authenticated(state, account).await?;
    let mut results = Vec::with_capacity(folders.len());
    let mut failures = Vec::new();
    for folder in &folders {
        match sync_imap_folder(state, account, &mut session, folder).await {
            Ok(result) => results.push(result),
            Err(error) => {
                let _ = set_folder_sync_error(state, folder.folder_id, account.account_id, &error);
                failures.push(format!("{}：{error}", folder.path));
            }
        }
    }
    if let Err(error) = session.logout().await {
        failures.push(format!("关闭 IMAP 连接失败：{error}"));
    }
    if !failures.is_empty() {
        return Err(format!("同步部分 IMAP 文件夹失败：{}", failures.join("；")));
    }

    let fetched_count = results
        .iter()
        .filter_map(|result| result.get("fetchedCount").and_then(Value::as_u64))
        .sum::<u64>();
    let deleted_count = results
        .iter()
        .filter_map(|result| result.get("deletedCount").and_then(Value::as_u64))
        .sum::<u64>();
    let inserted_count = results
        .iter()
        .filter_map(|result| result.get("insertedCount").and_then(Value::as_u64))
        .sum::<u64>();
    let new_messages = results
        .iter()
        .filter_map(|result| result.get("newMessages").and_then(Value::as_array))
        .flatten()
        .cloned()
        .collect::<Vec<_>>();
    Ok(json!({
        "accountId": account.account_id,
        "folders": results,
        "fetchedCount": fetched_count,
        "scannedCount": fetched_count,
        "insertedCount": inserted_count,
        "newMessageCount": new_messages.len(),
        "newMessages": new_messages,
        "deletedCount": deleted_count,
        "syncPath": "imap",
        "ok": true
    }))
}

#[derive(Clone, Debug)]
struct ImapSyncFolder {
    folder_id: i64,
    path: String,
}

fn load_imap_sync_folders(
    state: &AppState,
    account_id: i64,
) -> Result<Vec<ImapSyncFolder>, String> {
    let connection = db::open(state)?;
    ensure_inbox(&connection, account_id)?;
    let mut statement = connection
        .prepare(
            "SELECT folder_id,path FROM onemail_mail_folders
             WHERE account_id=?1 AND sync_enabled=1 AND is_selectable=1
             ORDER BY CASE WHEN path='INBOX' THEN 0 ELSE 1 END,sort_order,folder_id",
        )
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?;
    let folders = statement
        .query_map([account_id], |row| {
            Ok(ImapSyncFolder {
                folder_id: row.get(0)?,
                path: row.get(1)?,
            })
        })
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?;
    Ok(folders)
}

async fn sync_imap_folder(
    state: &AppState,
    account: &mail_transport::MailAccount,
    session: &mut mail_transport::ImapSession,
    folder: &ImapSyncFolder,
) -> Result<Value, String> {
    let mailbox = session
        .select(&folder.path)
        .await
        .map_err(|error| format!("打开文件夹失败：{error}"))?;
    let uid_validity_reset = persist_selected_mailbox(state, folder, &mailbox)?;
    let mut uids = session
        .uid_search("ALL")
        .await
        .map_err(|error| format!("读取邮件列表失败：{error}"))?
        .into_iter()
        .collect::<Vec<_>>();
    uids.sort_unstable();
    if uids.len() > MAX_MESSAGES {
        uids = uids.split_off(uids.len() - MAX_MESSAGES);
    }

    let mut fetched = Vec::new();
    let mut missing_header_uids = Vec::new();
    if !uids.is_empty() {
        let uid_set = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut stream = session
            .uid_fetch(uid_set, IMAP_SUMMARY_QUERY)
            .await
            .map_err(|error| format!("读取邮件摘要失败：{error}"))?;
        while let Some(fetch) = stream
            .try_next()
            .await
            .map_err(|error| format!("读取邮件摘要失败：{error}"))?
        {
            let Some(uid) = fetch.uid else { continue };
            let Some(header_bytes) = fetch.header() else {
                missing_header_uids.push(uid);
                continue;
            };
            let headers = mailparse::parse_headers(header_bytes)
                .map(|(headers, _)| headers)
                .map_err(|error| format!("解析邮件摘要失败（UID {uid}）：{error}"))?;
            let (from_name, from_email) = crate::mail_body::first_header_address(&headers, "From");
            let internal_date = fetch.internal_date().map(|date| date.to_rfc3339());
            fetched.push(FetchedMessage {
                participants: crate::mail_body::parse_participant_headers(&headers),
                uid: i64::from(uid),
                subject: headers.get_first_value("Subject"),
                message_id: headers.get_first_value("Message-ID"),
                from_name,
                from_email,
                received_at: headers
                    .get_first_value("Date")
                    .or_else(|| internal_date.clone()),
                internal_date,
                in_reply_to: headers.get_first_value("In-Reply-To"),
                references_header: headers.get_first_value("References"),
                snippet: headers.get_first_value("Subject"),
                size_bytes: fetch.size.unwrap_or(0),
                is_read: fetch.flags().any(|flag| matches!(flag, Flag::Seen)),
                has_attachments: false,
                remote_deleted: false,
            });
        }
        drop(stream);
    }
    if fetched.is_empty() && !uids.is_empty() && !missing_header_uids.is_empty() {
        return Err(format!(
            "IMAP 未返回请求的邮件头（{} 封邮件），已停止写入空摘要。",
            missing_header_uids.len()
        ));
    }
    let connection = db::open(state)?;
    let mut result = apply_messages(
        &connection,
        account.account_id,
        folder.folder_id,
        &folder.path,
        &fetched,
        None,
        "imap",
    )?;
    if let Some(object) = result.as_object_mut() {
        object.insert(
            "uidValidityReset".to_string(),
            Value::Bool(uid_validity_reset),
        );
    }
    Ok(result)
}

fn persist_selected_mailbox(
    state: &AppState,
    folder: &ImapSyncFolder,
    mailbox: &Mailbox,
) -> Result<bool, String> {
    let mut connection = db::open(state)?;
    let previous_uid_validity = connection
        .query_row(
            "SELECT uid_validity FROM onemail_mail_folders WHERE folder_id=?1",
            [folder.folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("读取文件夹 UIDVALIDITY 失败：{error}"))?
        .flatten();
    let uid_validity = mailbox.uid_validity.map(|value| value.to_string());
    let reset = uid_validity_changed(previous_uid_validity.as_deref(), uid_validity.as_deref());
    let uid_next = mailbox.uid_next.map(i64::from);
    let highest_modseq = mailbox.highest_modseq.map(|value| value.to_string());
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始更新文件夹状态失败：{error}"))?;
    if reset {
        transaction
            .execute(
                "DELETE FROM onemail_message_search WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("清理文件夹搜索索引失败：{error}"))?;
        transaction
            .execute(
                "DELETE FROM onemail_mail_messages WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("清理 UIDVALIDITY 已变化的邮件失败：{error}"))?;
        transaction
            .execute(
                "DELETE FROM onemail_folder_sync_states WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("重置文件夹同步状态失败：{error}"))?;
    }
    transaction
        .execute(
            "UPDATE onemail_mail_folders SET uid_validity=COALESCE(?2,uid_validity),
               uid_next=COALESCE(?3,uid_next),highest_modseq=COALESCE(?4,highest_modseq),
               total_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND remote_deleted=0 AND user_hidden=0),
               unread_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND is_read=0 AND remote_deleted=0 AND user_hidden=0),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE folder_id=?1",
            params![folder.folder_id, uid_validity, uid_next, highest_modseq],
        )
        .map_err(|error| format!("更新文件夹 UID 状态失败：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("提交文件夹 UID 状态失败：{error}"))?;
    Ok(reset)
}

fn uid_validity_changed(previous: Option<&str>, current: Option<&str>) -> bool {
    matches!((previous, current), (Some(previous), Some(current)) if previous != current)
}

fn set_folder_sync_error(
    state: &AppState,
    folder_id: i64,
    account_id: i64,
    error: &str,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_folder_sync_states(folder_id,account_id,status,last_error,finished_at)
             VALUES (?1,?2,'error',?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(folder_id) DO UPDATE SET status='error',last_error=excluded.last_error,
               finished_at=excluded.finished_at,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![folder_id, account_id, error],
        )
        .map(|_| ())
        .map_err(|db_error| format!("保存文件夹同步错误失败：{db_error}"))
}

pub(crate) struct FetchedMessage {
    pub(crate) participants: Vec<crate::mail_body::ParticipantHeader>,
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

pub(crate) fn fetched_message(
    uid: i64,
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
) -> FetchedMessage {
    FetchedMessage {
        participants: Vec::new(),
        uid,
        subject,
        message_id,
        from_name,
        from_email,
        received_at,
        internal_date,
        in_reply_to,
        references_header,
        snippet,
        size_bytes,
        is_read,
        has_attachments,
        remote_deleted,
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
                   is_read=excluded.is_read,
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
    crate::mail_body::persist_participants(connection, message_id, &message.participants)?;
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
mod tests {
    use super::{
        fetched_message, sync_skip_reason, uid_validity_changed, upsert_message, SyncAccountTarget,
        IMAP_SUMMARY_QUERY,
    };
    use rusqlite::Connection;

    #[tokio::test]
    async fn sync_batch_is_bounded_and_reports_fast_accounts_before_slow_ones() {
        use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
        use std::time::Duration;
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(tokio::sync::Barrier::new(super::SYNC_CONCURRENCY));
        let progress = Mutex::new(Vec::new());
        let tasks = (0..8).map(|id| {
            let (active, peak, barrier) = (active.clone(), peak.clone(), barrier.clone());
            async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(count, Ordering::SeqCst);
                if id < super::SYNC_CONCURRENCY { barrier.wait().await; }
                tokio::time::sleep(Duration::from_millis(if id == 0 { 50 } else { 1 })).await;
                active.fetch_sub(1, Ordering::SeqCst);
                serde_json::json!({"accountId":id,"ok":id != 2})
            }
        }).collect();
        let results = tokio::time::timeout(Duration::from_secs(2), super::run_sync_tasks(tasks, |result, completed, total| {
            progress.lock().unwrap().push((result["accountId"].as_u64().unwrap(), completed, total));
        })).await.expect("batch must not run serially or hang");
        assert_eq!(peak.load(Ordering::SeqCst), super::SYNC_CONCURRENCY);
        assert_eq!(results.len(), 8);
        assert_eq!(results[2]["ok"], false);
        for (id, result) in results.iter().enumerate() { assert_eq!(result["accountId"], id); }
        let progress = progress.lock().unwrap();
        assert_ne!(progress[0].0, 0);
        for (index, (_, completed, total)) in progress.iter().enumerate() {
            assert_eq!((*completed, *total), (index + 1, 8));
        }
    }

    #[test]
    fn sync_batch_commits_messages_and_cursor_together_or_rolls_back() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(include_str!("db/schema.sql")).unwrap();
        connection.execute_batch(
            "INSERT INTO onemail_provider_presets (provider_key,display_name,auth_type) VALUES ('test','Test','manual');
             INSERT INTO onemail_mail_accounts (account_id,provider_key,email,normalized_email,account_label,auth_type,imap_host,imap_port,imap_security)
             VALUES (1,'test','me@example.test','me@example.test','Test','manual','localhost',993,'ssl_tls');
             INSERT INTO onemail_mail_folders (folder_id,account_id,path,name,role) VALUES (1,1,'INBOX','Inbox','inbox');"
        ).unwrap();
        let message = |uid| fetched_message(uid, Some("Test".into()), None, None, None, None, None, None, None, None, 0, false, false, false);
        assert!(super::apply_messages(&connection, 1, 1, "INBOX", &[message(1), message(0)], Some("test:failed"), "imap").is_err());
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM onemail_mail_messages", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM onemail_folder_sync_states", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        let result = super::apply_messages(&connection, 1, 1, "INBOX", &[message(1), message(2)], Some("test:success"), "imap").unwrap();
        assert_eq!(result["insertedCount"], 2);
        assert_eq!(super::read_cursor(&connection, 1, "test:").unwrap().as_deref(), Some("success"));
        assert_eq!(connection.query_row("SELECT total_count FROM onemail_mail_folders WHERE folder_id=1", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
    }

    #[test]
    fn only_resets_a_folder_when_known_uid_validity_changes() {
        assert!(uid_validity_changed(Some("123"), Some("456")));
        assert!(!uid_validity_changed(Some("123"), Some("123")));
        assert!(!uid_validity_changed(None, Some("123")));
        assert!(!uid_validity_changed(Some("123"), None));
    }

    #[test]
    fn wraps_multiple_imap_summary_items_in_parentheses() {
        assert_eq!(
            IMAP_SUMMARY_QUERY,
            "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])"
        );
    }

    #[test]
    fn skips_accounts_that_already_need_attention() {
        let mut account = SyncAccountTarget {
            account_id: 1,
            email: "owner@example.com".to_string(),
            account_label: None,
            display_name: None,
            auth_type: "oauth2".to_string(),
            status: "active".to_string(),
            connection_state: "reauthorize".to_string(),
            last_error: Some("refresh token 不存在".to_string()),
        };
        assert_eq!(
            sync_skip_reason(&account),
            Some("refresh token 不存在".to_string())
        );

        account.status = "auth_error".to_string();
        account.connection_state = "connected".to_string();
        account.last_error = None;
        assert_eq!(
            sync_skip_reason(&account),
            Some("账号需要重新授权，请点击重新授权后再刷新。".to_string())
        );

        account.auth_type = "app_password".to_string();
        assert_eq!(
            sync_skip_reason(&account),
            Some("账号凭据无效，请编辑账号并更新授权码或应用密码后再刷新。".to_string())
        );

        account.status = "active".to_string();
        assert_eq!(sync_skip_reason(&account), None);
    }

    #[test]
    fn empty_sync_metadata_does_not_erase_existing_headers() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch(
                "CREATE TABLE onemail_mail_messages (
                   message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                   account_id INTEGER NOT NULL,
                   folder_id INTEGER NOT NULL,
                   uid INTEGER NOT NULL,
                   rfc822_message_id TEXT,
                   in_reply_to TEXT,
                   references_header TEXT,
                   subject TEXT,
                   from_name TEXT,
                   from_email TEXT,
                   received_at TEXT,
                   internal_date TEXT,
                   snippet TEXT,
                   size_bytes INTEGER NOT NULL DEFAULT 0,
                   is_read INTEGER NOT NULL DEFAULT 0,
                   has_attachments INTEGER NOT NULL DEFAULT 0,
                   flags_json TEXT NOT NULL DEFAULT '[]',
                   remote_deleted INTEGER NOT NULL DEFAULT 0,
                   updated_at TEXT,
                   UNIQUE(account_id,folder_id,uid)
                 );",
            )
            .expect("create messages table");

        let original = fetched_message(
            42,
            Some("真实主题".to_string()),
            Some("<message@example.com>".to_string()),
            Some("真实发件人".to_string()),
            Some("sender@example.com".to_string()),
            Some("2026-08-09T00:00:00Z".to_string()),
            Some("2026-08-09T00:00:01Z".to_string()),
            None,
            None,
            Some("真实摘要".to_string()),
            128,
            false,
            false,
            false,
        );
        let inserted_message_id =
            upsert_message(&connection, 1, 1, &original).expect("insert original message");
        assert!(inserted_message_id.is_some());

        let empty_refresh = fetched_message(
            42,
            Some("  ".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0,
            true,
            false,
            false,
        );
        let inserted_message_id =
            upsert_message(&connection, 1, 1, &empty_refresh).expect("refresh message");
        assert_eq!(inserted_message_id, None);

        let stored = connection
            .query_row(
                "SELECT subject,from_name,from_email,rfc822_message_id,snippet,size_bytes,is_read
                 FROM onemail_mail_messages WHERE account_id=1 AND folder_id=1 AND uid=42",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .expect("read refreshed message");
        assert_eq!(
            stored,
            (
                "真实主题".to_string(),
                "真实发件人".to_string(),
                "sender@example.com".to_string(),
                "<message@example.com>".to_string(),
                "真实摘要".to_string(),
                128,
                1,
            )
        );
    }
}
