use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::super::utils::database_error;

pub(super) fn map_message_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "messageId": row.get::<_, i64>(0)?,
        "accountId": row.get::<_, i64>(1)?,
        "folderId": row.get::<_, i64>(2)?,
        "folderRole": row.get::<_, Option<String>>(3)?,
        "folderName": row.get::<_, Option<String>>(4)?,
        "messageRfc822Id": row.get::<_, Option<String>>(5)?,
        "references": row.get::<_, Option<String>>(6)?,
        "subject": row.get::<_, Option<String>>(7)?,
        "fromName": row.get::<_, Option<String>>(8)?,
        "fromEmail": row.get::<_, Option<String>>(9)?,
        "receivedAt": row.get::<_, Option<String>>(10)?,
        "snippet": row.get::<_, Option<String>>(11)?,
        "isRead": row.get::<_, i64>(12)? != 0,
        "isStarred": row.get::<_, i64>(13)? != 0,
        "hasAttachments": row.get::<_, i64>(14)? != 0,
        "bodyStatus": row.get::<_, String>(15)?,
        "bodyError": row.get::<_, Option<String>>(16)?
    }))
}

pub(super) fn message_has_cached_body_but_missing_headers(message: &Value) -> bool {
    let has_cached_body = message.get("body").is_some_and(|body| !body.is_null());
    let has_subject = message
        .get("subject")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let has_sender = ["fromName", "fromEmail"].into_iter().any(|key| {
        message
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    });
    has_cached_body && !has_subject && !has_sender
}

pub(crate) fn get_message_detail(
    connection: &Connection,
    message_id: i64,
) -> Result<Option<Value>, String> {
    let summary = connection
        .query_row(
            "SELECT m.message_id,m.account_id,m.folder_id,f.role,f.name,
                    m.rfc822_message_id,m.references_header,m.subject,m.from_name,m.from_email,
                    m.received_at,m.snippet,m.is_read,m.is_starred,m.has_attachments,m.body_status,m.body_error,m.size_bytes
             FROM onemail_mail_messages m
             JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
             WHERE m.message_id=?1",
            [message_id],
            |row| {
                let mut summary = map_message_summary(row)?;
                summary["sizeBytes"] = json!(row.get::<_, i64>(17)?);
                Ok(summary)
            },
        )
        .optional()
        .map_err(database_error)?;
    let Some(mut detail) = summary else {
        return Ok(None);
    };

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

    let mut attachment_statement = connection
        .prepare(
            "SELECT attachment_id,filename,mime_type,content_disposition,size_bytes
             FROM onemail_message_attachments WHERE message_id=?1 ORDER BY attachment_id",
        )
        .map_err(database_error)?;
    let attachments = attachment_statement
        .query_map([message_id], |row| {
            Ok(json!({
                "attachmentId": row.get::<_, i64>(0)?,
                "filename": row.get::<_, String>(1)?,
                "mimeType": row.get::<_, Option<String>>(2)?,
                "contentDisposition": row.get::<_, Option<String>>(3)?,
                "sizeBytes": row.get::<_, i64>(4)?
            }))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;

    if let Some(object) = detail.as_object_mut() {
        object.insert("body".to_string(), body.unwrap_or(Value::Null));
        object.insert("attachments".to_string(), Value::Array(attachments));
        for (kind, property) in [("to", "to"), ("cc", "cc"), ("reply_to", "replyTo")] {
            if let Some(value) = list_address_text(connection, message_id, kind)? {
                object.insert(property.to_string(), Value::String(value));
            }
        }
    }
    Ok(Some(detail))
}

fn list_address_text(
    connection: &Connection,
    message_id: i64,
    kind: &str,
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT name,email FROM onemail_message_addresses
             WHERE message_id=?1 AND kind=?2 ORDER BY sort_order,address_id",
        )
        .map_err(database_error)?;
    let values = statement
        .query_map(params![message_id, kind], |row| {
            let name: Option<String> = row.get(0)?;
            let email: String = row.get(1)?;
            Ok(match name.filter(|value| !value.is_empty()) {
                Some(name) => format!("{name} <{email}>"),
                None => email,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok((!values.is_empty()).then(|| values.join(", ")))
}
