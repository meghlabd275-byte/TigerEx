//! TigerEx cryptographic operations.
//!
//! Every primitive here is a real, standard implementation: SHA-256 and
//! HMAC-SHA256 from RustCrypto, AES-256-GCM for authenticated encryption,
//! Argon2id for password hashing, Ed25519 for signatures, and the OS CSPRNG for
//! randomness. Nothing is a hand-rolled or "simplified" stand-in.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// AES-256-GCM nonce length in bytes.
pub const GCM_NONCE_LEN: usize = 12;

/// SHA-256 digest.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// HMAC-SHA256 over `data` keyed by `key`.
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// Fill `length` bytes from the operating system CSPRNG.
pub fn generate_random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

/// Encrypt with AES-256-GCM. The output is `nonce || ciphertext || tag`.
pub fn aes_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    if key.len() != 32 {
        return Vec::new();
    }
    let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    let mut nonce_bytes = [0u8; GCM_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    match cipher.encrypt(nonce, data) {
        Ok(ciphertext) => {
            let mut out = Vec::with_capacity(GCM_NONCE_LEN + ciphertext.len());
            out.extend_from_slice(&nonce_bytes);
            out.extend_from_slice(&ciphertext);
            out
        }
        Err(_) => Vec::new(),
    }
}

/// Decrypt an `aes_encrypt` blob. Returns an empty vector when the key is the
/// wrong length, the blob is truncated, or authentication fails -- a tampered
/// ciphertext never yields plaintext.
pub fn aes_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    if key.len() != 32 || data.len() < GCM_NONCE_LEN {
        return Vec::new();
    }
    let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    let nonce = Nonce::from_slice(&data[..GCM_NONCE_LEN]);
    match cipher.decrypt(nonce, &data[GCM_NONCE_LEN..]) {
        Ok(plaintext) => plaintext,
        Err(_) => Vec::new(),
    }
}

/// Standard base64 (with padding).
pub fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Decode standard base64, returning an empty vector on malformed input.
pub fn base64_decode(data: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .unwrap_or_default()
}

/// Hash a password with Argon2id, returning the PHC string (salt included).
pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Argon2 hashing is infallible for a valid salt")
        .to_string()
}

/// Verify a password against an Argon2id PHC string.
pub fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Sign `data` with an Ed25519 private key (32-byte seed), returning the
/// 64-byte signature. Returns `None` when the seed is not 32 bytes.
pub fn sign(data: &[u8], private_key: &[u8]) -> Option<Vec<u8>> {
    let seed: [u8; 32] = private_key.try_into().ok()?;
    let signing_key = SigningKey::from_bytes(&seed);
    Some(signing_key.sign(data).to_bytes().to_vec())
}

/// Verify an Ed25519 signature against a 32-byte public key. Fails closed on a
/// malformed key or signature.
pub fn verify(signature: &[u8], data: &[u8], public_key: &[u8]) -> bool {
    let key_bytes: [u8; 32] = match public_key.try_into() {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let verifying_key = match VerifyingKey::from_bytes(&key_bytes) {
        Ok(key) => key,
        Err(_) => return false,
    };
    let sig_bytes: [u8; 64] = match signature.try_into() {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let signature = Signature::from_bytes(&sig_bytes);
    verifying_key.verify(data, &signature).is_ok()
}

/// Derive the Ed25519 public key for a 32-byte private seed.
pub fn public_key_from_private(private_key: &[u8]) -> Option<Vec<u8>> {
    let seed: [u8; 32] = private_key.try_into().ok()?;
    Some(SigningKey::from_bytes(&seed).verifying_key().to_bytes().to_vec())
}

/// Constant-time comparison (prevents timing side channels).
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            hex::encode(sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_vector() {
        // RFC 4231 test case 1: key = 20 bytes of 0x0b.
        let key = [0x0bu8; 20];
        let data = b"Hi There";
        assert_eq!(
            hex::encode(hmac_sha256(&key, data)),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn aes_gcm_round_trips_and_rejects_tampering() {
        let key = generate_random_bytes(32);
        let plaintext = b"attack at dawn";
        let sealed = aes_encrypt(plaintext, &key);
        assert_eq!(aes_decrypt(&sealed, &key), plaintext);

        let mut tampered = sealed.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(aes_decrypt(&tampered, &key).is_empty());

        let wrong = generate_random_bytes(32);
        assert!(aes_decrypt(&sealed, &wrong).is_empty());
    }

    #[test]
    fn base64_round_trips() {
        let data = b"hello world";
        assert_eq!(base64_decode(&base64_encode(data)), data);
        assert!(base64_decode("not*valid*base64").is_empty());
    }

    #[test]
    fn argon2_passwords_verify() {
        let hash = hash_password("securepassword123");
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("securepassword123", &hash));
        assert!(!verify_password("wrong", &hash));
        assert!(!verify_password("securepassword123", "not-a-phc-string"));
    }

    #[test]
    fn ed25519_signatures_verify() {
        let seed = generate_random_bytes(32);
        let public = public_key_from_private(&seed).unwrap();
        let signature = sign(b"transfer 1 BTC", &seed).unwrap();
        assert!(verify(&signature, b"transfer 1 BTC", &public));
        assert!(!verify(&signature, b"transfer 2 BTC", &public));
        assert!(!verify(&signature[..10], b"transfer 1 BTC", &public));
    }

    #[test]
    fn random_bytes_are_not_constant() {
        assert_ne!(generate_random_bytes(32), generate_random_bytes(32));
    }

    #[test]
    fn constant_time_compare_is_correct() {
        assert!(constant_time_compare(b"same", b"same"));
        assert!(!constant_time_compare(b"same", b"diff"));
        assert!(!constant_time_compare(b"short", b"longer"));
    }
}
