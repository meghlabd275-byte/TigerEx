// Signing Engine - Transaction Signing and Verification
// Rust for cryptographic signing operations

use std::collections::HashMap;

use ed25519_dalek::{Signature as Ed25519Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};

// Signature type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SigType {
    Ed25519,
    Secp256k1,
}

// Signature
#[derive(Debug, Clone)]
pub struct Signature {
    pub id: String,
    pub sig_type: SigType,
    pub public_key: String,
    pub signature: String,
    pub message_hash: String,
    pub timestamp: i64,
}

// Signed transaction
#[derive(Debug, Clone)]
pub struct SignedTx {
    pub tx_id: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub signature: String,
    pub nonce: u64,
    pub chain_id: u64,
}

// Verification result
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyResult {
    Valid,
    Invalid,
    InvalidSignature,
    Expired,
}

enum KeyMaterial {
    Ed25519(SigningKey),
    Secp256k1(SecretKey),
}

// Signing engine
pub struct SigningEngine {
    keys: HashMap<String, KeyMaterial>,
    verifying_keys: HashMap<String, VerifyingKey>,
    signatures: Vec<Signature>,
    nonces: HashMap<String, u64>,
}

impl Default for SigningEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SigningEngine {
    pub fn new() -> Self {
        SigningEngine {
            keys: HashMap::new(),
            verifying_keys: HashMap::new(),
            signatures: Vec::new(),
            nonces: HashMap::new(),
        }
    }

    /// Generate an Ed25519 key pair for an address and return the public key
    /// as lowercase hex.
    pub fn generate_key(&mut self, address: &str) -> String {
        let signing_key = SigningKey::generate(&mut OsRng);
        let public_key = hex::encode(signing_key.verifying_key().to_bytes());
        self.verifying_keys
            .insert(address.to_string(), signing_key.verifying_key());
        self.keys
            .insert(address.to_string(), KeyMaterial::Ed25519(signing_key));
        public_key
    }

    /// Generate a secp256k1 key pair for an address and return the compressed
    /// public key as lowercase hex.
    pub fn generate_secp256k1_key(&mut self, address: &str) -> String {
        let (secret_key, public_key) = Secp256k1::new().generate_keypair(&mut OsRng);
        self.keys
            .insert(address.to_string(), KeyMaterial::Secp256k1(secret_key));
        hex::encode(public_key.serialize())
    }

    /// Import a raw 32-byte Ed25519 secret key (hex encoded).
    pub fn import_secret_key(&mut self, address: &str, secret_hex: &str) -> Result<(), String> {
        let bytes = hex::decode(secret_hex).map_err(|e| format!("invalid hex: {}", e))?;
        let array: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "secret key must be 32 bytes".to_string())?;
        let signing_key = SigningKey::from_bytes(&array);
        self.verifying_keys
            .insert(address.to_string(), signing_key.verifying_key());
        self.keys
            .insert(address.to_string(), KeyMaterial::Ed25519(signing_key));
        Ok(())
    }

    /// Register an Ed25519 public key so externally produced signatures can be
    /// verified without holding the private key.
    pub fn register_verifying_key(
        &mut self,
        address: &str,
        public_key_hex: &str,
    ) -> Result<(), String> {
        let bytes = hex::decode(public_key_hex).map_err(|e| format!("invalid hex: {}", e))?;
        let array: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "public key must be 32 bytes".to_string())?;
        let verifying_key =
            VerifyingKey::from_bytes(&array).map_err(|e| format!("invalid public key: {}", e))?;
        self.verifying_keys.insert(address.to_string(), verifying_key);
        Ok(())
    }

    /// Sign a message with the key registered for the address.
    pub fn sign(&mut self, address: &str, message: &str) -> Result<Signature, String> {
        let key = self.keys.get(address).ok_or("key not found")?;
        let message_hash = hex::encode(Sha256::digest(message.as_bytes()));

        let (sig_type, signature_hex, public_key_hex) = match key {
            KeyMaterial::Ed25519(signing_key) => {
                let signature = signing_key.sign(message.as_bytes());
                (
                    SigType::Ed25519,
                    hex::encode(signature.to_bytes()),
                    hex::encode(signing_key.verifying_key().to_bytes()),
                )
            }
            KeyMaterial::Secp256k1(secret_key) => {
                let secp = Secp256k1::new();
                let digest = Sha256::digest(message.as_bytes());
                let msg = Message::from_digest_slice(digest.as_slice())
                    .map_err(|e| format!("invalid message: {}", e))?;
                let signature = secp.sign_ecdsa(&msg, secret_key);
                (
                    SigType::Secp256k1,
                    hex::encode(signature.serialize_compact()),
                    hex::encode(PublicKey::from_secret_key(&secp, secret_key).serialize()),
                )
            }
        };

        let signature = Signature {
            id: format!("sig_{}", &signature_hex[..signature_hex.len().min(32)]),
            sig_type,
            public_key: public_key_hex,
            signature: signature_hex,
            message_hash,
            timestamp: now_ms(),
        };

        self.signatures.push(signature.clone());
        Ok(signature)
    }

    /// Verify a signature over a message. Fails closed: any decoding or
    /// verification error yields a non-Valid result.
    pub fn verify(&self, address: &str, message: &str, signature_hex: &str) -> VerifyResult {
        let key = match self.keys.get(address) {
            Some(k) => k,
            None => return VerifyResult::Invalid,
        };

        let sig_bytes = match hex::decode(signature_hex) {
            Ok(b) => b,
            Err(_) => return VerifyResult::InvalidSignature,
        };

        match key {
            KeyMaterial::Ed25519(_) => {
                let verifying_key = match self.verifying_keys.get(address) {
                    Some(vk) => vk,
                    None => return VerifyResult::Invalid,
                };

                let signature = match Ed25519Signature::from_slice(&sig_bytes) {
                    Ok(s) => s,
                    Err(_) => return VerifyResult::InvalidSignature,
                };

                if verifying_key.verify(message.as_bytes(), &signature).is_ok() {
                    VerifyResult::Valid
                } else {
                    VerifyResult::InvalidSignature
                }
            }
            KeyMaterial::Secp256k1(secret_key) => {
                let secp = Secp256k1::new();
                let public_key = PublicKey::from_secret_key(&secp, secret_key);
                let digest = Sha256::digest(message.as_bytes());
                let msg = match Message::from_digest_slice(digest.as_slice()) {
                    Ok(m) => m,
                    Err(_) => return VerifyResult::InvalidSignature,
                };
                let signature = match secp256k1::ecdsa::Signature::from_compact(&sig_bytes) {
                    Ok(s) => s,
                    Err(_) => return VerifyResult::InvalidSignature,
                };
                if secp.verify_ecdsa(&msg, &signature, &public_key).is_ok() {
                    VerifyResult::Valid
                } else {
                    VerifyResult::InvalidSignature
                }
            }
        }
    }

    /// Sign a transfer and return the signed transaction.
    pub fn sign_transaction(
        &mut self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<SignedTx, String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("amount must be a positive finite number".to_string());
        }
        if from == to {
            return Err("sender and recipient must differ".to_string());
        }

        let nonce = *self.nonces.get(from).unwrap_or(&0);
        let msg = transaction_message(from, to, amount, nonce);

        let signature = self.sign(from, &msg)?;

        let tx_id = {
            let mut hasher = Sha256::new();
            hasher.update(from.as_bytes());
            hasher.update(to.as_bytes());
            hasher.update(amount.to_be_bytes());
            hasher.update(nonce.to_be_bytes());
            hasher.update(signature.signature.as_bytes());
            format!("tx_{}", hex::encode(hasher.finalize()))
        };

        let tx = SignedTx {
            tx_id,
            from: from.to_string(),
            to: to.to_string(),
            amount,
            signature: signature.signature,
            nonce,
            chain_id: 1,
        };

        self.nonces.insert(from.to_string(), nonce + 1);
        Ok(tx)
    }

    /// Verify a signed transaction against its registered key.
    pub fn verify_transaction(&self, tx: &SignedTx) -> VerifyResult {
        let msg = transaction_message(&tx.from, &tx.to, tx.amount, tx.nonce);
        self.verify(&tx.from, &msg, &tx.signature)
    }
}

fn transaction_message(from: &str, to: &str, amount: f64, nonce: u64) -> String {
    format!("{}:{}:{}:{}", from, to, amount, nonce)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_verifies_for_matching_message() {
        let mut engine = SigningEngine::new();
        engine.generate_key("0xuser");

        let sig = engine.sign("0xuser", "test message").unwrap();
        assert_eq!(
            engine.verify("0xuser", "test message", &sig.signature),
            VerifyResult::Valid
        );
    }

    #[test]
    fn signature_rejected_for_tampered_message() {
        let mut engine = SigningEngine::new();
        engine.generate_key("0xuser");

        let sig = engine.sign("0xuser", "test message").unwrap();
        assert_ne!(
            engine.verify("0xuser", "tampered message", &sig.signature),
            VerifyResult::Valid
        );
    }

    #[test]
    fn signature_rejected_for_garbage_input() {
        let mut engine = SigningEngine::new();
        engine.generate_key("0xuser");

        assert_eq!(
            engine.verify("0xuser", "test message", "0xdeadbeef"),
            VerifyResult::InvalidSignature
        );
        assert_eq!(
            engine.verify("0xunknown", "test message", "0x00"),
            VerifyResult::Invalid
        );
    }

    #[test]
    fn secp256k1_signatures_round_trip() {
        let mut engine = SigningEngine::new();
        engine.generate_secp256k1_key("0xsecp");

        let sig = engine.sign("0xsecp", "hello").unwrap();
        assert_eq!(sig.sig_type, SigType::Secp256k1);
        assert_eq!(
            engine.verify("0xsecp", "hello", &sig.signature),
            VerifyResult::Valid
        );
        assert_ne!(
            engine.verify("0xsecp", "hello!", &sig.signature),
            VerifyResult::Valid
        );
    }

    #[test]
    fn transaction_round_trip_and_nonce_progresses() {
        let mut engine = SigningEngine::new();
        engine.generate_key("0xalice");
        engine.generate_key("0xbob");

        let tx = engine.sign_transaction("0xalice", "0xbob", 10.0).unwrap();
        assert_eq!(engine.verify_transaction(&tx), VerifyResult::Valid);
        assert_eq!(tx.nonce, 0);

        let tx2 = engine.sign_transaction("0xalice", "0xbob", 5.0).unwrap();
        assert_eq!(tx2.nonce, 1);

        let mut tampered = tx2.clone();
        tampered.amount = 1000.0;
        assert_ne!(engine.verify_transaction(&tampered), VerifyResult::Valid);
    }

    #[test]
    fn rejects_invalid_transfer_amounts() {
        let mut engine = SigningEngine::new();
        engine.generate_key("0xalice");

        assert!(engine.sign_transaction("0xalice", "0xbob", 0.0).is_err());
        assert!(engine.sign_transaction("0xalice", "0xbob", -1.0).is_err());
        assert!(engine.sign_transaction("0xalice", "0xalice", 1.0).is_err());
    }
}
