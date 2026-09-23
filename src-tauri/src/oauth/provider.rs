use std::{collections::HashSet, time::Duration};

use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use url::form_urlencoded::Serializer;

use super::{
    decode_jwt_payload, first_email, normalize_scope, string_claim, OAuthProvider, OAuthToken,
    TokenResponse,
};

const MICROSOFT_CLIENT_ID: &str = "2d9a4659-0a30-4622-8113-0f72b632d176";
const MICROSOFT_SCOPES: &[&str] = &[
    "openid",
    "profile",
    "email",
    "offline_access",
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
];
const GOOGLE_AUTHORITY: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: &[&str] = &["openid", "profile", "email", "https://mail.google.com/"];

pub(super) struct MicrosoftOAuthProvider;
struct GoogleOAuthProvider;

#[async_trait]
impl OAuthProvider for MicrosoftOAuthProvider {
    fn key(&self) -> &'static str {
        "microsoft"
    }

    fn client_id(&self) -> Result<String, String> {
        Ok(std::env::var("ONEMAIL_MICROSOFT_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| MICROSOFT_CLIENT_ID.to_string()))
    }

    fn authorization_endpoint(&self) -> &'static str {
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    }

    fn token_endpoint(&self) -> &'static str {
        "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    }

    fn scopes(&self) -> &'static [&'static str] {
        MICROSOFT_SCOPES
    }

    fn authorization_parameters(&self, params: &mut Serializer<String>) {
        params.append_pair("response_type", "code");
        params.append_pair("response_mode", "query");
        params.append_pair("prompt", "select_account");
    }

    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String> {
        let access = decode_jwt_payload(&token.access_token).unwrap_or_default();
        let id =
            decode_jwt_payload(token.id_token.as_deref().unwrap_or_default()).unwrap_or_default();
        first_email([
            string_claim(&access, "upn"),
            string_claim(&access, "preferred_username"),
            string_claim(&access, "unique_name"),
            string_claim(&access, "email"),
            string_claim(&id, "preferred_username"),
            string_claim(&id, "email"),
            string_claim(&id, "upn"),
        ])
        .ok_or_else(|| "Microsoft OAuth 未返回可用的 Outlook 邮箱地址。".to_string())
    }

    fn validate_token(&self, response: &TokenResponse, token: &OAuthToken) -> Result<(), String> {
        let granted = response
            .scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(normalize_scope)
            .collect::<HashSet<_>>();
        if !granted.is_empty()
            && (!granted.contains("https://outlook.office.com/imap.accessasuser.all")
                || !granted.contains("https://outlook.office.com/smtp.send"))
        {
            return Err("Microsoft OAuth 未授予 Outlook IMAP/SMTP 权限，请重新授权。".to_string());
        }

        let access = decode_jwt_payload(&token.access_token).unwrap_or_default();
        if let Some(audience) = string_claim(&access, "aud") {
            let audience = normalize_scope(&audience).trim_end_matches('/').to_string();
            let allowed = [
                "https://outlook.office.com",
                "https://outlook.office365.com",
                "00000002-0000-0ff1-ce00-000000000000",
            ];
            if !allowed.iter().any(|item| *item == audience) {
                return Err(
                    "Microsoft OAuth 返回的 access token 不是 Outlook IMAP 可用的 token。"
                        .to_string(),
                );
            }
        }
        Ok(())
    }
}

#[async_trait]
impl OAuthProvider for GoogleOAuthProvider {
    fn key(&self) -> &'static str {
        "google"
    }

    fn client_id(&self) -> Result<String, String> {
        std::env::var("ONEMAIL_GOOGLE_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "缺少 ONEMAIL_GOOGLE_CLIENT_ID，请配置 Google 桌面 OAuth 客户端。".to_string()
            })
    }

    fn authorization_endpoint(&self) -> &'static str {
        GOOGLE_AUTHORITY
    }

    fn token_endpoint(&self) -> &'static str {
        GOOGLE_TOKEN_URL
    }

    fn scopes(&self) -> &'static [&'static str] {
        GOOGLE_SCOPES
    }

    fn authorization_parameters(&self, params: &mut Serializer<String>) {
        params.append_pair("access_type", "offline");
        params.append_pair("prompt", "consent");
        params.append_pair("include_granted_scopes", "true");
    }

    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String> {
        let id =
            decode_jwt_payload(token.id_token.as_deref().unwrap_or_default()).unwrap_or_default();
        if let Some(email) = first_email([string_claim(&id, "email")]) {
            return Ok(email);
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("创建 Google 账号信息请求客户端失败：{error}"))?;
        let response = client
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|error| format!("读取 Google 账号邮箱失败：{error}"))?;
        let payload: Value = response
            .json()
            .await
            .map_err(|error| format!("解析 Google 账号信息失败：{error}"))?;
        first_email([payload
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string)])
        .ok_or_else(|| "Google OAuth 未返回可用的 Gmail 邮箱地址。".to_string())
    }

    fn validate_token(&self, response: &TokenResponse, _token: &OAuthToken) -> Result<(), String> {
        let granted = response
            .scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(normalize_scope)
            .collect::<HashSet<_>>();
        if !granted.is_empty() && !granted.contains("https://mail.google.com/") {
            return Err("Google OAuth 未授予 Gmail 访问权限，请重新授权。".to_string());
        }
        Ok(())
    }
}

pub fn provider_for(provider_key: &str) -> Result<Box<dyn OAuthProvider>, String> {
    match provider_key.to_ascii_lowercase().as_str() {
        "gmail" | "google" => Ok(Box::new(GoogleOAuthProvider)),
        "outlook" | "microsoft" => Ok(Box::new(MicrosoftOAuthProvider)),
        _ => Err(format!("不支持 OAuth 服务商：{provider_key}")),
    }
}
