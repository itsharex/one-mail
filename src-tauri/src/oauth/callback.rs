use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::Url;

use super::CALLBACK_TIMEOUT;

pub(super) async fn wait_for_callback(
    listener: TcpListener,
    callback_path: &str,
    expected_state: &str,
) -> Result<String, String> {
    let result = timeout(CALLBACK_TIMEOUT, async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|error| format!("读取 OAuth 回调失败：{error}"))?;
            let mut buffer = Vec::with_capacity(1024);
            let mut chunk = [0_u8; 1024];
            while buffer.len() < 16 * 1024 {
                let read = stream
                    .read(&mut chunk)
                    .await
                    .map_err(|error| format!("读取 OAuth 回调失败：{error}"))?;
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&buffer);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .ok_or_else(|| "OAuth 回调请求格式无效。".to_string())?;
            let url = Url::parse(&format!("http://localhost{target}"))
                .map_err(|error| format!("解析 OAuth 回调失败：{error}"))?;
            if url.path() != callback_path {
                write_callback_response(&mut stream, 404, "Not found").await?;
                continue;
            }
            let state = url
                .query_pairs()
                .find(|(key, _)| key == "state")
                .map(|(_, value)| value.into_owned());
            if state.as_deref() != Some(expected_state) {
                write_callback_response(&mut stream, 400, "授权状态校验失败，可以关闭此页面。")
                    .await?;
                return Err("OAuth state 校验失败。".to_string());
            }
            if let Some(error) = url
                .query_pairs()
                .find(|(key, _)| key == "error")
                .map(|(_, value)| value.into_owned())
            {
                let description = url
                    .query_pairs()
                    .find(|(key, _)| key == "error_description")
                    .map(|(_, value)| value.into_owned())
                    .unwrap_or(error);
                write_callback_response(&mut stream, 400, "授权失败，可以关闭此页面。").await?;
                return Err(description);
            }
            let code = url
                .query_pairs()
                .find(|(key, _)| key == "code")
                .map(|(_, value)| value.into_owned())
                .ok_or_else(|| "OAuth 未返回授权码。".to_string())?;
            write_callback_response(&mut stream, 200, "授权成功，可以关闭此页面并返回 OneMail。")
                .await?;
            return Ok(code);
        }
    })
    .await
    .map_err(|_| "OAuth 登录超时，请重试。".to_string())?;
    result
}

async fn write_callback_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let status_text = if status == 200 { "OK" } else { "Bad Request" };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("写入 OAuth 回调响应失败：{error}"))
}
