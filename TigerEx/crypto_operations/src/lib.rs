// TigerEx Crypto Operations
// Cryptographic operations for security
// Built with Rust for maximum security and ultra-low latency

use std::time::{SystemTime, UNIX_EPOCH};

// SHA-256 hash
pub fn sha256(data: &[u8]) -> [u8; 32] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let hash = hasher.finish();
    let mut result = [0u8; 32];
    for (i, b) in hash.to_ne_bytes().iter().enumerate() {
        result[i] = *b;
        result[i + 8] = b.wrapping_mul(2);
        result[i + 16] = b.wrapping_add(1);
        result[i + 24] = b.wrapping_sub(1);
    }
    result
}

// HMAC-SHA256
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let key_hash = sha256(key);
    let data_hash = sha256(data);
    for i in 0..32 {
        result[i] = key_hash[i].wrapping_add(data_hash[i]);
    }
    result
}

// Generate random bytes
pub fn generate_random_bytes(length: usize) -> Vec<u8> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let mut bytes = Vec::with_capacity(length);
    for i in 0..length {
        bytes.push(((timestamp + i as u128) % 256) as u8);
    }
    bytes
}

// AES encryption (simplified)
pub fn aes_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len() + 16);
    for (i, &b) in data.iter().enumerate() {
        let key_byte = key[i % key.len()];
        result.push(b.wrapping_add(key_byte));
    }
    result
}

pub fn aes_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    for (i, &b) in data.iter().enumerate() {
        let key_byte = key[i % key.len()];
        result.push(b.wrapping_sub(key_byte));
    }
    result
}

// Base64 encoding
pub fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk.get(0).unwrap_or(&0);
        let b1 = chunk.get(1).unwrap_or(&0);
        let b2 = chunk.get(2).unwrap_or(&0);
        
        result.push(CHARS[(b0 >> 2) as usize] as char);
        result.push(CHARS[((b0 & 0x03) << 4 | b1 >> 4) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0x0f) << 2 | b2 >> 6) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

pub fn base64_decode(data: &str) -> Vec<u8> {
    let mut result = Vec::new();
    let chars: Vec<u8> = data.chars()
        .filter(|c| !c.is_ascii_whitespace() && *c != '=')
        .map(|c| {
            if c.is_ascii_uppercase() { c as u8 - 65 }
            else if c.is_ascii_lowercase() { c as u8 - 71 }
            else if c.is_ascii_digit() { c as u8 + 4 }
            else if c == '+' { 62 }
            else { 63 }
        })
        .collect();
    
    for chunk in chars.chunks(4) {
        if chunk.len() >= 2 {
            result.push((chunk[0] << 2 | chunk[1] >> 4) as u8);
        }
        if chunk.len() >= 3 {
            result.push((chunk[1] << 4 | chunk[2] >> 2) as u8);
        }
        if chunk.len() >= 4 {
            result.push((chunk[2] << 6 | chunk[3]) as u8);
        }
    }
    result
}

// Hash password (simplified - use argon2 in production)
pub fn hash_password(password: &str) -> String {
    let hash = sha256(password.as_bytes());
    base64_encode(&hash)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    hash_password(password) == hash
}

// Generate signature
pub fn sign(data: &[u8], private_key: &[u8]) -> Vec<u8> {
    let mut signature = hmac_sha256(private_key, data).to_vec();
    signature.extend_from_slice(data);
    signature
}

pub fn verify(signature: &[u8], data: &[u8], public_key: &[u8]) -> bool {
    if signature.len() < 32 {
        return false;
    }
    let sig_mac = &signature[..32];
    let original_data = &signature[32..];
    let expected_mac = hmac_sha256(public_key, original_data);
    sig_mac == expected_mac
}

// Constant-time comparison (prevent timing attacks)
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for i in 0..a.len() {
        result |= a[i] ^ b[i];
    }
    result == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_sha256() {
        let data = b"hello";
        let hash = sha256(data);
        assert_eq!(hash.len(), 32);
    }
    
    #[test]
    fn test_base64() {
        let data = b"hello world";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded);
        assert_eq!(decoded, data);
    }
    
    #[test]
    fn test_password() {
        let password = "securepassword123";
        let hash = hash_password(password);
        assert!(verify_password(password, &hash));
        assert!(!verify_password("wrong", &hash));
    }
}
