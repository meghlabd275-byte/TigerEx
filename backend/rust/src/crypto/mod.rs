//! Cryptographic primitives for TigerEx
//! 
//! AES-GCM encryption, Ed25519 signatures, secp256k1 elliptic curve operations

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use secp256k1::Secp256k1;
use sha2::{Digest, Sha256};

/// Encrypt data using AES-256-GCM
pub fn encrypt_aes256(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_key(*key).map_err(|e| e.to_string())?;
    
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;
    
    let mut result = Vec::withCapacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt data using AES-256-GCM
pub fn decrypt_aes256(key: &[u8; 32], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if ciphertext.len() < 12 {
        return Err("Ciphertext too short".to_string());
    }
    
    let cipher = Aes256Gcm::new_from_key(*key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&ciphertext[..12]);
    let encrypted = &ciphertext[12..];
    
    cipher.decrypt(nonce, encrypted).map_err(|e| e.to_string())
}

/// Hash password using Argon2id
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string()
        .parse::<PasswordHash>()
        .map_err(|e| e.to_string())?;
    
    Ok(argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string())
}

/// Verify password against hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    let parsed_hash = PasswordHash::new(hash).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Generate Ed25519 keypair
pub fn generate_ed25519_keypair() -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

/// Sign message with Ed25519
pub fn sign_ed25519(message: &[u8], signing_key: &SigningKey) -> Signature {
    signing_key.sign(message)
}

/// Verify Ed25519 signature
pub fn verify_ed25519(message: &[u8], signature: &Signature, verifying_key: &VerifyingKey) -> bool {
    verifying_key.verify(message, signature).is_ok()
}

/// Generate Secp256k1 keypair
pub fn generate_secp256k1_keypair() -> (Vec<u8>, Vec<u8>) {
    let secp = Secp256k1::new();
    let (secret_key, public_key) = secp.generate_keypair(&mut OsRng);
    
    let secret_bytes = secret_key.as_ref().to_vec();
    let compressed = public_key.serialize_compressed();
    let public_bytes = compressed.to_vec();
    
    (secret_bytes, public_bytes)
}

/// Sign message with Secp256k1
pub fn sign_secp256k1(message: &[u8], private_key: &[u8]) -> Result<Vec<u8>, String> {
    let secp = Secp256k1::new();
    let secret = secp256k1::SecretKey::from_slice(private_key).map_err(|e| e.to_string())?;
    let signature = secp.sign_message_ecdsa(message, &secret, &mut OsRng);
    Ok(signature.to_compact_enco())
}

/// Verify Secp256k1 signature
pub fn verify_secp256k1(message: &[u8], signature: &[u8], public_key: &[u8]) -> Result<bool, String> {
    let secp = Secp256k1::new();
    let public = secp256k1::PublicKey::from_slice(public_key).map_err(|e| e.to_string())?;
    let sig = secp256k1::Signature::parse_compact(signature).map_err(|e| e.to_string())?;
    Ok(secp.verify_ecdsa(message, &sig, &public).is_ok())
}

/// SHA-256 hash
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let key = [0u8; 32];
        let plaintext = b"Hello, TigerEx!";
        
        let ciphertext = encrypt_aes256(&key, plaintext).unwrap();
        let decrypted = decrypt_aes256(&key, &ciphertext).unwrap();
        
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_password_hash() {
        let password = "secure_password_123";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_ed25519_signing() {
        let (signing_key, verifying_key) = generate_ed25519_keypair();
        let message = b"Test message";
        let signature = sign_ed25519(message, &signing_key);
        
        assert!(verify_ed25519(message, &signature, &verifying_key));
    }
}