//! Hashing module
//! 
//! Provides secure hashing functions

use sha2::{Sha256, Sha512, Digest};
use crate::errors::{Result, SecurityError};

/// SHA-256 hash function
pub fn sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// SHA-512 hash function
pub fn sha512(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha512::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Compute SHA-256 hash and return as hex string
pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(sha256(data))
}

/// Compute SHA-512 hash and return as hex string
pub fn sha512_hex(data: &[u8]) -> String {
    hex::encode(sha512(data))
}

/// Password hashing using Argon2
pub mod password {
    use argon2::{
        password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
        Argon2,
    };
    use crate::errors::{Result, SecurityError};

    /// Hash a password using Argon2
    pub fn hash_password(password: &str) -> Result<String> {
        let salt = SaltString::generate(&mut rand::thread_rng());
        let argon2 = Argon2::default();
        
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| SecurityError::HashingError(e.to_string()))?
            .to_string();
        
        Ok(password_hash)
    }

    /// Verify a password against a hash
    pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
        let parsed_hash = PasswordHash::new(hash)
            .map_err(|e| SecurityError::InvalidHash(e.to_string()))?;
        
        let argon2 = Argon2::default();
        
        Ok(argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok())
    }

    /// Check if a password is strong enough
    pub fn check_strength(password: &str) -> PasswordStrength {
        let mut score = 0;
        
        // Length check
        if password.len() >= 8 { score += 1; }
        if password.len() >= 12 { score += 1; }
        if password.len() >= 16 { score += 1; }
        
        // Character type checks
        if password.chars().any(|c| c.is_uppercase()) { score += 1; }
        if password.chars().any(|c| c.is_lowercase()) { score += 1; }
        if password.chars().any(|c| c.is_numeric()) { score += 1; }
        if password.chars().any(|c| !c.is_alphanumeric()) { score += 1; }
        
        match score {
            0..=2 => PasswordStrength::Weak,
            3..=4 => PasswordStrength::Fair,
            5..=6 => PasswordStrength::Good,
            _ => PasswordStrength::Strong,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum PasswordStrength {
    Weak,
    Fair,
    Good,
    Strong,
}

/// HMAC-SHA256
pub mod hmac {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use crate::errors::{Result, SecurityError};
    
    type HmacSha256 = Hmac<Sha256>;
    
    /// Create HMAC-SHA256
    pub fn create(key: &[u8], message: &[u8]) -> Result<Vec<u8>> {
        let mut mac = HmacSha256::new_from_slice(key)
            .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
        
        mac.update(message);
        
        Ok(mac.finalize().into_bytes().to_vec())
    }
    
    /// Verify HMAC-SHA256
    pub fn verify(key: &[u8], message: &[u8], expected: &[u8]) -> bool {
        if let Ok(computed) = create(key, message) {
            // Constant-time comparison
            if computed.len() != expected.len() {
                return false;
            }
            
            computed.iter()
                .zip(expected.iter())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
        } else {
            false
        }
    }
    
    /// Create HMAC-SHA256 and return hex string
    pub fn create_hex(key: &[u8], message: &[u8]) -> Result<String> {
        Ok(hex::encode(create(key, message)?))
    }
}

/// PBKDF2 key derivation
pub mod pbkdf2 {
    use crate::errors::{Result, SecurityError};
    
    /// Derive a key using PBKDF2
    /// 
    /// Note: For new applications, consider using Argon2 instead
    pub fn derive_key(password: &[u8], salt: &[u8], iterations: u32, key_length: usize) -> Result<Vec<u8>> {
        use std::num::NonZeroU32;
        
        let iterations = NonZeroU32::new(iterations)
            .ok_or_else(|| SecurityError::InvalidData("Invalid iteration count".to_string()))?;
        
        let mut key = vec![0u8; key_length];
        
        // Simple PBKDF2-like derivation using HMAC-SHA256
        // Note: In production, use a proper PBKDF2 implementation
        let mut block = Vec::new();
        block.extend_from_slice(password);
        block.extend_from_slice(salt);
        
        let mut result = Vec::new();
        for _ in 0..((key_length + 31) / 32) {
            let hash = super::hmac::create(password, &block)
                .map_err(|e| SecurityError::HashingError(e.to_string()))?;
            result.extend(hash);
            
            // Update for next block
            block = hash;
        }
        
        key.copy_from_slice(&result[..key_length]);
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let data = b"Hello, TigerEx!";
        let hash = sha256(data);
        
        assert_eq!(hash.len(), 32);
        assert_eq!(sha256_hex(data), hex::encode(hash));
    }

    #[test]
    fn test_password_hashing() {
        let password = "SecureP@ssw0rd!";
        let hash = password::hash_password(password).unwrap();
        
        assert!(password::verify_password(password, &hash).unwrap());
        assert!(!password::verify_password("wrong", &hash).unwrap());
    }

    #[test]
    fn test_password_strength() {
        assert_eq!(password::check_strength("123"), PasswordStrength::Weak);
        assert_eq!(password::check_strength("password123"), PasswordStrength::Fair);
        assert_eq!(password::check_strength("Password123!"), PasswordStrength::Good);
        assert_eq!(password::check_strength("MyV3ryStr0ng!P@ssw0rd"), PasswordStrength::Strong);
    }

    #[test]
    fn test_hmac() {
        let key = b"secret_key";
        let message = b"message";
        
        let mac = hmac::create(key, message).unwrap();
        assert!(hmac::verify(key, message, &mac));
        assert!(!hmac::verify(key, b"wrong_message", &mac));
    }
}
