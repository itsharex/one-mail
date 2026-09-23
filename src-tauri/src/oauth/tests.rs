use super::provider::MicrosoftOAuthProvider;
use reqwest::StatusCode;

use super::{
    is_email, is_reauthorization_required, normalize_scope, token_response_error, OAuthProvider,
    Serializer, TokenResponse,
};

#[test]
fn microsoft_authorization_prompts_for_account_selection() {
    let provider = MicrosoftOAuthProvider;
    let mut params = Serializer::new(String::new());
    provider.authorization_parameters(&mut params);

    assert!(params.finish().contains("prompt=select_account"));
}

#[test]
fn validates_mailbox_claims_without_accepting_non_emails() {
    assert!(is_email("person@example.com"));
    assert!(!is_email("person"));
    assert_eq!(
        normalize_scope(" HTTPS://EXAMPLE.COM/ "),
        "https://example.com/"
    );
}

#[test]
fn token_response_error_preserves_oauth_error_code() {
    let payload = TokenResponse {
        access_token: None,
        id_token: None,
        refresh_token: None,
        token_type: None,
        expires_in: None,
        scope: None,
        error: Some("invalid_grant".to_string()),
        error_description: Some("refresh token expired".to_string()),
    };

    assert_eq!(
        token_response_error(&payload, StatusCode::BAD_REQUEST, "google"),
        "google OAuth 返回 invalid_grant：refresh token expired"
    );
}

#[test]
fn only_provider_interaction_errors_require_reauthorization() {
    assert!(is_reauthorization_required(
        "google OAuth 返回 invalid_grant：refresh token expired"
    ));
    assert!(is_reauthorization_required(
        "microsoft OAuth 返回 interaction_required：AADSTS50076"
    ));
    assert!(!is_reauthorization_required(
        "刷新 google OAuth 失败：error sending request"
    ));
    assert!(!is_reauthorization_required(
        "解析 microsoft OAuth 响应失败：expected value"
    ));
}
