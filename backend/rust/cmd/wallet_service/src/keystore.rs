//! Authenticated encryption for BIP39 seed phrases at rest.
//!
//! Seeds are encrypted with AES-256-GCM under a master key supplied through the
//! `TIGEREX_WALLET_MASTER_KEY` environment variable (64 hex characters). The keystore
//! **fails closed**: if the key is missing or malformed, construction returns an error
//! rather than falling back to an unauthenticated or hard-coded key.
//!
//! The stored representation is `base64(nonce || ciphertext || tag)`, where the nonce is a
//! fresh 96-bit random value per encryption. GCM authenticates the ciphertext, so tampering
//! is detected on decrypt.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use rand::RngCore;
use zeroize::Zeroize;

use crate::WalletError;

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const BASE64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// Encrypts and decrypts seed phrases with a caller-supplied 256-bit master key.
pub struct SeedKeystore {
    cipher: Aes256Gcm,
}

impl SeedKeystore {
    /// Builds a keystore from a 32-byte master key.
    pub fn new(key: &[u8; KEY_LEN]) -> Self {
        Self {
            cipher: Aes256Gcm::new_from_slice(key).expect("32-byte key is always valid for AES-256"),
        }
    }

    /// Builds a keystore from the `TIGEREX_WALLET_MASTER_KEY` environment variable.
    ///
    /// Returns an error when the variable is absent, not valid hex, or not exactly 32 bytes.
    pub fn from_env() -> Result<Self, WalletError> {
        let raw = std::env::var("TIGEREX_WALLET_MASTER_KEY").map_err(|_| {
            WalletError::InternalError(
                "TIGEREX_WALLET_MASTER_KEY is not set; refusing to store seed phrases".into(),
            )
        })?;
        let mut bytes = hex::decode(raw.trim()).map_err(|_| {
            WalletError::InternalError("TIGEREX_WALLET_MASTER_KEY must be hex encoded".into())
        })?;
        if bytes.len() != KEY_LEN {
            bytes.zeroize();
            return Err(WalletError::InternalError(format!(
                "TIGEREX_WALLET_MASTER_KEY must decode to {KEY_LEN} bytes"
            )));
        }
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(&bytes);
        bytes.zeroize();
        let keystore = Self::new(&key);
        key.zeroize();
        Ok(keystore)
    }

    /// Encrypts a seed phrase, returning `base64(nonce || ciphertext || tag)`.
    pub fn encrypt(&self, plaintext: &str) -> Result<String, WalletError> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| WalletError::InternalError("seed encryption failed".into()))?;

        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.append(&mut ciphertext);
        Ok(BASE64.encode(out))
    }

    /// Decrypts a value produced by [`SeedKeystore::encrypt`].
    pub fn decrypt(&self, encoded: &str) -> Result<String, WalletError> {
        let mut raw = BASE64
            .decode(encoded)
            .map_err(|_| WalletError::InvalidSeedPhrase)?;
        if raw.len() <= NONCE_LEN {
            raw.zeroize();
            return Err(WalletError::InvalidSeedPhrase);
        }
        let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);

        let mut plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| WalletError::InvalidSeedPhrase)?;
        let phrase = String::from_utf8(plaintext.clone())
            .map_err(|_| WalletError::InvalidSeedPhrase)?;
        plaintext.zeroize();
        raw.zeroize();
        Ok(phrase)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_recovers_plaintext() {
        let keystore = SeedKeystore::new(&[7u8; KEY_LEN]);
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon art";
        let encrypted = keystore.encrypt(phrase).unwrap();
        assert_ne!(encrypted, phrase);
        assert_eq!(keystore.decrypt(&encrypted).unwrap(), phrase);
    }

    #[test]
    fn nonces_are_unique_per_encryption() {
        let keystore = SeedKeystore::new(&[9u8; KEY_LEN]);
        let first = keystore.encrypt("same plaintext").unwrap();
        let second = keystore.encrypt("same plaintext").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let keystore = SeedKeystore::new(&[3u8; KEY_LEN]);
        let mut raw = BASE64.decode(keystore.encrypt("secret phrase").unwrap()).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        assert!(keystore.decrypt(&BASE64.encode(raw)).is_err());
    }

    #[test]
    fn wrong_key_cannot_decrypt() {
        let encrypted = SeedKeystore::new(&[1u8; KEY_LEN]).encrypt("secret phrase").unwrap();
        assert!(SeedKeystore::new(&[2u8; KEY_LEN]).decrypt(&encrypted).is_err());
    }

    #[test]
    fn missing_env_key_fails_closed() {
        std::env::remove_var("TIGEREX_WALLET_MASTER_KEY");
        assert!(SeedKeystore::from_env().is_err());
    }
}
