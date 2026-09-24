use async_imap::types::{Flag, Mailbox};
use futures_util::TryStreamExt;
use mailparse::MailHeaderMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;
use tokio::time::timeout;

use super::{apply_messages, ensure_inbox, FetchedMessage, SyncStepCallback};
use crate::{db, mail::transport as mail_transport, state::AppState};

const MAX_MESSAGES: usize = 200;
const FETCH_BATCH_SIZE: usize = 100;
const IMAP_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
pub(super) const IMAP_SUMMARY_QUERY: &str =
    "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ImapSyncScope {
    All,
    Inbox,
    OtherFolders,
}

pub(super) async fn sync_account_imap(
    state: &AppState,
    account: &mail_transport::MailAccount,
    scope: ImapSyncScope,
    on_step: Option<&SyncStepCallback<'_>>,
) -> Result<Value, String> {
    let mut folders = load_imap_sync_folders(state, account.account_id)?;
    match scope {
        ImapSyncScope::All => {}
        ImapSyncScope::Inbox => folders.retain(|folder| folder.path.eq_ignore_ascii_case("INBOX")),
        ImapSyncScope::OtherFolders => folders.retain(|folder| !folder.path.eq_ignore_ascii_case("INBOX")),
    }
    if folders.is_empty() {
        return Ok(json!({
            "accountId": account.account_id,
            "folders": [],
            "fetchedCount": 0,
            "scannedCount": 0,
            "insertedCount": 0,
            "newMessageCount": 0,
            "newMessages": [],
            "deletedCount": 0,
            "syncPath": "imap",
            "ok": true
        }));
    }
    let inbox_message_id_before = latest_inbox_message_id(state, account.account_id)?;
    let mut session = timeout(IMAP_COMMAND_TIMEOUT, mail_transport::connect_authenticated(state, account))
        .await.map_err(|_| "连接 IMAP 服务器超时".to_string())??;
    let mut results = Vec::with_capacity(folders.len());
    let mut failures = Vec::new();
    for folder in &folders {
        if let Some(emit) = on_step { emit(account.account_id, "folder", Some(&folder.path)); }
        match sync_imap_folder(state, account, &mut session, folder, scope == ImapSyncScope::All, on_step).await {
            Ok(result) => results.push(result),
            Err(error) => {
                let _ = set_folder_sync_error(state, folder.folder_id, account.account_id, &error);
                failures.push(format!("{}：{error}", folder.path));
            }
        }
    }
    if let Some(emit) = on_step { emit(account.account_id, "saving", None); }
    // Messages have already been committed; a failed LOGOUT must not hide them from the UI.
    if !matches!(timeout(IMAP_COMMAND_TIMEOUT, session.logout()).await, Ok(Ok(()))) {
        eprintln!("OneMail IMAP 连接关闭失败，已保存的邮件仍可用");
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
    let new_messages = if failures.is_empty() {
        results
            .iter()
            .filter_map(|result| result.get("newMessages").and_then(Value::as_array))
            .flatten()
            .cloned()
            .collect::<Vec<_>>()
    } else {
        // A later FETCH can fail after earlier batches commit. Recover those
        // inserted INBOX rows so callers can still publish their notification.
        new_inbox_messages_since(state, account.account_id, inbox_message_id_before)?
    };
    let error = (!failures.is_empty())
        .then(|| format!("同步部分 IMAP 文件夹失败：{}", failures.join("；")));
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
        "ok": error.is_none(),
        "error": error
    }))
}

fn latest_inbox_message_id(state: &AppState, account_id: i64) -> Result<i64, String> {
    let connection = db::open(state)?;
    connection.query_row(
        "SELECT COALESCE(MAX(m.message_id),0) FROM onemail_mail_messages m
         JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
         WHERE m.account_id=?1 AND upper(f.path)='INBOX'",
        [account_id],
        |row| row.get(0),
    ).map_err(|error| format!("读取收件箱通知游标失败：{error}"))
}

fn new_inbox_messages_since(state: &AppState, account_id: i64, message_id: i64) -> Result<Vec<Value>, String> {
    let connection = db::open(state)?;
    new_inbox_messages_since_connection(&connection, account_id, message_id)
}

fn new_inbox_messages_since_connection(connection: &Connection, account_id: i64, message_id: i64) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(
        "SELECT m.message_id,m.subject,m.from_name,m.from_email,m.received_at,m.snippet
         FROM onemail_mail_messages m
         JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
         WHERE m.account_id=?1 AND upper(f.path)='INBOX' AND m.message_id>?2 AND m.remote_deleted=0
         ORDER BY m.message_id",
    ).map_err(|error| format!("读取已保存新邮件失败：{error}"))?;
    let messages = statement.query_map(params![account_id, message_id], |row| {
        Ok(json!({
            "messageId": row.get::<_, i64>(0)?,
            "accountId": account_id,
            "subject": row.get::<_, Option<String>>(1)?,
            "fromName": row.get::<_, Option<String>>(2)?,
            "fromEmail": row.get::<_, Option<String>>(3)?,
            "receivedAt": row.get::<_, Option<String>>(4)?,
            "snippet": row.get::<_, Option<String>>(5)?
        }))
    }).map_err(|error| format!("读取已保存新邮件失败：{error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("读取已保存新邮件失败：{error}"))?;
    Ok(messages)
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
    reconcile: bool,
    on_step: Option<&SyncStepCallback<'_>>,
) -> Result<Value, String> {
    let mailbox = timeout(IMAP_COMMAND_TIMEOUT, session.select(&folder.path))
        .await.map_err(|_| "打开文件夹超时".to_string())?
        .map_err(|error| format!("打开文件夹失败：{error}"))?;
    let uid_validity_reset = persist_selected_mailbox(state, folder, &mailbox)?;
    let connection = db::open(state)?;
    let last_uid: Option<i64> = connection
        .query_row(
            "SELECT last_uid FROM onemail_folder_sync_states WHERE folder_id=?1",
            [folder.folder_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取文件夹 UID 游标失败：{error}"))?;
    let initial_sync = last_uid.unwrap_or(0) == 0;
    let search = match last_uid.filter(|_| !reconcile) {
        Some(uid) if uid < i64::from(u32::MAX) => format!("UID {}:*", uid + 1),
        Some(_) => return Err("IMAP UID 游标超出支持范围".to_string()),
        None => "ALL".to_string(),
    };
    let mut remote_uids = timeout(IMAP_COMMAND_TIMEOUT, session.uid_search(search))
        .await.map_err(|_| "读取邮件列表超时".to_string())?
        .map_err(|error| format!("读取邮件列表失败：{error}"))?
        .into_iter()
        .collect::<Vec<_>>();
    remote_uids.sort_unstable();
    let uids = select_uids_to_fetch(&remote_uids, last_uid, reconcile);
    if let Some(emit) = on_step { emit(account.account_id, "fetching", Some(&folder.path)); }
    let cached_rows = connection
        .prepare("SELECT uid,subject,from_email,rfc822_message_id FROM onemail_mail_messages WHERE folder_id=?1 AND remote_deleted=0")
        .and_then(|mut statement| {
            statement.query_map([folder.folder_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?))
            })?.collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("读取本地邮件 UID 失败：{error}"))?;
    let cached_uids = cached_rows.iter().map(|(uid, _, _, _)| *uid).collect::<HashSet<_>>();
    let complete_uids = cached_rows.iter()
        .filter(|(_, subject, from_email, message_id)|
            metadata_looks_complete(subject.as_deref(), from_email.as_deref(), message_id.as_deref()))
        .map(|(uid, _, _, _)| *uid)
        .collect::<HashSet<_>>();
    let (cached_to_refresh, full_uids) = partition_cached_uids(uids, &complete_uids);

    let mut fetched_count = 0_u64;
    let mut inserted_count = 0_u64;
    let mut deleted_count = 0_u64;
    let mut new_messages = Vec::new();
    for batch in cached_to_refresh.chunks(FETCH_BATCH_SIZE) {
        let uid_set = batch.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let mut stream = timeout(IMAP_COMMAND_TIMEOUT, session.uid_fetch(uid_set, "(UID FLAGS)"))
            .await.map_err(|_| "读取邮件标记超时".to_string())?
            .map_err(|error| format!("读取邮件标记失败：{error}"))?;
        let mut flags = Vec::with_capacity(batch.len());
        while let Some(fetch) = timeout(IMAP_COMMAND_TIMEOUT, stream.try_next())
            .await.map_err(|_| "读取邮件标记超时".to_string())?
            .map_err(|error| format!("读取邮件标记失败：{error}"))? {
            if let Some(uid) = fetch.uid {
                flags.push((uid, fetch.flags().any(|flag| matches!(flag, Flag::Seen))));
            }
        }
        drop(stream);
        let returned = flags.iter().map(|(uid, _)| *uid).collect::<HashSet<_>>();
        if batch.iter().any(|uid| !returned.contains(uid)) {
            return Err("IMAP 未返回请求的邮件标记，已停止同步。".to_string());
        }
        let transaction = connection.unchecked_transaction()
            .map_err(|error| format!("开始保存邮件标记失败：{error}"))?;
        for (uid, is_read) in flags {
            update_cached_read_flag(&transaction, folder.folder_id, uid, is_read)?;
        }
        transaction.commit().map_err(|error| format!("提交邮件标记失败：{error}"))?;
        fetched_count += batch.len() as u64;
    }
    for batch in full_uids.chunks(FETCH_BATCH_SIZE) {
        let uid_set = batch
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut stream = timeout(IMAP_COMMAND_TIMEOUT, session.uid_fetch(uid_set, IMAP_SUMMARY_QUERY))
            .await.map_err(|_| "读取邮件摘要超时".to_string())?
            .map_err(|error| format!("读取邮件摘要失败：{error}"))?;
        let mut fetched = Vec::with_capacity(batch.len());
        let mut missing_header_uids = Vec::new();
        while let Some(fetch) = timeout(IMAP_COMMAND_TIMEOUT, stream.try_next())
            .await.map_err(|_| "读取邮件摘要超时".to_string())?
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
            let (from_name, from_email) = crate::mail::body::first_header_address(&headers, "From");
            let internal_date = fetch.internal_date().map(|date| date.to_rfc3339());
            fetched.push(FetchedMessage {
                participants: crate::mail::body::parse_participant_headers(&headers),
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
        let returned_uids = fetched.iter().map(|message| message.uid).collect::<HashSet<_>>();
        let missing_count = batch.iter().filter(|uid| !returned_uids.contains(&i64::from(**uid))).count();
        if !missing_header_uids.is_empty() {
            return Err(format!(
                "IMAP 未返回请求的邮件头（{} 封邮件），已停止推进 UID 游标。",
                missing_header_uids.len()
            ));
        }
        if missing_count > 0 {
            return Err(format!("IMAP 未返回请求的邮件摘要（{missing_count} 封邮件），已停止推进 UID 游标。"));
        }
        if let Some(emit) = on_step { emit(account.account_id, "saving", Some(&folder.path)); }
        let result = apply_messages(
            &connection,
            account.account_id,
            folder.folder_id,
            &folder.path,
            &fetched,
            None,
            "imap",
        )?;
        fetched_count += result["fetchedCount"].as_u64().unwrap_or(0);
        inserted_count += result["insertedCount"].as_u64().unwrap_or(0);
        if let Some(messages) = result["newMessages"].as_array() {
            new_messages.extend(messages.iter().cloned());
        }
    }
    if reconcile && !initial_sync {
        let remote_set = remote_uids.into_iter().map(i64::from).collect::<HashSet<_>>();
        let deleted = cached_uids.into_iter()
            .filter(|uid| !remote_set.contains(uid))
            .map(FetchedMessage::deleted)
            .collect::<Vec<_>>();
        for batch in deleted.chunks(FETCH_BATCH_SIZE) {
            let result = apply_messages(&connection, account.account_id, folder.folder_id, &folder.path, batch, None, "imap")?;
            deleted_count += result["deletedCount"].as_u64().unwrap_or(0);
        }
    }
    if full_uids.is_empty() || !cached_to_refresh.is_empty() {
        apply_messages(&connection, account.account_id, folder.folder_id, &folder.path, &[], None, "imap")?;
    }
    if let Some(highest_uid) = full_uids.iter().chain(cached_to_refresh.iter()).max() {
        // Advance only after every requested summary/flag and deletion batch succeeded.
        connection.execute(
            "UPDATE onemail_folder_sync_states SET last_uid=MAX(last_uid,?2) WHERE folder_id=?1",
            params![folder.folder_id, i64::from(*highest_uid)],
        ).map_err(|error| format!("保存文件夹 UID 游标失败：{error}"))?;
    }
    Ok(json!({
        "accountId": account.account_id,
        "folder": folder.path,
        "fetchedCount": fetched_count,
        "scannedCount": fetched_count,
        "insertedCount": inserted_count,
        "newMessageCount": new_messages.len(),
        "newMessages": new_messages,
        "deletedCount": deleted_count,
        "syncPath": "imap",
        "uidValidityReset": uid_validity_reset,
        "ok": true
    }))
}

pub(super) fn update_cached_read_flag(connection: &Connection, folder_id: i64, uid: u32, is_read: bool) -> Result<(), String> {
    connection.execute(
        "UPDATE onemail_mail_messages SET
           is_read=COALESCE(read_state_override,?2),
           read_state_override=CASE WHEN read_state_override=?2 THEN NULL ELSE read_state_override END,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE folder_id=?1 AND uid=?3",
        params![folder_id, is_read, i64::from(uid)],
    ).map_err(|error| format!("保存邮件标记失败：{error}"))?;
    Ok(())
}

fn select_uids_to_fetch(remote_uids: &[u32], last_uid: Option<i64>, reconcile: bool) -> Vec<u32> {
    let initial_sync = last_uid.unwrap_or(0) == 0;
    let mut uids = remote_uids
        .iter()
        // IMAP's `n:*` can include the highest existing UID when n is larger.
        .copied()
        .filter(|uid| initial_sync || last_uid.is_none_or(|last| i64::from(*uid) > last))
        .collect::<Vec<_>>();
    if initial_sync && uids.len() > MAX_MESSAGES {
        uids = uids.split_off(uids.len() - MAX_MESSAGES);
    } else if reconcile {
        uids.extend(remote_uids.iter().rev().take(MAX_MESSAGES).copied());
        uids.sort_unstable();
        uids.dedup();
    }
    uids
}

fn partition_cached_uids(uids: Vec<u32>, cached_uids: &HashSet<i64>) -> (Vec<u32>, Vec<u32>) {
    uids.into_iter().partition(|uid| cached_uids.contains(&i64::from(*uid)))
}

fn metadata_looks_complete(subject: Option<&str>, from_email: Option<&str>, message_id: Option<&str>) -> bool {
    [subject, from_email, message_id].into_iter().flatten().any(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::{metadata_looks_complete, new_inbox_messages_since_connection, partition_cached_uids, select_uids_to_fetch};
    use rusqlite::Connection;
    use std::collections::HashSet;

    #[test]
    fn initial_sync_fetches_only_latest_200() {
        let remote = (1..=250).collect::<Vec<_>>();
        assert_eq!(select_uids_to_fetch(&remote, None, true), (51..=250).collect::<Vec<_>>());
    }

    #[test]
    fn full_sync_fetches_new_and_recent_uids() {
        let remote = (1..=250).collect::<Vec<_>>();
        assert_eq!(select_uids_to_fetch(&remote, Some(249), true), (51..=250).collect::<Vec<_>>());
    }

    #[test]
    fn inbox_refresh_fetches_only_new_uids() {
        let remote = vec![249, 250];
        assert_eq!(select_uids_to_fetch(&remote, Some(249), false), vec![250]);
        assert!(select_uids_to_fetch(&remote, Some(250), false).is_empty());
    }

    #[test]
    fn cached_messages_need_flags_but_new_or_deleted_messages_need_headers() {
        let cached = HashSet::from([10_i64, 12]);
        let (flags, headers) = partition_cached_uids(vec![10, 11, 12, 13], &cached);
        assert_eq!(flags, vec![10, 12]);
        assert_eq!(headers, vec![11, 13]);
    }

    #[test]
    fn blank_subject_does_not_force_header_refetch_when_sender_is_present() {
        assert!(metadata_looks_complete(Some(""), Some("sender@example.com"), None));
        assert!(!metadata_looks_complete(Some("  "), None, Some("")));
    }

    #[test]
    fn failed_sync_recovers_only_new_inbox_messages() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE onemail_mail_folders(folder_id INTEGER PRIMARY KEY,path TEXT);
             CREATE TABLE onemail_mail_messages(
               message_id INTEGER PRIMARY KEY,account_id INTEGER,folder_id INTEGER,
               subject TEXT,from_name TEXT,from_email TEXT,received_at TEXT,snippet TEXT,
               remote_deleted INTEGER
             );
             INSERT INTO onemail_mail_folders VALUES (1,'INBOX'),(2,'Archive');
             INSERT INTO onemail_mail_messages(message_id,account_id,folder_id,subject,remote_deleted) VALUES
               (10,1,1,'Old',0),(11,1,1,'New',0),(12,1,2,'Archived',0),
               (13,1,1,'Removed',1),(14,2,1,'Another account',0);",
        ).unwrap();
        let messages = new_inbox_messages_since_connection(&connection, 1, 10).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["messageId"], 11);
        assert_eq!(messages[0]["subject"], "New");
    }
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

pub(super) fn uid_validity_changed(previous: Option<&str>, current: Option<&str>) -> bool {
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
