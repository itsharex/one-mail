mod ai;
mod commands;
mod db;
mod mail;
mod oauth;
mod state;

use commands::{backup, data, system};
use state::AppState;
use tauri::Manager;

#[cfg(target_os = "macos")]
pub fn send_bundled_notification(
    title: &str,
    body: &str,
    sound: Option<&str>,
    icon_path: Option<&str>,
    interactive: bool,
) -> Result<mac_usernotifications::NotificationHandle, String> {
    let authorized = mac_usernotifications::blocking::request_auth()
        .map_err(|error| error.to_string())?;
    if !authorized {
        return Err("系统通知权限未获批准".to_owned());
    }
    let mut notification = mac_usernotifications::Notification::new()
        .title(title)
        .message(body);
    if sound.is_some() {
        notification = notification.default_sound();
    }
    if let Some(icon_path) = icon_path {
        notification = notification.image_path(icon_path);
    }
    if interactive {
        notification = notification.timeout(std::time::Duration::from_secs(8 * 60 * 60));
    }
    notification
        .send_blocking()
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to install the rustls crypto provider");
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        if let Some(message_id) = system::message_id_from_args(&args) {
            system::open_notification_message(app, message_id);
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Some(message_id) = system::message_id_from_args(&std::env::args().collect::<Vec<_>>()) {
                system::queue_notification_message(message_id);
            }
            let state = AppState::initialize(app.handle())?;
            db::initialize(&state)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::system_info,
            system::system_set_title_bar_theme,
            system::system_reveal_database,
            system::system_reveal_path,
            system::system_open_external,
            system::system_send_notification,
            system::system_take_notification_message,
            system::accounts_open_add_window,
            system::accounts_close_add_window,
            data::accounts::accounts_list,
            data::accounts::accounts_discover_folders,
            data::accounts::accounts_create,
            data::accounts::accounts_update,
            data::accounts::accounts_reauthorize,
            data::accounts::accounts_disable,
            data::accounts::accounts_remove,
            data::logos_get,
            data::messages::messages_list,
            data::conversations::conversations_list,
            data::conversations::conversations_messages,
            data::conversations::conversations_find_message,
            data::messages::messages_stats,
            data::messages::messages_get,
            data::messages::messages_load_body,
            data::messages::messages_set_read_state,
            data::messages::messages_bulk_set_read_state,
            data::messages::messages_mark_all_read,
            data::messages::messages_download_attachment,
            data::messages::messages_delete,
            data::messages::messages_bulk_delete,
            data::messages::messages_hide_local,
            data::messages::messages_restore,
            data::compose::compose_create_reply_draft,
            data::compose::compose_create_forward_draft,
            data::compose::compose_send,
            data::compose::compose_select_attachments,
            data::compose::compose_list_outbox,
            data::compose::compose_save_draft,
            data::compose::compose_delete_draft,
            data::compose::compose_retry,
            data::compose::compose_delete_outbox,
            data::sync::sync_start_all,
            data::sync::sync_start_account,
            data::sync::sync_status,
            data::sync::notifications_status,
            data::settings::settings_get,
            data::settings::settings_update,
            data::settings::settings_get_backup_sync,
            data::settings::settings_update_backup_sync,
            data::settings::settings_test_backup_sync,
            data::settings::settings_upload_backup_sync,
            data::settings::settings_download_backup_sync,
            data::settings::settings_import_backup_from_remote,
            data::ai::ai_settings_get,
            data::ai::ai_settings_verify_and_save,
            data::ai::ai_settings_clear,
            data::ai::ai_chat,
            backup::settings_export_sql,
            backup::settings_import_sql,
            data::updates::updates_check,
            data::updates::updates_status,
            data::updates::updates_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running OneMail");
}
