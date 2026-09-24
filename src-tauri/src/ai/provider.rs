use std::time::Duration;

use reqwest::{redirect::Policy, Client, StatusCode};
use serde::{Deserialize, Serialize};
use url::Url;

use super::ValidatedAiSettings;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
pub(super) struct CompletionRequest<'a> {
    pub(super) model: &'a str,
    pub(super) messages: &'a [ProviderMessage],
    pub(super) stream: bool,
    pub(super) max_tokens: u32,
}

#[derive(Serialize)]
pub(super) struct ProviderMessage {
    pub(super) role: &'static str,
    pub(super) content: String,
}

#[derive(Deserialize)]
pub(super) struct CompletionResponse {
    pub(super) choices: Vec<CompletionChoice>,
}

#[derive(Deserialize)]
pub(super) struct CompletionChoice {
    pub(super) message: CompletionResponseMessage,
}

#[derive(Deserialize)]
pub(super) struct CompletionResponseMessage {
    pub(super) content: CompletionContent,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum CompletionContent {
    Text(String),
    Parts(Vec<CompletionContentPart>),
}

impl CompletionContent {
    pub(super) fn into_text(self) -> String {
        match self {
            Self::Text(value) => value,
            Self::Parts(parts) => parts
                .into_iter()
                .filter_map(|part| part.text)
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}

#[derive(Deserialize)]
pub(super) struct CompletionContentPart {
    #[serde(default)]
    pub(super) text: Option<String>,
}

pub(super) struct Completion {
    pub(super) content: String,
}

pub(super) struct AiHttpError {
    pub(super) message: String,
    pub(super) invalidates_verification: bool,
}

impl AiHttpError {
    fn new(message: impl Into<String>, invalidates_verification: bool) -> Self {
        Self {
            message: message.into(),
            invalidates_verification,
        }
    }
}

pub(super) fn build_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|_| "无法创建 AI 请求客户端。".to_string())
}

pub(super) async fn send_completion(
    client: &Client,
    settings: &ValidatedAiSettings,
    api_key: Option<&str>,
    messages: &[ProviderMessage],
    max_tokens: u32,
) -> Result<Completion, AiHttpError> {
    let request = CompletionRequest {
        model: &settings.model,
        messages,
        stream: false,
        max_tokens,
    };
    match send_completion_to_endpoint(client, &settings.endpoint, api_key, &request).await {
        Ok(completion) => Ok(completion),
        Err((error, retry_with_v1)) => {
            let Some(fallback_endpoint) = settings
                .fallback_endpoint
                .as_ref()
                .filter(|_| retry_with_v1)
            else {
                return Err(error);
            };
            send_completion_to_endpoint(client, fallback_endpoint, api_key, &request)
                .await
                .map_err(|(error, _)| error)
        }
    }
}

async fn send_completion_to_endpoint(
    client: &Client,
    endpoint: &Url,
    api_key: Option<&str>,
    request: &CompletionRequest<'_>,
) -> Result<Completion, (AiHttpError, bool)> {
    let mut request_builder = client.post(endpoint.clone()).json(request);
    if let Some(api_key) = api_key {
        request_builder = request_builder.bearer_auth(api_key);
    }
    let response = request_builder
        .send()
        .await
        .map_err(|error| (map_transport_error(error), false))?;
    let status = response.status();
    if !status.is_success() {
        return Err((map_status_error(status), status == StatusCode::NOT_FOUND));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err((AiHttpError::new("AI 服务响应过大。", false), false));
    }

    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| (map_transport_error(error), false))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err((AiHttpError::new("AI 服务响应过大。", false), false));
        }
        bytes.extend_from_slice(&chunk);
    }
    let payload: CompletionResponse = serde_json::from_slice(&bytes).map_err(|_| {
        (
            AiHttpError::new("AI 服务返回了无法识别的响应。", false),
            is_missing_endpoint_error(&bytes),
        )
    })?;
    let content = payload
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.into_text())
        .unwrap_or_default()
        .trim()
        .to_string();
    if content.is_empty() {
        return Err((AiHttpError::new("AI 服务没有返回文本内容。", false), false));
    }
    Ok(Completion { content })
}

pub(super) fn is_missing_endpoint_error(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .is_some_and(|body| {
            body.get("error")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|message| message.starts_with("Unexpected endpoint or method"))
        })
}

fn map_transport_error(error: reqwest::Error) -> AiHttpError {
    if error.is_timeout() {
        AiHttpError::new("AI 服务请求超时。", false)
    } else if error.is_connect() {
        AiHttpError::new("无法连接 AI 服务。", false)
    } else {
        AiHttpError::new("AI 服务请求失败。", false)
    }
}

pub(super) fn map_status_error(status: StatusCode) -> AiHttpError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            AiHttpError::new("AI API Key 无效或没有访问权限，请重新验证。", true)
        }
        StatusCode::NOT_FOUND => AiHttpError::new(
            "AI API 地址或模型不存在，请检查 Base URL 和模型名称。",
            true,
        ),
        StatusCode::TOO_MANY_REQUESTS => {
            AiHttpError::new("AI 服务请求过于频繁，请稍后重试。", false)
        }
        StatusCode::PAYLOAD_TOO_LARGE => {
            AiHttpError::new("发送给 AI 的邮件或对话内容过长。", false)
        }
        status if status.is_client_error() => AiHttpError::new(
            format!("AI 服务拒绝了请求（HTTP {}）。", status.as_u16()),
            false,
        ),
        status if status.is_server_error() => {
            AiHttpError::new("AI 服务暂时不可用，请稍后重试。", false)
        }
        _ => AiHttpError::new("AI 服务返回了异常状态。", false),
    }
}
