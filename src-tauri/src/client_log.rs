use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use chrono::{Duration, Local, NaiveDate};
use rusqlite::OptionalExtension;
use tauri::{AppHandle, Manager};

use crate::{db, state::AppState};

const DEFAULT_RETENTION_DAYS: i64 = 7;

pub fn retention_days(state: &AppState) -> i64 {
    db::open(state)
        .ok()
        .and_then(|connection| {
            connection.query_row(
                "SELECT setting_value FROM onemail_app_settings WHERE setting_key='log_retention_days'",
                [],
                |row| row.get::<_, String>(0),
            ).optional().ok().flatten()
        })
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|days| (1..=365).contains(days))
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

pub fn cleanup(app: &AppHandle, days: i64) -> Result<(), String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    if !directory.exists() {
        return Ok(());
    }
    cleanup_directory(&directory, Local::now().date_naive(), days)
}

fn cleanup_directory(directory: &Path, today: NaiveDate, days: i64) -> Result<(), String> {
    let cutoff = today - Duration::days(days - 1);
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(date) = log_date(&name) {
            if date < cutoff {
                fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn write(app: &AppHandle, event: &str) -> Result<(), String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let now = Local::now();
    let path = directory.join(format!("OneMail-{}.log", now.format("%Y-%m-%d")));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{} {event}", now.format("%Y-%m-%d %H:%M:%S%:z"))
        .map_err(|error| error.to_string())
}

pub fn reveal(app: &AppHandle) -> Result<bool, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    write(app, "INFO Opened log directory")?;
    open::that(&directory).map_err(|error| error.to_string())?;
    Ok(true)
}

fn log_date(name: &str) -> Option<NaiveDate> {
    let date = name.strip_prefix("OneMail-")?.strip_suffix(".log")?;
    if date.len() != 10 {
        return None;
    }
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    (parsed.format("%Y-%m-%d").to_string() == date).then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::{cleanup_directory, log_date};
    use chrono::NaiveDate;
    use std::fs;

    #[test]
    fn only_our_daily_logs_are_subject_to_retention() {
        assert!(log_date("OneMail-2026-09-23.log").is_some());
        assert!(log_date("OneMail-2026-9-23.log").is_none());
        assert!(log_date("OneMail-2026-09-23.log.bak").is_none());
        assert!(log_date("other-2026-09-23.log").is_none());
    }

    #[test]
    fn seven_days_keeps_today_and_six_previous_days() {
        let directory =
            std::env::temp_dir().join(format!("onemail-log-retention-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for name in [
            "OneMail-2026-09-16.log",
            "OneMail-2026-09-17.log",
            "OneMail-2026-09-23.log",
            "other-2026-09-16.log",
        ] {
            fs::write(directory.join(name), "test").unwrap();
        }
        cleanup_directory(&directory, NaiveDate::from_ymd_opt(2026, 9, 23).unwrap(), 7).unwrap();
        assert!(!directory.join("OneMail-2026-09-16.log").exists());
        assert!(directory.join("OneMail-2026-09-17.log").exists());
        assert!(directory.join("OneMail-2026-09-23.log").exists());
        assert!(directory.join("other-2026-09-16.log").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
