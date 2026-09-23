mod native;

use native::{create_native_backup, is_sqlite_file, open_native_backup, validate_database_integrity, validate_native_backup, validate_required_schema};

use std::{
    fs::{self},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use rusqlite::{backup::Backup, Connection};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    db,
    state::{is_valid_database_key, AppState},
};

const MAX_BACKUP_CLOCK_SKEW_SECONDS: u64 = 5 * 60;
const NATIVE_BACKUP_EXTENSION: &str = "onemail";

#[derive(Clone)]
struct BackupInfo {
    key: String,
    exported_at: u64,
}

#[tauri::command]
pub async fn settings_import_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    operation_id: Option<String>,
) -> Result<Value, String> {
    emit_progress(&app, operation_id.as_deref(), "selecting_file", 5, None);
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("OneMail Backup", &["onemail", "sqlite", "sql"])
        .set_title("导入 OneMail 备份")
        .blocking_pick_file()
    else {
        return Ok(json!({ "imported": false }));
    };
    let file_path = file
        .into_path()
        .map_err(|error| format!("无法读取所选文件路径：{error}"))?;

    emit_progress(
        &app,
        operation_id.as_deref(),
        "reading_file",
        20,
        Some(&file_path),
    );
    let info = if is_sqlite_file(&file_path)? {
        emit_progress(
            &app,
            operation_id.as_deref(),
            "validating_backup",
            35,
            Some(&file_path),
        );
        let info = validate_native_backup(&file_path)?;
        emit_progress(
            &app,
            operation_id.as_deref(),
            "restoring_database",
            55,
            Some(&file_path),
        );
        restore_native_database(&state, &file_path, &info.key)?;
        info
    } else {
        let raw_sql =
            fs::read_to_string(&file_path).map_err(|error| format!("读取备份文件失败：{error}"))?;
        // Older exports could embed binary PDF/OFD bytes in text fields. SQLite's
        // SQL parser cannot consume NUL bytes inside a string literal.
        let sql = raw_sql.replace('\0', "\u{fffd}");
        emit_progress(
            &app,
            operation_id.as_deref(),
            "validating_backup",
            35,
            Some(&file_path),
        );
        let info = validate_sql_backup(&sql, &file_path)?;
        emit_progress(
            &app,
            operation_id.as_deref(),
            "restoring_database",
            55,
            Some(&file_path),
        );
        restore_sql_database(&state, &sql, &info.key)?;
        info
    };
    emit_progress(
        &app,
        operation_id.as_deref(),
        "loading_stats",
        90,
        Some(&file_path),
    );

    let connection = db::open(&state)?;
    let account_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM onemail_mail_accounts", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("读取账号统计失败：{error}"))?;
    let message_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM onemail_mail_messages", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("读取邮件统计失败：{error}"))?;

    emit_progress(
        &app,
        operation_id.as_deref(),
        "completed",
        100,
        Some(&file_path),
    );
    Ok(json!({
        "imported": true,
        "filePath": file_path.to_string_lossy(),
        "importedAt": db::now_iso(),
        "exportedAt": info.exported_at,
        "accountCount": account_count,
        "messageCount": message_count
    }))
}

#[tauri::command]
pub async fn settings_export_sql(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let exported_at = unix_timestamp();
    let key = state.database_key()?;
    let file_name = format!("{key}_{exported_at}.{NATIVE_BACKUP_EXTENSION}");

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("OneMail Backup", &[NATIVE_BACKUP_EXTENSION])
        .set_title("导出 OneMail 备份")
        .set_file_name(&file_name);
    if let Ok(documents) = app.path().document_dir() {
        dialog = dialog.set_directory(documents);
    }
    let Some(file) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let file_path = file
        .into_path()
        .map_err(|error| format!("无法读取保存路径：{error}"))?;
    create_native_backup(&state, &file_path, exported_at, &key)?;
    Ok(Some(file_path.to_string_lossy().into_owned()))
}

fn validate_sql_backup(sql: &str, file_path: &Path) -> Result<BackupInfo, String> {
    let lower = sql.to_ascii_lowercase();
    if !lower.contains("create table") || !lower.contains("onemail_mail_accounts") {
        return Err("备份 SQL 缺少 OneMail 账号表。".to_string());
    }
    if !lower.contains("encrypted_password") {
        return Err("备份 SQL 缺少账号密码密文字段。".to_string());
    }
    if !lower.contains("onemail_app_settings") {
        return Err("备份 SQL 缺少 OneMail 设置表。".to_string());
    }
    if lower.contains("onemail_crypto_keys") || lower.contains("onemail_account_credentials") {
        return Err("备份 SQL 包含旧版凭据表，请使用新库重新导出。".to_string());
    }

    let attachment =
        Regex::new(r"(?im)(?:^|;)\s*(?:EXPLAIN(?:\s+QUERY\s+PLAN)?\s+)?(?:ATTACH|DETACH)\b")
            .map_err(|error| error.to_string())?;
    if attachment.is_match(sql) {
        return Err("备份 SQL 包含不允许的数据库附加语句。".to_string());
    }

    let key =
        header_value(sql, "-- key:").ok_or_else(|| "备份 SQL 缺少数据库密钥。".to_string())?;
    let exported_at = header_value(sql, "-- exported_at:")
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "备份 SQL 缺少有效的导出时间。".to_string())?;
    validate_key_and_timestamp(&key, exported_at)?;

    validate_canonical_file_name(file_path, &key, exported_at, "sql")?;

    Ok(BackupInfo { key, exported_at })
}

fn validate_canonical_file_name(
    file_path: &Path,
    key: &str,
    exported_at: u64,
    extension: &str,
) -> Result<(), String> {
    let Some(file_name) = file_path.file_name().and_then(|value| value.to_str()) else {
        return Ok(());
    };
    let canonical_name = Regex::new(&format!(
        r"^k\d{{10}}[0-9a-f]{{16}}_\d{{10}}\.{}$",
        regex::escape(extension)
    ))
    .map_err(|error| error.to_string())?;
    let expected = format!("{key}_{exported_at}.{extension}");
    if canonical_name.is_match(file_name) && file_name != expected {
        return Err("备份元数据与文件名不一致。".to_string());
    }
    Ok(())
}

fn restore_native_database(state: &AppState, file_path: &Path, key: &str) -> Result<(), String> {
    let database_dir = state
        .database_path
        .parent()
        .ok_or_else(|| "数据库目录无效。".to_string())?;
    let temp_path = database_dir.join("onemail.importing.sqlite");
    remove_database_files(&temp_path)?;

    {
        let source = open_native_backup(file_path)?;
        let mut destination =
            Connection::open(&temp_path).map_err(|error| format!("创建临时数据库失败：{error}"))?;
        {
            let backup = Backup::new(&source, &mut destination)
                .map_err(|error| format!("准备恢复 OneMail 备份失败：{error}"))?;
            backup
                .run_to_completion(256, Duration::from_millis(5), None)
                .map_err(|error| format!("恢复 OneMail 备份失败：{error}"))?;
        }
        destination
            .execute_batch(
                "DROP TABLE onemail_backup_metadata;
                 PRAGMA journal_mode=DELETE;",
            )
            .map_err(|error| format!("整理恢复数据库失败：{error}"))?;
        validate_database_integrity(&destination)?;
        validate_required_schema(&destination)?;
    }
    replace_database(state, &temp_path, key)
}

fn restore_sql_database(state: &AppState, sql: &str, key: &str) -> Result<(), String> {
    let database_dir = state
        .database_path
        .parent()
        .ok_or_else(|| "数据库目录无效。".to_string())?;
    let temp_path = database_dir.join("onemail.importing.sqlite");
    remove_database_files(&temp_path)?;

    {
        let connection =
            Connection::open(&temp_path).map_err(|error| format!("创建临时数据库失败：{error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .and_then(|_| connection.execute_batch(sql))
            .map_err(|error| format!("恢复 SQL 备份失败：{error}"))?;
        validate_required_schema(&connection)?;
    }
    replace_database(state, &temp_path, key)
}

fn replace_database(state: &AppState, temp_path: &Path, key: &str) -> Result<(), String> {
    let database_dir = state
        .database_path
        .parent()
        .ok_or_else(|| "数据库目录无效。".to_string())?;
    let rollback_path = database_dir.join("onemail.rollback.sqlite");
    remove_database_files(&rollback_path)?;
    if state.database_path.exists() {
        if let Ok(connection) = db::open(state) {
            let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        move_database_files(&state.database_path, &rollback_path)?;
    }

    if let Err(error) = move_database_files(temp_path, &state.database_path) {
        let _ = move_database_files(&rollback_path, &state.database_path);
        return Err(error);
    }

    if let Err(error) = state
        .set_database_key(key)
        .and_then(|_| db::initialize(state))
    {
        let _ = remove_database_files(&state.database_path);
        let _ = move_database_files(&rollback_path, &state.database_path);
        return Err(error);
    }

    remove_database_files(&rollback_path)?;
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    operation_id: Option<&str>,
    stage: &str,
    percent: u8,
    file_path: Option<&Path>,
) {
    let Some(operation_id) = operation_id else {
        return;
    };
    let mut payload = json!({
        "operationId": operation_id,
        "source": "local",
        "stage": stage,
        "percent": percent
    });
    if let Some(path) = file_path {
        payload["filePath"] = json!(path.to_string_lossy());
    }
    let _ = app.emit("settings/backupImportProgress", payload);
}

fn header_value(sql: &str, prefix: &str) -> Option<String> {
    sql.lines()
        .find_map(|line| line.strip_prefix(prefix).map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn validate_key_and_timestamp(key: &str, exported_at: u64) -> Result<(), String> {
    if !is_valid_database_key(key) {
        return Err("备份文件中的数据库密钥无效。".to_string());
    }
    let created_at = key[1..11]
        .parse::<u64>()
        .map_err(|_| "备份文件中的数据库密钥无效。".to_string())?;
    let now = unix_timestamp();
    if exported_at < created_at || exported_at > now + MAX_BACKUP_CLOCK_SKEW_SECONDS {
        return Err("备份文件中的导出时间无效或超出允许范围。".to_string());
    }
    Ok(())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    for target in database_file_set(path) {
        if target.exists() {
            fs::remove_file(&target).map_err(|error| format!("删除临时数据库失败：{error}"))?;
        }
    }
    Ok(())
}

fn move_database_files(from: &Path, to: &Path) -> Result<(), String> {
    let from_files = database_file_set(from);
    let to_files = database_file_set(to);
    for (source, target) in from_files.into_iter().zip(to_files) {
        if source.exists() {
            fs::rename(&source, &target).map_err(|error| format!("替换数据库失败：{error}"))?;
        }
    }
    Ok(())
}

fn database_file_set(path: &Path) -> [PathBuf; 3] {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::native::finalize_native_backup;

    #[test]
    fn native_backup_keeps_required_metadata_and_schema() {
        let exported_at = unix_timestamp();
        let key = format!("k{exported_at}0123456789abcdef");
        let source_path = temporary_database_path("source");
        let backup_path = temporary_database_path("backup").with_extension(NATIVE_BACKUP_EXTENSION);
        let restore_path = temporary_database_path("restore");
        let _ = remove_database_files(&source_path);
        let _ = remove_database_files(&backup_path);
        let _ = remove_database_files(&restore_path);

        let source = Connection::open(&source_path).expect("open source database");
        source
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("initialize source schema");
        source
            .pragma_update(None, "journal_mode", "WAL")
            .expect("enable WAL mode");
        source
            .execute(
                "INSERT INTO onemail_app_settings
                 (setting_key,setting_value,value_type) VALUES ('backup_test','from_wal','string')",
                [],
            )
            .expect("write committed WAL data");
        let mut destination = Connection::open(&backup_path).expect("open backup database");
        {
            let backup = Backup::new(&source, &mut destination).expect("create online backup");
            backup
                .run_to_completion(64, Duration::ZERO, None)
                .expect("copy source pages");
        }
        finalize_native_backup(&destination, &key, exported_at).expect("finalize native backup");
        drop(destination);
        drop(source);

        let info = validate_native_backup(&backup_path).expect("validate native backup");
        assert_eq!(info.key, key);
        assert_eq!(info.exported_at, exported_at);
        let backup = open_native_backup(&backup_path).expect("reopen native backup");
        let wal_value: String = backup
            .query_row(
                "SELECT setting_value FROM onemail_app_settings WHERE setting_key='backup_test'",
                [],
                |row| row.get(0),
            )
            .expect("read copied WAL data");
        assert_eq!(wal_value, "from_wal");
        drop(backup);

        let source = open_native_backup(&backup_path).expect("open native backup for restore");
        let mut restored = Connection::open(&restore_path).expect("open restore database");
        {
            let backup = Backup::new(&source, &mut restored).expect("create restore backup");
            backup
                .run_to_completion(64, Duration::ZERO, None)
                .expect("restore native pages");
        }
        restored
            .execute_batch(
                "DROP TABLE onemail_backup_metadata;
                 PRAGMA journal_mode=DELETE;",
            )
            .expect("remove backup-only metadata");
        validate_database_integrity(&restored).expect("validate restored database");
        validate_required_schema(&restored).expect("validate restored schema");
        drop(restored);
        drop(source);

        remove_database_files(&source_path).expect("remove source database");
        remove_database_files(&backup_path).expect("remove backup database");
        remove_database_files(&restore_path).expect("remove restore database");
    }

    fn temporary_database_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "onemail-backup-test-{label}-{}-{}.sqlite",
            std::process::id(),
            unix_timestamp()
        ))
    }
}
