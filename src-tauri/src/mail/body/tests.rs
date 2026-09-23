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
