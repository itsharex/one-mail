use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::{db, mail::body as mail_body, state::AppState};

const MAX_MAIL_CONTEXT_CHARS: usize = 32_000;
const MAX_MAIL_HEADER_CHARS: usize = 1_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MailContextPayload {
    pub(super) subject: String,
    pub(super) from: String,
    pub(super) received_at: Option<String>,
    pub(super) body: String,
    pub(super) truncated: bool,
}

struct LoadedMailContext {
    payload: MailContextPayload,
    body_loaded: bool,
}

pub(super) async fn load_mail_context(
    state: &AppState,
    message_id: i64,
) -> Result<MailContextPayload, String> {
    let mut context =
        read_mail_context(state, message_id)?.ok_or_else(|| format!("邮件不存在：{message_id}"))?;
    if !context.body_loaded {
        mail_body::load_message_body(state, message_id).await?;
        context = read_mail_context(state, message_id)?
            .ok_or_else(|| format!("邮件不存在：{message_id}"))?;
    }
    Ok(context.payload)
}

fn read_mail_context(
    state: &AppState,
    message_id: i64,
) -> Result<Option<LoadedMailContext>, String> {
    let connection = db::open(state)?;
    connection
        .query_row(
            "SELECT m.subject,m.from_name,m.from_email,m.received_at,m.snippet,
                    b.body_text,b.body_html_sanitized,b.message_id
             FROM onemail_mail_messages m
             LEFT JOIN onemail_message_bodies b ON b.message_id=m.message_id
             WHERE m.message_id=?1 AND m.remote_deleted=0 AND m.user_hidden=0",
            [message_id],
            |row| {
                let subject = row.get::<_, Option<String>>(0)?.unwrap_or_default();
                let from_name = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let from_email = row.get::<_, Option<String>>(2)?.unwrap_or_default();
                let received_at = row.get::<_, Option<String>>(3)?;
                let snippet = row.get::<_, Option<String>>(4)?.unwrap_or_default();
                let body_text = row.get::<_, Option<String>>(5)?.unwrap_or_default();
                let body_html = row.get::<_, Option<String>>(6)?.unwrap_or_default();
                let body_loaded = row.get::<_, Option<i64>>(7)?.is_some();
                let body = if !body_text.trim().is_empty() {
                    body_text
                } else if !body_html.trim().is_empty() {
                    mail_body::html_to_text(&body_html)
                } else {
                    snippet
                };
                let from = match (from_name.trim(), from_email.trim()) {
                    ("", email) => email.to_string(),
                    (name, "") => name.to_string(),
                    (name, email) => format!("{name} <{email}>"),
                };
                let (subject, subject_truncated) = truncate_chars(&subject, MAX_MAIL_HEADER_CHARS);
                let (from, from_truncated) = truncate_chars(&from, MAX_MAIL_HEADER_CHARS);
                let (body, body_truncated) = truncate_chars(&body, MAX_MAIL_CONTEXT_CHARS);
                Ok(LoadedMailContext {
                    payload: MailContextPayload {
                        subject,
                        from,
                        received_at,
                        body,
                        truncated: subject_truncated || from_truncated || body_truncated,
                    },
                    body_loaded,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取 AI 邮件上下文失败：{error}"))
}

pub(super) fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        (truncated, true)
    } else {
        (truncated, false)
    }
}
