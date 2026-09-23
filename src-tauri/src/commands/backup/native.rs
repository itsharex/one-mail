use std::{fs::File, io::Read, path::Path, time::Duration};

use rusqlite::{backup::Backup, params, Connection, OpenFlags};

use super::{
    remove_database_files, validate_canonical_file_name, validate_key_and_timestamp, BackupInfo,
    NATIVE_BACKUP_EXTENSION,
};
use crate::{db, state::AppState};

const NATIVE_BACKUP_FORMAT_VERSION: i64 = 1;
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

pub(super) fn is_sqlite_file(file_path: &Path) -> Result<bool, String> {
    let mut file = File::open(file_path).map_err(|error| format!("读取备份文件失败：{error}"))?;
    let mut header = [0_u8; SQLITE_HEADER.len()];
    let bytes_read = file
        .read(&mut header)
        .map_err(|error| format!("读取备份文件失败：{error}"))?;
    Ok(bytes_read == SQLITE_HEADER.len() && &header == SQLITE_HEADER)
}

pub(super) fn create_native_backup(
    state: &AppState,
    file_path: &Path,
    exported_at: u64,
    key: &str,
) -> Result<(), String> {
    if file_path == state.database_path {
        return Err("不能将备份文件覆盖当前 OneMail 数据库。".to_string());
    }
    remove_database_files(file_path)?;

    let result = (|| {
        let source = db::open(state)?;
        let mut destination = Connection::open(file_path)
            .map_err(|error| format!("创建 OneMail 备份失败：{error}"))?;
        destination
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("配置备份超时失败：{error}"))?;

        {
            let backup = Backup::new(&source, &mut destination)
                .map_err(|error| format!("创建 OneMail 备份失败：{error}"))?;
            backup
                .run_to_completion(256, Duration::from_millis(5), None)
                .map_err(|error| format!("写入 OneMail 备份失败：{error}"))?;
        }

        finalize_native_backup(&destination, key, exported_at)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = remove_database_files(file_path);
    }
    result
}

pub(super) fn finalize_native_backup(
    connection: &Connection,
    key: &str,
    exported_at: u64,
) -> Result<(), String> {
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(|error| format!("整理 OneMail 备份失败：{error}"))?;
    connection
        .execute_batch(
            "DROP TABLE IF EXISTS onemail_backup_metadata;
             CREATE TABLE onemail_backup_metadata (
               format_version INTEGER NOT NULL,
               database_key TEXT NOT NULL,
               exported_at INTEGER NOT NULL
             );",
        )
        .and_then(|_| {
            connection.execute(
                "INSERT INTO onemail_backup_metadata
                 (format_version,database_key,exported_at) VALUES (?1,?2,?3)",
                params![NATIVE_BACKUP_FORMAT_VERSION, key, exported_at],
            )
        })
        .map_err(|error| format!("写入备份元数据失败：{error}"))?;
    validate_database_integrity(connection)
}

pub(super) fn validate_native_backup(file_path: &Path) -> Result<BackupInfo, String> {
    let connection = open_native_backup(file_path)?;
    validate_database_integrity(&connection)?;
    validate_required_schema(&connection)?;

    let (format_version, key, exported_at) = connection
        .query_row(
            "SELECT format_version,database_key,exported_at
             FROM onemail_backup_metadata LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|error| format!("备份文件缺少有效的 OneMail 元数据：{error}"))?;
    if format_version != NATIVE_BACKUP_FORMAT_VERSION {
        return Err(format!("暂不支持此 OneMail 备份版本：{format_version}"));
    }
    let exported_at =
        u64::try_from(exported_at).map_err(|_| "备份文件中的导出时间无效。".to_string())?;
    validate_key_and_timestamp(&key, exported_at)?;
    validate_canonical_file_name(file_path, &key, exported_at, NATIVE_BACKUP_EXTENSION)?;
    Ok(BackupInfo { key, exported_at })
}

pub(super) fn open_native_backup(file_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        file_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("打开 OneMail 备份失败：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .and_then(|_| connection.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;"))
        .map_err(|error| format!("配置 OneMail 备份校验失败：{error}"))?;
    Ok(connection)
}

pub(super) fn validate_database_integrity(connection: &Connection) -> Result<(), String> {
    let result: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(|error| format!("校验 OneMail 备份失败：{error}"))?;
    if result != "ok" {
        return Err(format!("OneMail 备份完整性校验失败：{result}"));
    }
    Ok(())
}

pub(super) fn validate_required_schema(connection: &Connection) -> Result<(), String> {
    for table_name in ["onemail_mail_accounts", "onemail_app_settings"] {
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name=?1",
                [table_name],
                |row| row.get(0),
            )
            .map_err(|error| format!("校验 OneMail 数据表失败：{error}"))?;
        if count != 1 {
            return Err(format!("备份文件缺少 OneMail 数据表：{table_name}"));
        }
    }

    let encrypted_password_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('onemail_mail_accounts')
             WHERE name='encrypted_password'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("校验账号密码密文字段失败：{error}"))?;
    if encrypted_password_count != 1 {
        return Err("备份文件缺少账号密码密文字段。".to_string());
    }

    let legacy_table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema
             WHERE type='table' AND name IN ('onemail_crypto_keys','onemail_account_credentials')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("校验旧版凭据表失败：{error}"))?;
    if legacy_table_count != 0 {
        return Err("备份文件包含旧版凭据表，请使用新库重新导出。".to_string());
    }
    Ok(())
}
