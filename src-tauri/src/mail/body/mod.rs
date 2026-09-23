mod format;
mod participants;

pub(crate) use format::html_to_text;
use format::{normalize_body_text, sanitize_html};

pub(crate) use participants::{first_header_address, parse_participant_headers, participants_need_repair, persist_participants, ParticipantHeader};

use mailparse::{
    parse_mail, DispositionType, MailHeader, MailHeaderMap, ParsedMail,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::{
    db,
    mail::transport::{self as mail_transport, MailAccount},
    state::AppState,
};

#[derive(Default)]
struct ParsedMessageBody {
    raw_headers: String,
    headers: ParsedMessageHeaders,
    text: Option<String>,
    html: Option<String>,
    attachments: Vec<ParsedAttachment>,
}

#[derive(Default)]
struct ParsedMessageHeaders {
    subject: Option<String>,
    message_id: Option<String>,
    from_name: Option<String>,
    from_email: Option<String>,
    received_at: Option<String>,
    in_reply_to: Option<String>,
    references_header: Option<String>,
    participants: Vec<ParticipantHeader>,
}

struct ParsedAttachment {
    filename: String,
    mime_type: String,
    disposition: String,
    size_bytes: usize,
}

pub async fn load_message_body(state: &AppState, message_id: i64) -> Result<Value, String> {
    let locator = get_message_locator(state, message_id)?
        .ok_or_else(|| format!("邮件不存在：{message_id}"))?;
    set_body_status(state, message_id, "loading", None)?;

    let result = async {
        let raw_message = mail_transport::fetch_raw_message(
            state,
            &locator.account,
            &locator.folder_path,
            locator.uid,
        )
        .await?;
        let parsed = parse_message(&raw_message)?;
        persist_message_body(state, message_id, locator.account.account_id, parsed)
    }
    .await;

    if let Err(error) = &result {
        let _ = set_body_status(state, message_id, "error", Some(error));
    }
    result
}

pub async fn repair_message_metadata(state: &AppState, message_id: i64) -> Result<(), String> {
    let locator = get_message_locator(state, message_id)?
        .ok_or_else(|| format!("邮件不存在：{message_id}"))?;
    let raw_message = mail_transport::fetch_raw_message(
        state,
        &locator.account,
        &locator.folder_path,
        locator.uid,
    )
    .await?;
    let parsed = parse_message(&raw_message)?;
    persist_message_body(state, message_id, locator.account.account_id, parsed).map(|_| ())
}

struct MessageLocator {
    account: MailAccount,
    folder_path: String,
    uid: u32,
}

fn get_message_locator(
    state: &AppState,
    message_id: i64,
) -> Result<Option<MessageLocator>, String> {
    let connection = db::open(state)?;
    connection
        .query_row(
            "SELECT f.path,m.uid,m.account_id
             FROM onemail_mail_messages m
             JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
             WHERE m.message_id=?1",
            [message_id],
            |row| {
                let uid = row.get::<_, i64>(1)?;
                Ok((row.get::<_, String>(0)?, uid, row.get::<_, i64>(2)?))
            },
        )
        .optional()
        .map_err(|error| format!("读取邮件定位信息失败：{error}"))?
        .map(|(folder_path, uid, account_id)| {
            let account = mail_transport::load_account(state, account_id)?;
            Ok(MessageLocator {
                account,
                folder_path,
                uid: u32::try_from(uid).map_err(|_| "邮件 UID 无效。".to_string())?,
            })
        })
        .transpose()
}

fn set_body_status(
    state: &AppState,
    message_id: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_messages
             SET body_status=?2,body_error=?3,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE message_id=?1",
            params![message_id, status, error],
        )
        .map(|_| ())
        .map_err(|error| format!("更新正文状态失败：{error}"))
}

fn parse_message(raw_message: &[u8]) -> Result<ParsedMessageBody, String> {
    let parsed = parse_mail(raw_message).map_err(|error| format!("解析邮件正文失败：{error}"))?;
    let headers = parse_message_headers(&parsed.headers);
    let mut leaves = Vec::new();
    collect_leaf_parts(&parsed, &mut leaves);
    let text = leaves
        .iter()
        .filter(|part| is_message_body_part(part, "text/plain"))
        .find_map(|part| decode_text_part(part));
    let html = leaves
        .iter()
        .filter(|part| is_message_body_part(part, "text/html"))
        .find_map(|part| decode_text_part(part));
    let attachments = leaves
        .iter()
        .filter_map(|part| {
            let disposition = part.get_content_disposition();
            let disposition_name = match disposition.disposition {
                DispositionType::Attachment => "attachment",
                DispositionType::Inline => "inline",
                _ => return None,
            };
            let filename = disposition
                .params
                .get("filename")
                .or_else(|| part.ctype.params.get("name"))?
                .trim()
                .to_string();
            if filename.is_empty() {
                return None;
            }
            let size_bytes = part.get_body_raw().ok()?.len();
            Some(ParsedAttachment {
                filename,
                mime_type: part.ctype.mimetype.clone(),
                disposition: disposition_name.to_string(),
                size_bytes,
            })
        })
        .collect();

    Ok(ParsedMessageBody {
        raw_headers: parsed.headers.iter().map(|header| format!("{}: {}\r\n", header.get_key(), header.get_value())).collect(),
        headers,
        text,
        html,
        attachments,
    })
}

fn parse_message_headers(headers: &[MailHeader<'_>]) -> ParsedMessageHeaders {
    let (from_name, from_email) = first_header_address(headers, "From");

    ParsedMessageHeaders {
        subject: non_empty_header(headers, "Subject"),
        message_id: non_empty_header(headers, "Message-ID"),
        from_name,
        from_email,
        received_at: non_empty_header(headers, "Date"),
        in_reply_to: non_empty_header(headers, "In-Reply-To"),
        references_header: non_empty_header(headers, "References"),
        participants: parse_participant_headers(headers),
    }
}

fn non_empty_header(headers: &[MailHeader<'_>], name: &str) -> Option<String> {
    headers
        .get_first_value(name)
        .map(|value| value.replace('\0', "").trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_message_body_part(part: &ParsedMail<'_>, mime_type: &str) -> bool {
    if !part.ctype.mimetype.eq_ignore_ascii_case(mime_type) {
        return false;
    }
    let disposition = part.get_content_disposition();
    if matches!(disposition.disposition, DispositionType::Attachment) {
        return false;
    }
    !disposition.params.contains_key("filename") && !part.ctype.params.contains_key("name")
}

fn decode_text_part(part: &ParsedMail<'_>) -> Option<String> {
    part.get_body()
        .ok()
        .or_else(|| {
            part.get_body_raw()
                .ok()
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .map(|value| value.replace('\0', ""))
        .filter(|value| !value.trim().is_empty())
}

fn collect_leaf_parts<'a>(part: &'a ParsedMail<'a>, leaves: &mut Vec<&'a ParsedMail<'a>>) {
    if part.subparts.is_empty() {
        leaves.push(part);
        return;
    }
    for child in &part.subparts {
        collect_leaf_parts(child, leaves);
    }
}

fn persist_message_body(
    state: &AppState,
    message_id: i64,
    account_id: i64,
    parsed: ParsedMessageBody,
) -> Result<Value, String> {
    let body_text = parsed
        .text
        .as_deref()
        .map(normalize_body_text)
        .filter(|value| !value.is_empty());
    let body_html = parsed.html.as_deref().and_then(sanitize_html);
    let search_text = body_text
        .as_deref()
        .map(str::to_string)
        .or_else(|| body_html.as_deref().map(html_to_text))
        .unwrap_or_default();
    let snippet = build_snippet(&search_text);
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_message_bodies
               (message_id,body_text,body_html_sanitized,external_images_blocked,sanitized_at)
             VALUES (?1,?2,?3,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(message_id) DO UPDATE SET
               body_text=excluded.body_text,body_html_sanitized=excluded.body_html_sanitized,
               external_images_blocked=excluded.external_images_blocked,
               sanitized_at=excluded.sanitized_at,loaded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![message_id, body_text, body_html],
        )
        .map_err(|error| format!("保存邮件正文失败：{error}"))?;
    connection
        .execute(
            "DELETE FROM onemail_message_attachments WHERE message_id=?1",
            [message_id],
        )
        .map_err(|error| format!("更新附件信息失败：{error}"))?;
    for attachment in &parsed.attachments {
        connection
            .execute(
                "INSERT INTO onemail_message_attachments
                   (message_id,filename,mime_type,content_disposition,size_bytes)
                 VALUES (?1,?2,?3,?4,?5)",
                params![
                    message_id,
                    attachment.filename,
                    attachment.mime_type,
                    attachment.disposition,
                    attachment.size_bytes as i64
                ],
            )
            .map_err(|error| format!("保存附件信息失败：{error}"))?;
    }
    connection
        .execute(
            "UPDATE onemail_mail_messages SET has_attachments=?2,body_status='ready',
               body_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE message_id=?1",
            params![
                message_id,
                if parsed.attachments.is_empty() {
                    0_i64
                } else {
                    1_i64
                }
            ],
        )
        .map_err(|error| format!("更新正文状态失败：{error}"))?;

    persist_message_headers(&connection, message_id, &parsed.headers, snippet.as_deref())?;
    persist_participants(&connection, message_id, &parsed.headers.participants)?;
    connection.execute(
        "UPDATE onemail_mail_messages SET raw_headers=?2 WHERE message_id=?1",
        params![message_id, parsed.raw_headers],
    ).map_err(|error| format!("保存原始邮件头失败：{error}"))?;
    update_search_index(&connection, message_id, account_id, &search_text)?;

    Ok(json!({
        "messageId": message_id,
        "bodyText": body_text,
        "bodyHtmlSanitized": body_html,
        "externalImagesBlocked": true
    }))
}

fn persist_message_headers(
    connection: &rusqlite::Connection,
    message_id: i64,
    headers: &ParsedMessageHeaders,
    snippet: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE onemail_mail_messages SET
               rfc822_message_id=COALESCE(NULLIF(TRIM(rfc822_message_id),''),?2),
               in_reply_to=COALESCE(NULLIF(TRIM(in_reply_to),''),?3),
               references_header=COALESCE(NULLIF(TRIM(references_header),''),?4),
               subject=COALESCE(NULLIF(TRIM(subject),''),?5),
               from_name=COALESCE(NULLIF(TRIM(from_name),''),?6),
               from_email=COALESCE(NULLIF(TRIM(from_email),''),?7),
               received_at=COALESCE(NULLIF(TRIM(received_at),''),?8),
               snippet=COALESCE(NULLIF(TRIM(snippet),''),?9),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE message_id=?1",
            params![
                message_id,
                headers.message_id,
                headers.in_reply_to,
                headers.references_header,
                headers.subject,
                headers.from_name,
                headers.from_email,
                headers.received_at,
                snippet,
            ],
        )
        .map_err(|error| format!("回填邮件摘要失败：{error}"))?;
    Ok(())
}

fn build_snippet(value: &str) -> Option<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let snippet = value.chars().take(240).collect::<String>();
    (!snippet.is_empty()).then_some(snippet)
}

fn update_search_index(
    connection: &rusqlite::Connection,
    message_id: i64,
    account_id: i64,
    body_text: &str,
) -> Result<(), String> {
    let metadata = connection
        .query_row(
            "SELECT folder_id,subject,from_name,from_email,snippet
             FROM onemail_mail_messages WHERE message_id=?1",
            [message_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ))
            },
        )
        .map_err(|error| format!("读取搜索索引信息失败：{error}"))?;
    connection
        .execute(
            "DELETE FROM onemail_message_search WHERE message_id=?1",
            [message_id],
        )
        .map_err(|error| format!("更新搜索索引失败：{error}"))?;
    connection
        .execute(
            "INSERT INTO onemail_message_search
               (message_id,account_id,folder_id,subject,from_name,from_email,snippet,body_text)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                message_id, account_id, metadata.0, metadata.1, metadata.2, metadata.3, metadata.4,
                body_text
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("更新搜索索引失败：{error}"))
}

#[cfg(test)]
mod tests;
