//! Security primitives for the auth service.
//!
//! * API keys are shown once and stored as salted SHA-256 digests, never in
//!   plaintext; verification is constant-time.
//! * Request signing uses HMAC-SHA256 with a timestamp window to reject
//!   replays.
//! * Secrets at rest (TOTP seeds, API secrets) are sealed with AES-256-GCM so a
//!   database leak does not disclose them.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

/// Errors from the security helpers.
#[derive(Debug, PartialEq, Eq)]
pub enum SecurityError {
    /// A signing/verification MAC failed.
    BadSignature,
    /// The request timestamp was outside the accepted window (replay).
    TimestampOutOfWindow,
    /// Ciphertext was malformed or failed authentication.
    DecryptFailed,
    /// The key/secret material was empty or the wrong length.
    BadKey,
}

/// Result of generating an API key. `secret` is returned exactly once.
#[derive(Debug)]
pub struct GeneratedApiKey {
    /// Public identifier embedded in requests, e.g. `tk_ab12...`.
    pub key_id: String,
    /// Secret shown to the user once.
    pub secret: String,
    /// Value to persist for verification (never the plaintext secret).
    pub stored: StoredApiKey,
}

/// Persisted API-key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredApiKey {
    pub key_id: String,
    pub salt: [u8; 16],
    pub digest: [u8; 32],
}

/// Generate a new API key pair.
pub fn generate_api_key() -> GeneratedApiKey {
    let mut rng = OsRng;
    let mut id_bytes = [0u8; 12];
    let mut secret_bytes = [0u8; 32];
    let mut salt = [0u8; 16];
    rng.fill_bytes(&mut id_bytes);
    rng.fill_bytes(&mut secret_bytes);
    rng.fill_bytes(&mut salt);

    let key_id = format!("tk_{}", hex::encode(id_bytes));
    let secret = hex::encode(secret_bytes);
    let digest = api_key_digest(&salt, &secret);
    GeneratedApiKey {
        key_id: key_id.clone(),
        secret,
        stored: StoredApiKey { key_id, salt, digest },
    }
}

fn api_key_digest(salt: &[u8; 16], secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(secret.as_bytes());
    hasher.finalize().into()
}

/// Verify a presented secret against the stored digest in constant time.
pub fn verify_api_key(stored: &StoredApiKey, presented_secret: &str) -> bool {
    let candidate = api_key_digest(&stored.salt, presented_secret);
    candidate.ct_eq(&stored.digest).unwrap_u8() == 1
}

/// Compute the hex HMAC-SHA256 of a request payload.
pub fn sign_request(secret: &[u8], timestamp: i64, payload: &str) -> Result<String, SecurityError> {
    if secret.is_empty() {
        return Err(SecurityError::BadKey);
    }
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(secret).map_err(|_| SecurityError::BadKey)?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(payload.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// Verify a signed request, rejecting a stale timestamp (replay protection).
///
/// `window_seconds` bounds the acceptable clock skew in each direction.
pub fn verify_request(
    secret: &[u8],
    timestamp: i64,
    payload: &str,
    signature_hex: &str,
    now: i64,
    window_seconds: i64,
) -> Result<(), SecurityError> {
    if (now - timestamp).abs() > window_seconds {
        return Err(SecurityError::TimestampOutOfWindow);
    }
    let expected = sign_request(secret, timestamp, payload)?;
    let provided = hex::decode(signature_hex).map_err(|_| SecurityError::BadSignature)?;
    let expected_bytes = hex::decode(&expected).map_err(|_| SecurityError::BadSignature)?;
    if expected_bytes.ct_eq(&provided).unwrap_u8() == 1 {
        Ok(())
    } else {
        Err(SecurityError::BadSignature)
    }
}

/// AES-256-GCM sealing of secrets at rest.
pub struct SecretBox {
    cipher: Aes256Gcm,
}

impl SecretBox {
    /// `key` must be exactly 32 bytes (from the KMS/HSM).
    pub fn new(key: &[u8]) -> Result<Self, SecurityError> {
        if key.len() != 32 {
            return Err(SecurityError::BadKey);
        }
        Ok(Self { cipher: Aes256Gcm::new_from_slice(key).map_err(|_| SecurityError::BadKey)? })
    }

    /// Encrypt `plaintext`, returning `nonce || ciphertext` as hex.
    pub fn seal(&self, plaintext: &str) -> Result<String, SecurityError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|_| SecurityError::DecryptFailed)?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ciphertext);
        Ok(hex::encode(out))
    }

    /// Decrypt a value produced by [`SecretBox::seal`].
    pub fn open(&self, sealed_hex: &str) -> Result<String, SecurityError> {
        let raw = hex::decode(sealed_hex).map_err(|_| SecurityError::DecryptFailed)?;
        if raw.len() < 12 {
            return Err(SecurityError::DecryptFailed);
        }
        let (nonce_bytes, ciphertext) = raw.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| SecurityError::DecryptFailed)?;
        String::from_utf8(plaintext).map_err(|_| SecurityError::DecryptFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_round_trip_and_rejection() {
        let generated = generate_api_key();
        assert!(generated.key_id.starts_with("tk_"));
        assert!(verify_api_key(&generated.stored, &generated.secret));
        assert!(!verify_api_key(&generated.stored, "deadbeef"));
    }

    #[test]
    fn request_signing_verifies_and_rejects_stale() {
        let secret = b"top-secret-hmac-key";
        let now = 1_700_000_000i64;
        let sig = sign_request(secret, now, "{\"a\":1}").unwrap();
        assert!(verify_request(secret, now, "{\"a\":1}", &sig, now, 30).is_ok());
        // Tampered payload fails.
        assert_eq!(
            verify_request(secret, now, "{\"a\":2}", &sig, now, 30),
            Err(SecurityError::BadSignature)
        );
        // Stale timestamp fails (replay).
        assert_eq!(
            verify_request(secret, now, "{\"a\":1}", &sig, now + 120, 30),
            Err(SecurityError::TimestampOutOfWindow)
        );
    }

    #[test]
    fn empty_secret_is_rejected() {
        assert_eq!(sign_request(&[], 0, "x"), Err(SecurityError::BadKey));
    }

    #[test]
    fn secret_box_round_trip_and_tamper_detection() {
        let key = [7u8; 32];
        let sb = SecretBox::new(&key).unwrap();
        let sealed = sb.seal("JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(sb.open(&sealed).unwrap(), "JBSWY3DPEHPK3PXP");
        // Flip a ciphertext byte: authentication must fail.
        let mut tampered = sealed.clone().into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'0' { b'1' } else { b'0' };
        assert_eq!(
            sb.open(&String::from_utf8(tampered).unwrap()),
            Err(SecurityError::DecryptFailed)
        );
    }

    #[test]
    fn secret_box_rejects_short_key() {
        assert!(matches!(SecretBox::new(&[0u8; 16]), Err(SecurityError::BadKey)));
    }
}
