use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct EncryptedPayload {
    version: u8,
    alg: String,
    iv: String,
    #[serde(rename = "authTag")]
    auth_tag: String,
    ciphertext: String,
}

pub(super) fn encrypt_secret<T: Serialize>(
    database_key: &str,
    value: &T,
    suffix: &str,
) -> Result<String, String> {
    let key = Sha256::digest(format!("{database_key}{suffix}").as_bytes());
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "创建 OAuth 凭据加密器失败。".to_string())?;
    let mut iv = [0_u8; 12];
    rng().fill_bytes(&mut iv);
    let plaintext = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), plaintext.as_ref())
        .map_err(|_| "加密 OAuth 凭据失败。".to_string())?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .ok_or_else(|| "加密 OAuth 凭据失败。".to_string())?;
    let payload = json!({
        "version": 1,
        "alg": "aes-256-gcm",
        "iv": BASE64.encode(iv),
        "authTag": BASE64.encode(&encrypted[tag_start..]),
        "ciphertext": BASE64.encode(&encrypted[..tag_start])
    });
    Ok(BASE64.encode(serde_json::to_vec(&payload).map_err(|error| error.to_string())?))
}

pub(super) fn decrypt_secret<T: for<'de> Deserialize<'de>>(
    database_key: &str,
    value: &str,
    suffix: &str,
) -> Result<T, String> {
    let payload: EncryptedPayload = serde_json::from_slice(
        &BASE64
            .decode(value)
            .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?,
    )
    .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    if payload.version != 1 || payload.alg != "aes-256-gcm" {
        return Err("OAuth 凭据格式不支持，请重新授权。".to_string());
    }
    let iv = BASE64
        .decode(payload.iv)
        .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    let mut encrypted = BASE64
        .decode(payload.ciphertext)
        .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    encrypted.extend(
        BASE64
            .decode(payload.auth_tag)
            .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?,
    );
    let key = Sha256::digest(format!("{database_key}{suffix}").as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "OAuth 凭据解密失败，请重新授权。".to_string())?;
    let decrypted = cipher
        .decrypt(Nonce::from_slice(&iv), encrypted.as_ref())
        .map_err(|_| "OAuth 凭据解密失败，请重新授权。".to_string())?;
    serde_json::from_slice(&decrypted).map_err(|_| "OAuth 凭据内容无效，请重新授权。".to_string())
}
