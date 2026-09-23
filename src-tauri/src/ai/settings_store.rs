use keyring::{Entry, Error as KeyringError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::{db, state::AppState};

const AI_SETTINGS_KEY: &str = "ai_settings";
const AI_KEYRING_SERVICE: &str = "com.huzhihui.onemail.ai";
const AI_KEYRING_USER: &str = "default-api-key";

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredAiSettings {
    pub(super) base_url: String,
    pub(super) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) verified_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredAiCredential {
    pub(super) base_url: String,
    pub(super) api_key: String,
}

impl Drop for StoredAiCredential {
    fn drop(&mut self) {
        self.api_key.zeroize();
    }
}

pub(super) fn read_stored_settings(state: &AppState) -> Result<Option<StoredAiSettings>, String> {
    let connection = db::open(state)?;
    let value = connection
        .query_row(
            "SELECT setting_value FROM onemail_app_settings WHERE setting_key=?1",
            [AI_SETTINGS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取 AI 设置失败：{error}"))?;
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| "已保存的 AI 设置格式无效。".to_string())
        })
        .transpose()
}

pub(super) fn write_stored_settings(
    state: &AppState,
    settings: &StoredAiSettings,
) -> Result<(), String> {
    let value = serde_json::to_string(settings).map_err(|_| "无法序列化 AI 设置。".to_string())?;
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_app_settings (setting_key,setting_value,value_type)
             VALUES (?1,?2,'json')
             ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,
             value_type=excluded.value_type,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![AI_SETTINGS_KEY, value],
        )
        .map(|_| ())
        .map_err(|error| format!("保存 AI 设置失败：{error}"))
}

pub(super) fn delete_stored_settings(state: &AppState) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "DELETE FROM onemail_app_settings WHERE setting_key=?1",
            [AI_SETTINGS_KEY],
        )
        .map(|_| ())
        .map_err(|error| format!("清除 AI 设置失败：{error}"))
}

pub(super) fn mark_unverified_if_current(
    state: &AppState,
    expected: &StoredAiSettings,
) -> Result<(), String> {
    let Some(mut current) = read_stored_settings(state)? else {
        return Ok(());
    };
    if &current != expected {
        return Ok(());
    }
    current.verified_at = None;
    write_stored_settings(state, &current)
}

pub(super) async fn read_credential() -> Result<Option<StoredAiCredential>, String> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring_entry()?;
        match entry.get_password() {
            Ok(value) if value.is_empty() => Ok(None),
            Ok(value) => {
                let value = Zeroizing::new(value);
                serde_json::from_str(&value)
                    .map(Some)
                    .map_err(|_| "系统安全凭据库中的 AI 凭据格式无效。".to_string())
            }
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统安全凭据库中的 AI 凭据。".to_string()),
        }
    })
    .await
    .map_err(|_| "读取 AI 凭据的后台任务失败。".to_string())?
}

pub(super) async fn write_credential(base_url: &str, api_key: &str) -> Result<(), String> {
    let credential = StoredAiCredential {
        base_url: base_url.to_string(),
        api_key: api_key.to_string(),
    };
    let serialized = Zeroizing::new(
        serde_json::to_string(&credential).map_err(|_| "无法序列化 AI 凭据。".to_string())?,
    );
    tokio::task::spawn_blocking(move || {
        keyring_entry()?
            .set_password(&serialized)
            .map_err(|_| "无法将 AI 凭据保存到系统安全凭据库。".to_string())
    })
    .await
    .map_err(|_| "保存 AI 凭据的后台任务失败。".to_string())?
}

pub(super) async fn delete_api_key() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring_entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err("无法从系统安全凭据库清除 AI API Key。".to_string()),
        }
    })
    .await
    .map_err(|_| "清除 AI API Key 的后台任务失败。".to_string())?
}

pub(super) async fn restore_credential(
    previous: Option<&StoredAiCredential>,
) -> Result<(), String> {
    match previous {
        Some(previous) => write_credential(&previous.base_url, &previous.api_key).await,
        None => delete_api_key().await,
    }
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(AI_KEYRING_SERVICE, AI_KEYRING_USER)
        .map_err(|_| "系统安全凭据库不可用。".to_string())
}
