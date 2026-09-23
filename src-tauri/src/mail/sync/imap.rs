use async_imap::types::{Flag, Mailbox};
use futures_util::TryStreamExt;
use mailparse::MailHeaderMap;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use super::{apply_messages, ensure_inbox, FetchedMessage};
use crate::{db, mail::transport as mail_transport, state::AppState};

const MAX_MESSAGES: usize = 200;
pub(super) const IMAP_SUMMARY_QUERY: &str =
    "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])";

pub(super) async fn sync_account_imap(
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
