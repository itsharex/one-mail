use super::{persist_sync_folders, validate_reauthorization_email, SyncFolderInput};
use rusqlite::Connection;

#[test]
fn reauthorization_requires_the_same_mailbox() {
    assert!(validate_reauthorization_email("Owner@Example.com", " owner@example.com ").is_ok());
    assert_eq!(
        validate_reauthorization_email("owner@example.com", "other@example.com"),
        Err("请使用 owner@example.com 完成授权。".to_string())
    );
}

#[test]
fn persists_all_discovered_folders_and_forces_canonical_inbox_sync() {
    let connection = Connection::open_in_memory().expect("open database");
    connection
        .execute_batch(
            "CREATE TABLE onemail_mail_folders (
                   folder_id INTEGER PRIMARY KEY,
                   account_id INTEGER NOT NULL,
                   path TEXT NOT NULL,
                   name TEXT NOT NULL,
                   delimiter TEXT,
                   role TEXT NOT NULL,
                   attributes_json TEXT NOT NULL,
                   is_selectable INTEGER NOT NULL,
                   sync_enabled INTEGER NOT NULL,
                   sort_order INTEGER NOT NULL,
                   updated_at TEXT,
                   UNIQUE(account_id,path)
                 );",
        )
        .expect("create folder table");
    let folders = vec![
        SyncFolderInput {
            path: "Inbox".to_string(),
            delimiter: Some("/".to_string()),
            attributes: vec!["\\Noselect".to_string()],
            is_selectable: Some(false),
            sync_enabled: false,
        },
        SyncFolderInput {
            path: "Archive".to_string(),
            delimiter: Some("/".to_string()),
            attributes: vec!["\\Archive".to_string()],
            is_selectable: Some(true),
            sync_enabled: true,
        },
        SyncFolderInput {
            path: "Parent".to_string(),
            delimiter: Some("/".to_string()),
            attributes: vec!["\\NonExistent".to_string()],
            is_selectable: Some(true),
            sync_enabled: true,
        },
        SyncFolderInput {
            path: " Padded ".to_string(),
            delimiter: None,
            attributes: Vec::new(),
            is_selectable: Some(true),
            sync_enabled: false,
        },
    ];

    persist_sync_folders(&connection, 7, &folders).expect("persist folders");

    let rows = connection
        .prepare(
            "SELECT path,role,is_selectable,sync_enabled FROM onemail_mail_folders
                 WHERE account_id=7 ORDER BY sort_order,path",
        )
        .expect("prepare folder query")
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .expect("query folders")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect folders");
    assert_eq!(
        rows,
        vec![
            ("INBOX".to_string(), "inbox".to_string(), 1, 1),
            ("Archive".to_string(), "archive".to_string(), 1, 1),
            ("Parent".to_string(), "custom".to_string(), 0, 0),
            (" Padded ".to_string(), "custom".to_string(), 1, 0),
        ]
    );
}
