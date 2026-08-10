use mailparse::{
    addrparse_header, parse_mail, DispositionType, MailAddr, MailHeader, MailHeaderMap, ParsedMail,
};
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::{
    db,
    mail_transport::{self, MailAccount},
    state::AppState,
};

#[derive(Default)]
struct ParsedMessageBody {
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
    }
}

pub(crate) fn first_header_address(
    headers: &[MailHeader<'_>],
    header_name: &str,
) -> (Option<String>, Option<String>) {
    let Some(header) = headers.get_first_header(header_name) else {
        return (None, None);
    };
    if let Ok(addresses) = addrparse_header(header) {
        for address in addresses.iter() {
            let address = match address {
                MailAddr::Single(address) => Some(address),
                MailAddr::Group(group) => group.addrs.first(),
            };
            if let Some(address) = address {
                let name = address
                    .display_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string);
                let email = address.addr.trim().to_string();
                if !email.is_empty() {
                    return (name, Some(email));
                }
            }
        }
    }
    parse_loose_address(&header.get_value())
}

fn non_empty_header(headers: &[MailHeader<'_>], name: &str) -> Option<String> {
    headers
        .get_first_value(name)
        .map(|value| value.replace('\0', "").trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_loose_address(value: &str) -> (Option<String>, Option<String>) {
    let value = value.trim();
    let (name, email) = if let Some(start) = value.rfind('<') {
        let Some(end) = value[start + 1..].find('>').map(|end| end + start + 1) else {
            return (None, None);
        };
        (
            value[..start].trim().trim_matches('"').trim().to_string(),
            value[start + 1..end].trim().to_string(),
        )
    } else {
        (String::new(), value.to_string())
    };
    if !email.contains('@') {
        return (None, None);
    }
    ((!name.is_empty()).then_some(name), Some(email))
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

fn normalize_body_text(value: &str) -> String {
    value
        .replace('\0', "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn sanitize_html(value: &str) -> Option<String> {
    let mut sanitized = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .expect("valid script regex")
        .replace_all(value, "")
        .into_owned();
    sanitized = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .expect("valid style regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .expect("valid event regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+(src|href)\s*=\s*"javascript:[^"]*""#)
        .expect("valid javascript regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+src="((?:https?:)?//[^"\s>]+)""#)
        .expect("valid remote source regex")
        .replace_all(&sanitized, r#" data-blocked-src="$1""#)
        .into_owned();
    sanitized = Regex::new(r"(?i)\s+src='((?:https?:)?//[^'\s>]+)'")
        .expect("valid remote source regex")
        .replace_all(&sanitized, " data-blocked-src='$1'")
        .into_owned();
    let sanitized = sanitized.trim().to_string();
    (!sanitized.is_empty()).then_some(sanitized)
}

pub(crate) fn html_to_text(value: &str) -> String {
    Regex::new(r"(?is)<[^>]+>")
        .expect("valid html regex")
        .replace_all(value, " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{parse_message, persist_message_headers};
    use rusqlite::Connection;

    const RAW_MESSAGE: &[u8] = concat!(
        "Subject: =?UTF-8?B?5rWL6K+V5Li76aKY?=\r\n",
        "Message-ID: <message@example.com>\r\n",
        "From: =?UTF-8?B?5rWL6K+V5Y+R5Lu25Lq6?= <sender@example.com>\r\n",
        "To: Owner <owner@example.com>, second@example.com\r\n",
        "Date: Sat, 9 Aug 2026 12:00:00 +0000\r\n",
        "Content-Type: multipart/alternative; boundary=mail-boundary\r\n",
        "\r\n",
        "--mail-boundary\r\n",
        "Content-Type: text/plain; charset=utf-8\r\n",
        "Content-Transfer-Encoding: base64\r\n",
        "\r\n",
        "6L+Z5piv6YKu5Lu25q2j5paH44CC\r\n",
        "--mail-boundary\r\n",
        "Content-Type: text/html; charset=utf-8\r\n",
        "\r\n",
        "<p>这是邮件正文。</p>\r\n",
        "--mail-boundary--\r\n"
    )
    .as_bytes();

    #[test]
    fn parses_encoded_headers_addresses_and_multipart_body() {
        let parsed = parse_message(RAW_MESSAGE).expect("parse message");

        assert_eq!(parsed.headers.subject.as_deref(), Some("测试主题"));
        assert_eq!(parsed.headers.from_name.as_deref(), Some("测试发件人"));
        assert_eq!(
            parsed.headers.from_email.as_deref(),
            Some("sender@example.com")
        );
        assert_eq!(parsed.text.as_deref(), Some("这是邮件正文。"));
        assert_eq!(parsed.html.as_deref(), Some("<p>这是邮件正文。</p>"));
    }

    #[test]
    fn full_message_headers_backfill_missing_metadata_without_overwriting_valid_subject() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch(
                "CREATE TABLE onemail_mail_messages (
                   message_id INTEGER PRIMARY KEY,
                   rfc822_message_id TEXT,
                   in_reply_to TEXT,
                   references_header TEXT,
                   subject TEXT,
                   from_name TEXT,
                   from_email TEXT,
                   received_at TEXT,
                   snippet TEXT,
                   updated_at TEXT
                 );
                 INSERT INTO onemail_mail_messages(message_id,subject) VALUES (1,'保留主题');",
            )
            .expect("create message tables");
        let parsed = parse_message(RAW_MESSAGE).expect("parse message");

        persist_message_headers(&connection, 1, &parsed.headers, Some("正文摘要"))
            .expect("backfill headers");

        let stored = connection
            .query_row(
                "SELECT subject,from_name,from_email,rfc822_message_id,snippet
                 FROM onemail_mail_messages WHERE message_id=1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .expect("read message");
        assert_eq!(
            stored,
            (
                "保留主题".to_string(),
                "测试发件人".to_string(),
                "sender@example.com".to_string(),
                "<message@example.com>".to_string(),
                "正文摘要".to_string(),
            )
        );
    }
}
