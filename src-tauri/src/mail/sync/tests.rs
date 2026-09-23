use super::imap::{uid_validity_changed, IMAP_SUMMARY_QUERY};
use super::{sync_skip_reason, upsert_message, FetchedMessage, SyncAccountTarget};
use rusqlite::Connection;

#[tokio::test]
async fn sync_batch_is_bounded_and_reports_fast_accounts_before_slow_ones() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use std::time::Duration;
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(tokio::sync::Barrier::new(super::SYNC_CONCURRENCY));
    let progress = Mutex::new(Vec::new());
    let tasks = (0..8)
        .map(|id| {
            let (active, peak, barrier) = (active.clone(), peak.clone(), barrier.clone());
            async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(count, Ordering::SeqCst);
                if id < super::SYNC_CONCURRENCY {
                    barrier.wait().await;
                }
                tokio::time::sleep(Duration::from_millis(if id == 0 { 50 } else { 1 })).await;
                active.fetch_sub(1, Ordering::SeqCst);
                serde_json::json!({"accountId":id,"ok":id != 2})
            }
        })
        .collect();
    let results = tokio::time::timeout(
        Duration::from_secs(2),
        super::run_sync_tasks(tasks, |result, completed, total| {
            progress.lock().unwrap().push((
                result["accountId"].as_u64().unwrap(),
                completed,
                total,
            ));
        }),
    )
    .await
    .expect("batch must not run serially or hang");
    assert_eq!(peak.load(Ordering::SeqCst), super::SYNC_CONCURRENCY);
    assert_eq!(results.len(), 8);
    assert_eq!(results[2]["ok"], false);
    for (id, result) in results.iter().enumerate() {
        assert_eq!(result["accountId"], id);
    }
    let progress = progress.lock().unwrap();
    assert_ne!(progress[0].0, 0);
    for (index, (_, completed, total)) in progress.iter().enumerate() {
        assert_eq!((*completed, *total), (index + 1, 8));
    }
}

#[test]
fn sync_batch_commits_messages_and_cursor_together_or_rolls_back() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(include_str!("../../db/schema.sql"))
        .unwrap();
    connection.execute_batch(
            "INSERT INTO onemail_provider_presets (provider_key,display_name,auth_type) VALUES ('test','Test','manual');
             INSERT INTO onemail_mail_accounts (account_id,provider_key,email,normalized_email,account_label,auth_type,imap_host,imap_port,imap_security)
             VALUES (1,'test','me@example.test','me@example.test','Test','manual','localhost',993,'ssl_tls');
             INSERT INTO onemail_mail_folders (folder_id,account_id,path,name,role) VALUES (1,1,'INBOX','Inbox','inbox');"
        ).unwrap();
    let message = |uid| FetchedMessage {
        uid,
        subject: Some("Test".into()),
        ..FetchedMessage::default()
    };
    assert!(super::apply_messages(
        &connection,
        1,
        1,
        "INBOX",
        &[message(1), message(0)],
        Some("test:failed"),
        "imap"
    )
    .is_err());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM onemail_mail_messages", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM onemail_folder_sync_states",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    let result = super::apply_messages(
        &connection,
        1,
        1,
        "INBOX",
        &[message(1), message(2)],
        Some("test:success"),
        "imap",
    )
    .unwrap();
    assert_eq!(result["insertedCount"], 2);
    assert_eq!(
        super::read_cursor(&connection, 1, "test:")
            .unwrap()
            .as_deref(),
        Some("success")
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT total_count FROM onemail_mail_folders WHERE folder_id=1",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
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
    account.last_error = Some("Outlook IMAP 连接被拒绝：User is authenticated but not connected.".to_string());
    assert_eq!(sync_skip_reason(&account), None);

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

    let original = FetchedMessage {
        uid: 42,
        subject: Some("真实主题".to_string()),
        message_id: Some("<message@example.com>".to_string()),
        from_name: Some("真实发件人".to_string()),
        from_email: Some("sender@example.com".to_string()),
        received_at: Some("2026-08-09T00:00:00Z".to_string()),
        internal_date: Some("2026-08-09T00:00:01Z".to_string()),
        snippet: Some("真实摘要".to_string()),
        size_bytes: 128,
        ..FetchedMessage::default()
    };
    let inserted_message_id =
        upsert_message(&connection, 1, 1, &original).expect("insert original message");
    assert!(inserted_message_id.is_some());

    let empty_refresh = FetchedMessage {
        uid: 42,
        subject: Some("  ".to_string()),
        is_read: true,
        ..FetchedMessage::default()
    };
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
