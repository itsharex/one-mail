// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    if std::env::args().nth(1).as_deref() == Some("--notify-stdin") {
        use std::{io::{Read, Write}, process::Stdio};

        let result = (|| -> Result<(), String> {
            let mut input = String::new();
            std::io::stdin()
                .read_to_string(&mut input)
                .map_err(|error| error.to_string())?;
            let payload: serde_json::Value =
                serde_json::from_str(&input).map_err(|error| error.to_string())?;
            let title = payload["title"].as_str().ok_or("缺少通知标题")?;
            let body = payload["body"].as_str().ok_or("缺少通知内容")?;
            let sound = payload["sound"].as_str();
            let icon_path = payload["iconPath"].as_str();
            let message_id = payload["messageId"].as_i64();
            let handle = onemail_lib::send_bundled_notification(title, body, sound, icon_path, message_id.is_some())?;
            println!("ready");
            std::io::stdout().flush().map_err(|error| error.to_string())?;
            if let Some(message_id) = message_id {
                let response = mac_usernotifications::block_on_main(handle.response())
                    .map_err(|error| error.to_string())?;
                if response.is_default_action() {
                    std::process::Command::new(
                        std::env::current_exe().map_err(|error| error.to_string())?,
                    )
                    .arg("--open-message")
                    .arg(message_id.to_string())
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|error| error.to_string())?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("OneMail Dev notification failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    onemail_lib::run()
}
