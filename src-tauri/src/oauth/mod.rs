mod callback;
mod crypto;
mod provider;

pub use provider::provider_for;
use callback::wait_for_callback;
use crypto::{decrypt_secret, encrypt_secret};

use std::time::Duration;

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rng, RngCore};
use reqwest::Client;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::net::TcpListener;
use url::form_urlencoded::Serializer;

use crate::{db, state::AppState};

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REFRESH_SKEW: Duration = Duration::from_secs(10 * 60);
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OAuthToken {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "idToken", skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(rename = "refreshToken", skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AuthorizedAccount {
    pub email: String,
    pub token: OAuthToken,
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    access_token: Option<String>,
    id_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[async_trait]
pub trait OAuthProvider: Send + Sync {
    fn key(&self) -> &'static str;
    fn client_id(&self) -> Result<String, String>;
    fn authorization_endpoint(&self) -> &'static str;
    fn token_endpoint(&self) -> &'static str;
    fn scopes(&self) -> &'static [&'static str];
    fn authorization_parameters(&self, params: &mut Serializer<String>);
    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String>;
    fn validate_token(&self, response: &TokenResponse, token: &OAuthToken) -> Result<(), String>;

    async fn exchange_code(
        &self,
        client: &Client,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<OAuthToken, String> {
        let client_id = self.client_id()?;
        let mut form = vec![
            ("client_id", client_id),
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", redirect_uri.to_string()),
            ("code_verifier", verifier.to_string()),
        ];
        if self.key() == "microsoft" {
            form.push(("scope", self.scopes().join(" ")));
        }
        let response = client
            .post(self.token_endpoint())
            .form(&form)
            .send()
            .await
            .map_err(|error| format!("{} OAuth token 请求失败：{error}", self.key()))?;
        map_token_response(response, self).await
    }

    async fn refresh(
        &self,
        client: &Client,
        refresh_token: &str,
        previous: &OAuthToken,
    ) -> Result<OAuthToken, String> {
        let client_id = self.client_id()?;
        let mut form = vec![
            ("client_id", client_id),
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
        ];
        if self.key() == "microsoft" {
            form.push(("scope", self.scopes().join(" ")));
        }
        let response = client
            .post(self.token_endpoint())
            .form(&form)
            .send()
            .await
            .map_err(|error| format!("刷新 {} OAuth 失败：{error}", self.key()))?;
        let refreshed = map_token_response(response, self).await?;
        Ok(OAuthToken {
            access_token: refreshed.access_token,
            id_token: refreshed.id_token.or_else(|| previous.id_token.clone()),
            refresh_token: refreshed
                .refresh_token
                .or_else(|| previous.refresh_token.clone()),
            token_type: refreshed.token_type,
            expires_at: refreshed.expires_at,
        })
    }
}

pub async fn authorize(
    provider_key: &str,
    login_hint: Option<&str>,
    _app: Option<&AppHandle>,
) -> Result<AuthorizedAccount, String> {
    let provider = provider_for(provider_key)?;
    let client_id = provider.client_id()?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("启动 OAuth 本地回调失败：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 OAuth 回调端口失败：{error}"))?
        .port();
    let callback_path = format!("/oauth/{}/callback", provider.key());
    let redirect_uri = format!("http://localhost:{port}{callback_path}");
    let verifier = random_urlsafe(48);
    let challenge = base64_url(&Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(24);

    let authorization_url = {
        let mut params = Serializer::new(String::new());
        params.append_pair("client_id", &client_id);
        params.append_pair("redirect_uri", &redirect_uri);
        params.append_pair("scope", &provider.scopes().join(" "));
        params.append_pair("state", &state);
        params.append_pair("code_challenge", &challenge);
        params.append_pair("code_challenge_method", "S256");
        provider.authorization_parameters(&mut params);
        if let Some(login_hint) = login_hint.filter(|value| !value.trim().is_empty()) {
            params.append_pair("login_hint", login_hint.trim());
        }
        format!("{}?{}", provider.authorization_endpoint(), params.finish())
    };
    open::that(&authorization_url).map_err(|error| format!("打开系统浏览器失败：{error}"))?;

    let code = wait_for_callback(listener, &callback_path, &state).await?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("创建 OAuth 请求客户端失败：{error}"))?;
    let token = provider
        .exchange_code(&client, &code, &verifier, &redirect_uri)
        .await?;
    let email = provider.mailbox_email(&token).await?;
    Ok(AuthorizedAccount { email, token })
}

pub fn save_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    token: &OAuthToken,
    scopes: &[&str],
) -> Result<(), String> {
    let encrypted = encrypt_secret(&state.database_key()?, token, ":oauth")?;
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_oauth_tokens
               (account_id,provider_key,token_payload,expires_at,scopes_json,updated_at)
             VALUES (?1,?2,?3,?4,?5,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(account_id) DO UPDATE SET provider_key=excluded.provider_key,
               token_payload=excluded.token_payload,expires_at=excluded.expires_at,
               scopes_json=excluded.scopes_json,updated_at=excluded.updated_at",
            params![
                account_id,
                provider_key,
                encrypted,
                token.expires_at,
                serde_json::to_string(scopes).map_err(|error| error.to_string())?
            ],
        )
        .map_err(|error| format!("保存 OAuth 凭据失败：{error}"))?;
    set_connection_state(state, account_id, "connected", false, None)
}

pub fn read_token(state: &AppState, account_id: i64) -> Result<(String, OAuthToken), String> {
    let connection = db::open(state)?;
    let row = connection
        .query_row(
            "SELECT provider_key,token_payload FROM onemail_oauth_tokens WHERE account_id=?1",
            [account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("读取 OAuth 凭据失败：{error}"))?
        .ok_or_else(|| "OAuth 凭据不存在，请重新授权。".to_string())?;
    let token = decrypt_secret(&state.database_key()?, &row.1, ":oauth")?;
    Ok((row.0, token))
}

pub async fn access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
) -> Result<OAuthToken, String> {
    let (stored_provider, token) = match read_token(state, account_id) {
        Ok(value) => value,
        Err(error) => {
            let _ = set_connection_state(state, account_id, "reauthorize", true, Some(&error));
            return Err(error);
        }
    };
    if stored_provider != provider_key {
        let error = "OAuth 服务商与账号配置不一致，请重新授权。";
        let _ = set_connection_state(state, account_id, "reauthorize", true, Some(error));
        return Err(error.to_string());
    }
    if !should_refresh(&token) {
        return Ok(token);
    }
    refresh_access_token(state, account_id, provider_key, None, false).await
}

pub async fn force_refresh_access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    failed_access_token: Option<&str>,
) -> Result<OAuthToken, String> {
    refresh_access_token(state, account_id, provider_key, failed_access_token, true).await
}

async fn refresh_access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    failed_access_token: Option<&str>,
    force: bool,
) -> Result<OAuthToken, String> {
    let lock = state.oauth_refresh_lock(account_id)?;
    let _guard = lock.lock().await;
    let (stored_provider, current) = read_token(state, account_id)?;
    if stored_provider != provider_key {
        return Err("OAuth 服务商与账号配置不一致，请重新授权。".to_string());
    }
    if let Some(failed_access_token) = failed_access_token {
        if current.access_token != failed_access_token && !should_refresh(&current) {
            return Ok(current);
        }
    } else if !force && !should_refresh(&current) {
        return Ok(current);
    }

    let Some(refresh_token) = current.refresh_token.as_deref() else {
        let error = "OAuth refresh token 不存在，请重新授权。";
        let _ = set_connection_state(state, account_id, "reauthorize", true, Some(error));
        return Err(error.to_string());
    };
    set_connection_state(state, account_id, "renewing", false, None)?;
    let provider = provider_for(provider_key)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("创建 OAuth 请求客户端失败：{error}"))?;
    match provider.refresh(&client, refresh_token, &current).await {
        Ok(token) => {
            save_token(state, account_id, provider_key, &token, provider.scopes())?;
            Ok(token)
        }
        Err(error) => {
            if is_reauthorization_required(&error) {
                let _ = set_connection_state(state, account_id, "reauthorize", true, Some(&error));
            } else {
                let _ = set_connection_state(state, account_id, "connected", false, Some(&error));
            }
            Err(error)
        }
    }
}

pub fn set_connection_state(
    state: &AppState,
    account_id: i64,
    connection_state: &str,
    auth_error: bool,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET connection_state=?2,
               status=CASE WHEN ?3=1 THEN 'auth_error' WHEN ?2='connected' THEN 'active' ELSE status END,
               credential_state=CASE WHEN ?3=1 THEN 'invalid' WHEN ?2='connected' THEN 'stored' ELSE credential_state END,
               last_error=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE account_id=?1",
            params![account_id, connection_state, auth_error, error],
        )
        .map(|_| ())
        .map_err(|error| format!("更新账号连接状态失败：{error}"))
}

async fn map_token_response<P: OAuthProvider + ?Sized>(
    response: reqwest::Response,
    provider: &P,
) -> Result<OAuthToken, String> {
    let status = response.status();
    let payload: TokenResponse = response
        .json()
        .await
        .map_err(|error| format!("解析 {} OAuth 响应失败：{error}", provider.key()))?;
    if !status.is_success() || payload.error.is_some() {
        return Err(token_response_error(&payload, status, provider.key()));
    }
    let access_token = payload
        .access_token
        .clone()
        .ok_or_else(|| format!("{} OAuth 未返回 access token。", provider.key()))?;
    let token = OAuthToken {
        access_token,
        id_token: payload.id_token.clone(),
        refresh_token: payload.refresh_token.clone(),
        token_type: payload
            .token_type
            .clone()
            .unwrap_or_else(|| "Bearer".to_string()),
        expires_at: payload.expires_in.map(|seconds| {
            (chrono::Utc::now() + chrono::Duration::seconds(seconds))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        }),
    };
    provider.validate_token(&payload, &token)?;
    Ok(token)
}

fn token_response_error(
    payload: &TokenResponse,
    status: reqwest::StatusCode,
    provider_key: &str,
) -> String {
    let code = payload
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let description = payload
        .error_description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (code, description) {
        (Some(code), Some(description)) if code != description => {
            format!("{provider_key} OAuth 返回 {code}：{description}")
        }
        (Some(code), _) => format!("{provider_key} OAuth 返回 {code}"),
        (_, Some(description)) => description.to_string(),
        _ => format!("HTTP {status}"),
    }
}

fn is_reauthorization_required(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("invalid_grant") || error.contains("interaction_required")
}

fn should_refresh(token: &OAuthToken) -> bool {
    let Some(expires_at) = token.expires_at.as_deref() else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .map(|expires_at| {
            expires_at
                <= chrono::Utc::now() + chrono::Duration::from_std(REFRESH_SKEW).unwrap_or_default()
        })
        .unwrap_or(true)
}

fn first_email<const N: usize>(values: [Option<String>; N]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .find(|value| is_email(value))
}

fn is_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None) if !local.is_empty() && domain.contains('.'))
}

fn decode_jwt_payload(token: &str) -> Result<Value, String> {
    let encoded = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "JWT 格式无效。".to_string())?;
    let normalized = encoded.replace('-', "+").replace('_', "/");
    let padded = format!("{normalized}{}", "=".repeat((4 - normalized.len() % 4) % 4));
    let bytes = BASE64
        .decode(padded)
        .map_err(|error| format!("JWT 解析失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("JWT 解析失败：{error}"))
}

fn string_claim(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(Value::as_str).map(str::to_string)
}

fn normalize_scope(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn random_urlsafe(size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    rng().fill_bytes(&mut bytes);
    base64_url(&bytes)
}

fn base64_url(value: &[u8]) -> String {
    BASE64
        .encode(value)
        .replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

#[cfg(test)]
mod tests;
