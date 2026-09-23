use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;

use crate::mail::transport as mail_transport;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SyncFolderInput {
    pub(super) path: String,
    #[serde(default)]
    pub(super) delimiter: Option<String>,
    #[serde(default)]
    pub(super) attributes: Vec<String>,
    #[serde(default)]
    pub(super) is_selectable: Option<bool>,
    #[serde(default)]
    pub(super) sync_enabled: bool,
}

pub(super) fn parse_sync_folders(
    object: &serde_json::Map<String, Value>,
) -> Result<Vec<SyncFolderInput>, String> {
    let Some(value) = object.get("syncFolders") else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    serde_json::from_value(value.clone()).map_err(|error| format!("同步文件夹参数无效：{error}"))
}

pub(super) fn persist_sync_folders(
    connection: &Connection,
    account_id: i64,
    folders: &[SyncFolderInput],
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_mail_folders
               (account_id,path,name,role,attributes_json,is_selectable,sync_enabled,sort_order)
             VALUES (?1,'INBOX','INBOX','inbox','[]',1,1,0)",
            [account_id],
        )
        .map_err(|error| format!("保存收件箱失败：{error}"))?;

    for (index, folder) in folders.iter().enumerate() {
        let raw_path = folder.path.as_str();
        if raw_path.is_empty() {
            return Err("同步文件夹路径不能为空。".to_string());
        }
        let is_inbox = raw_path.eq_ignore_ascii_case("INBOX");
        let path = if is_inbox { "INBOX" } else { raw_path };
        let selectable_from_attributes = mail_transport::is_folder_selectable(&folder.attributes);
        let is_selectable = if is_inbox {
            true
        } else {
            folder.is_selectable.unwrap_or(selectable_from_attributes) && selectable_from_attributes
        };
        let sync_enabled = is_inbox || (folder.sync_enabled && is_selectable);
        let name = if is_inbox {
            "INBOX".to_string()
        } else {
            mail_transport::decode_modified_utf7(path)
        };
        let role = mail_transport::folder_role(path, &folder.attributes);
        let attributes_json = serde_json::to_string(&folder.attributes)
            .map_err(|error| format!("序列化文件夹属性失败：{error}"))?;
        let sort_order = if is_inbox { 0 } else { index as i64 + 1 };

        connection
            .execute(
                "INSERT INTO onemail_mail_folders
                   (account_id,path,name,delimiter,role,attributes_json,is_selectable,sync_enabled,sort_order)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(account_id,path) DO UPDATE SET
                   name=excluded.name,delimiter=excluded.delimiter,role=excluded.role,
                   attributes_json=excluded.attributes_json,is_selectable=excluded.is_selectable,
                   sync_enabled=excluded.sync_enabled,sort_order=excluded.sort_order,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    account_id,
                    path,
                    name,
                    folder.delimiter,
                    role,
                    attributes_json,
                    is_selectable,
                    sync_enabled,
                    sort_order
                ],
            )
            .map_err(|error| format!("保存 IMAP 文件夹失败：{error}"))?;
    }
    Ok(())
}
