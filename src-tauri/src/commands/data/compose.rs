use std::fs;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{db, smtp_send, state::AppState};

use super::{
    messages::get_message_detail,
    utils::{database_error, optional_i64, optional_string, require_object, required_i64},
};

#[tauri::command]
pub async fn compose_select_attachments(app: AppHandle) -> Result<Value, String> {
    let Some(files) = app.dialog().file().blocking_pick_files() else {
        return Ok(json!([]));
    };
    let mut attachments = Vec::new();
    for file in files {
        let path = file
            .into_path()
            .map_err(|error| format!("无法读取附件路径：{error}"))?;
        let metadata = fs::metadata(&path).map_err(|error| format!("读取附件失败：{error}"))?;
        if !metadata.is_file() {
            return Err(format!("附件不是普通文件：{}", path.display()));
        }
        attachments.push(json!({
            "filePath": path.to_string_lossy(),
            "filename": path.file_name().and_then(|name| name.to_str()).unwrap_or("attachment"),
            "sizeBytes": metadata.len()
        }));
    }
    Ok(Value::Array(attachments))
}

#[tauri::command]
pub fn compose_list_outbox(
    state: State<'_, AppState>,
    query: Option<Value>,
) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let statuses = query
        .as_ref()
        .and_then(|value| value.get("statuses"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let limit = query
        .as_ref()
        .and_then(|value| value.get("limit"))
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .clamp(1, 200);
    let mut where_clause = "status!='deleted'".to_string();
    let mut values: Vec<SqlValue> = Vec::new();
    if !statuses.is_empty() {
        where_clause = format!(
            "status IN ({})",
            std::iter::repeat("?")
                .take(statuses.len())
                .collect::<Vec<_>>()
                .join(",")
        );
        for status in statuses {
            if let Some(status) = status.as_str() {
                values.push(status.to_string().into());
            }
        }
    }
    values.push(limit.into());
    let sql = format!(
        "SELECT outbox_id,account_id,related_message_id,compose_kind,status,
                rfc822_message_id,from_name,from_email,to_json,cc_json,bcc_json,
                subject,body_text,body_html,in_reply_to,references_header,sent_at,
                deleted_at,last_error,last_warning,created_at,updated_at
         FROM onemail_outbox_messages WHERE {where_clause}
         ORDER BY updated_at DESC LIMIT ?"
    );
    let mut statement = connection.prepare(&sql).map_err(database_error)?;
    let mut rows = statement
        .query_map(params_from_iter(values.iter()), map_outbox)
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    for row in &mut rows {
        if let Some(outbox_id) = row.get("outboxId").and_then(Value::as_i64) {
            row["attachments"] = list_outbox_attachments(&connection, outbox_id)?;
        }
    }
    Ok(Value::Array(rows))
}

#[tauri::command]
pub fn compose_save_draft(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    save_draft(&state, input)
}

fn save_draft(state: &AppState, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let account_id = required_i64(object, "accountId", "账号 ID 无效。")?;
    let compose_kind = optional_string(object, "mode").unwrap_or_else(|| "new".to_string());
    let related_message_id = optional_i64(object, "relatedMessageId");
    let to_json = serde_json::to_string(object.get("to").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let cc_json = serde_json::to_string(object.get("cc").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let bcc_json = serde_json::to_string(object.get("bcc").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let mut database = db::open(state)?;
    let connection = database.transaction().map_err(database_error)?;
    let from_email: String = connection
        .query_row(
            "SELECT email FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|_| "账号不存在。".to_string())?;
    let outbox_id = optional_i64(object, "outboxId");
    if let Some(outbox_id) = outbox_id {
        connection
            .execute(
                "UPDATE onemail_outbox_messages SET compose_kind=?2,related_message_id=?3,
                  to_json=?4,cc_json=?5,bcc_json=?6,subject=?7,body_text=?8,body_html=?9,
                  in_reply_to=?10,references_header=?11,account_id=?12,from_email=?13,status='draft',
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE outbox_id=?1",
                params![
                    outbox_id,
                    compose_kind,
                    related_message_id,
                    to_json,
                    cc_json,
                    bcc_json,
                    optional_string(object, "subject"),
                    optional_string(object, "bodyText"),
                    optional_string(object, "bodyHtml"),
                    optional_string(object, "inReplyTo"),
                    optional_string(object, "referencesHeader"),
                    account_id,
                    from_email
                ],
            )
            .map_err(database_error)?;
    } else {
        let message_id = format!(
            "<{}.{}@onemail.local>",
            chrono::Utc::now().timestamp_millis(),
            account_id
        );
        connection
            .execute(
                "INSERT INTO onemail_outbox_messages (
                  account_id,related_message_id,compose_kind,status,rfc822_message_id,
                  from_email,to_json,cc_json,bcc_json,subject,body_text,body_html,
                  in_reply_to,references_header
                 ) VALUES (?1,?2,?3,'draft',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    account_id,
                    related_message_id,
                    compose_kind,
                    message_id,
                    from_email,
                    to_json,
                    cc_json,
                    bcc_json,
                    optional_string(object, "subject"),
                    optional_string(object, "bodyText"),
                    optional_string(object, "bodyHtml"),
                    optional_string(object, "inReplyTo"),
                    optional_string(object, "referencesHeader")
                ],
            )
            .map_err(database_error)?;
    }
    let id = outbox_id.unwrap_or_else(|| connection.last_insert_rowid());
    if let Some(attachments) = object.get("attachments").and_then(Value::as_array) {
        connection.execute("DELETE FROM onemail_outbox_attachments WHERE outbox_id=?1", [id])
            .map_err(database_error)?;
        for attachment in attachments {
            let attachment = require_object(attachment)?;
            let path = optional_string(attachment, "filePath")
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| "附件路径不能为空。".to_string())?;
            connection.execute(
                "INSERT INTO onemail_outbox_attachments
                   (outbox_id,source_kind,file_path,filename,mime_type,size_bytes)
                 VALUES (?1,'local_file',?2,?3,?4,?5)",
                params![id, path,
                    optional_string(attachment, "filename").or_else(|| optional_string(attachment, "name"))
                        .unwrap_or_else(|| "attachment".to_string()),
                    optional_string(attachment, "mimeType"),
                    optional_i64(attachment, "sizeBytes").unwrap_or(0).max(0)],
            ).map_err(database_error)?;
        }
    }
    let result = get_outbox(&connection, id)?.ok_or_else(|| "保存草稿后无法读取记录。".to_string())?;
    connection.commit().map_err(database_error)?;
    Ok(result)
}

#[tauri::command]
pub fn compose_delete_draft(state: State<'_, AppState>, outbox_id: i64) -> Result<bool, String> {
    delete_outbox(&state, outbox_id)
}

#[tauri::command]
pub fn compose_delete_outbox(state: State<'_, AppState>, outbox_id: i64) -> Result<bool, String> {
    delete_outbox(&state, outbox_id)
}

#[tauri::command]
pub fn compose_create_reply_draft(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    create_related_draft(&state, &input, false)
}

#[tauri::command]
pub fn compose_create_forward_draft(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    create_related_draft(&state, &input, true)
}

#[tauri::command]
pub async fn compose_send(app: AppHandle, state: State<'_, AppState>, mut input: Value) -> Result<Value, String> {
    let saved = save_draft(&state, input.clone())?;
    input["outboxId"] = saved["outboxId"].clone();
    input["rfc822MessageId"] = saved["rfc822MessageId"].clone();
    input["attachments"] = saved["attachments"].clone();
    let mut result = smtp_send::send_message(&state, input).await?;
    result["accountId"] = saved["accountId"].clone();
    let _ = app.emit("compose/sent", &result);
    Ok(result)
}

#[tauri::command]
pub async fn compose_retry(app: AppHandle, state: State<'_, AppState>, outbox_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let outbox = get_outbox(&connection, outbox_id)?
        .ok_or_else(|| format!("发信记录不存在：{outbox_id}"))?;
    drop(connection);
    let account_id = outbox["accountId"].clone();
    let mut result = smtp_send::send_message(&state, outbox).await?;
    result["accountId"] = account_id;
    let _ = app.emit("compose/sent", &result);
    Ok(result)
}

fn map_outbox(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let parse_json = |value: String| serde_json::from_str::<Value>(&value).unwrap_or(json!([]));
    Ok(json!({
        "outboxId": row.get::<_, i64>(0)?,
        "accountId": row.get::<_, i64>(1)?,
        "relatedMessageId": row.get::<_, Option<i64>>(2)?,
        "composeKind": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "rfc822MessageId": row.get::<_, String>(5)?,
        "from": {
            "name": row.get::<_, Option<String>>(6)?,
            "email": row.get::<_, String>(7)?
        },
        "to": parse_json(row.get::<_, String>(8)?),
        "cc": parse_json(row.get::<_, String>(9)?),
        "bcc": parse_json(row.get::<_, String>(10)?),
        "subject": row.get::<_, Option<String>>(11)?,
        "bodyText": row.get::<_, Option<String>>(12)?,
        "bodyHtml": row.get::<_, Option<String>>(13)?,
        "inReplyTo": row.get::<_, Option<String>>(14)?,
        "referencesHeader": row.get::<_, Option<String>>(15)?,
        "sentAt": row.get::<_, Option<String>>(16)?,
        "deletedAt": row.get::<_, Option<String>>(17)?,
        "lastError": row.get::<_, Option<String>>(18)?,
        "lastWarning": row.get::<_, Option<String>>(19)?,
        "createdAt": row.get::<_, String>(20)?,
        "updatedAt": row.get::<_, String>(21)?
    }))
}

fn get_outbox(connection: &Connection, outbox_id: i64) -> Result<Option<Value>, String> {
    let mut outbox = connection
        .query_row(
            "SELECT outbox_id,account_id,related_message_id,compose_kind,status,
                    rfc822_message_id,from_name,from_email,to_json,cc_json,bcc_json,
                    subject,body_text,body_html,in_reply_to,references_header,sent_at,
                    deleted_at,last_error,last_warning,created_at,updated_at
             FROM onemail_outbox_messages WHERE outbox_id=?1",
            [outbox_id],
            map_outbox,
        )
        .optional()
        .map_err(database_error)?;
    if let Some(outbox) = outbox.as_mut() {
        outbox["attachments"] = list_outbox_attachments(connection, outbox_id)?;
    }
    Ok(outbox)
}

fn list_outbox_attachments(connection: &Connection, outbox_id: i64) -> Result<Value, String> {
    let mut statement = connection.prepare(
        "SELECT file_path,filename,mime_type,size_bytes FROM onemail_outbox_attachments
         WHERE outbox_id=?1 ORDER BY attachment_id",
    ).map_err(database_error)?;
    let attachments = statement.query_map([outbox_id], |row| Ok(json!({
        "filePath": row.get::<_, Option<String>>(0)?,
        "filename": row.get::<_, String>(1)?,
        "mimeType": row.get::<_, Option<String>>(2)?,
        "sizeBytes": row.get::<_, i64>(3)?
    }))).map_err(database_error)?.collect::<Result<Vec<_>, _>>().map_err(database_error)?;
    Ok(Value::Array(attachments))
}

fn delete_outbox(state: &AppState, outbox_id: i64) -> Result<bool, String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_outbox_messages SET status='deleted',
              deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE outbox_id=?1",
            [outbox_id],
        )
        .map(|changes| changes > 0)
        .map_err(database_error)
}

fn create_related_draft(state: &AppState, input: &Value, forward: bool) -> Result<Value, String> {
    let object = require_object(input)?;
    let message_id = required_i64(object, "messageId", "邮件 ID 无效。")?;
    let connection = db::open(state)?;
    let detail =
        get_message_detail(&connection, message_id)?.ok_or_else(|| "原邮件不存在。".to_string())?;
    let detail_object = require_object(&detail)?;
    let subject = optional_string(detail_object, "subject").unwrap_or_default();
    let account_id = optional_i64(detail_object, "accountId").unwrap_or_default();
    let from_email = optional_string(detail_object, "fromEmail").unwrap_or_default();
    crate::mail_body::participants_need_repair(&connection, message_id)?;
    let mut accounts = connection.prepare("SELECT LOWER(TRIM(email)) FROM onemail_mail_accounts")
        .map_err(database_error)?;
    let own_addresses = accounts.query_map([], |row| row.get::<_, String>(0))
        .map_err(database_error)?.collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(database_error)?;
    let outgoing = own_addresses.contains(&from_email.trim().to_lowercase());
    let mode = optional_string(object, "mode")
        .unwrap_or_else(|| if forward { "forward" } else { "reply" }.to_string());
    let next_subject = if forward {
        format_subject("Fwd:", &subject)
    } else {
        format_subject("Re:", &subject)
    };
    let mut to = Vec::new();
    let mut cc = Vec::new();
    let mut seen = own_addresses;
    if !forward {
        let mut statement = connection.prepare(
            "SELECT kind,name,email FROM onemail_message_addresses WHERE message_id=?1
             ORDER BY sort_order,address_id",
        ).map_err(database_error)?;
        let addresses = statement.query_map([message_id], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?,
        ))).map_err(database_error)?.collect::<Result<Vec<_>, _>>().map_err(database_error)?;
        let target_kind = if outgoing { "to" }
            else if addresses.iter().any(|address| address.0 == "reply_to") { "reply_to" }
            else { "from" };
        let mut add = |kind: &str, target: &mut Vec<Value>| {
            for (_, name, email) in addresses.iter().filter(|address| address.0 == kind) {
                if seen.insert(email.trim().to_lowercase()) {
                    target.push(json!({ "name": name, "email": email }));
                }
            }
        };
        add(target_kind, &mut to);
        if mode == "reply_all" {
            add("to", &mut to);
            add("cc", &mut cc);
        }
        if target_kind == "from" && to.is_empty() && !from_email.trim().is_empty()
            && seen.insert(from_email.trim().to_lowercase()) {
            to.push(json!({ "email": from_email }));
        }
    }
    let in_reply_to = (!forward).then(|| optional_string(detail_object, "messageRfc822Id")).flatten();
    let references = if forward { None } else {
        let mut references = optional_string(detail_object, "references").unwrap_or_default();
        if let Some(message_id) = in_reply_to.as_deref() {
            if !references.split_whitespace().any(|reference| reference == message_id) {
                if !references.is_empty() { references.push(' '); }
                references.push_str(message_id);
            }
        }
        (!references.is_empty()).then_some(references)
    };
    Ok(json!({
        "accountId": account_id,
        "mode": mode,
        "relatedMessageId": message_id,
        "to": to,
        "cc": cc,
        "bcc": [],
        "subject": next_subject,
        "inReplyTo": in_reply_to,
        "referencesHeader": references,
        "bodyText": "",
        "bodyHtml": null
    }))
}

fn format_subject(prefix: &str, subject: &str) -> String {
    if subject.to_lowercase().starts_with(&prefix.to_lowercase()) {
        subject.to_string()
    } else {
        format!("{prefix} {subject}").trim().to_string()
    }
}
