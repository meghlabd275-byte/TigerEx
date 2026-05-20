//! TOTP/HOTP 2FA Implementation
use totp_rs::{TOTP, Generated, Algorithm, Secret};
use serde::{Deserialize, Serialize};
use rand::Rng;

/// TOTP Config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpConfig {
    pub issuer: String,
    pub account_name: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u64,
}

impl Default for TotpConfig {
    fn default() -> Self {
        Self {
            issuer: "TigerEx".to_string(),
            account_name: "".to_string(),
            algorithm: "SHA1".to_string(),
            digits: 6,
            period: 30,
        }
    }
}

/// Generate new TOTP secret
pub fn generate_totp_secret() -> Result<(String, String), String> {
    let secret = Secret::generate_secret(20, None)
        .map_err(|e| e.to_string())?;
    
    // Generate QR code URL for authenticator apps
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        &secret.to_bytes().map_err(|e| e.to_string())?,
    ).map_err(|e| e.to_string())?;
    
    let otpauth = totp.get_otpauth_url(&"TigerEx".to_string(), &"user@email.com".to_string());
    
    Ok((secret.to_encoded().map_err(|e| e.to_string())?, otpauth))
}

/// Verify TOTP code
pub fn verify_totp(secret: &str, code: &str) -> Result<bool, String> {
    let secret_bytes = Secret::Encoded::decode_encoded(secret)
        .map_err(|e| e.to_string())?
        .to_bytes()
        .map_err(|e| e.to_string())?;
    
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        &secret_bytes,
    ).map_err(|e| e.to_string())?;
    
    Ok(totp.check_current(code, 1)) // Allow ±1 window
}

/// Backup codes for 2FA recovery
pub struct BackupCodes;

impl BackupCodes {
    /// Generate backup codes
    pub fn generate(count: usize) -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..count)
            .map(|_| {
                let code: String = (0..8)
                    .map(|_| {
                        let idx = rng.gen_range(0..36);
                        if idx < 10 { (b'0' + idx) as char }
                        else { (b'A' + idx - 10) as char }
                    })
                    .collect();
                code
            })
            .collect()
    }
    
    /// Validate format
    pub fn validate(code: &str) -> bool {
        code.len() == 8 && code.chars().all(|c| c.is_ascii_alphanumeric())
    }
}