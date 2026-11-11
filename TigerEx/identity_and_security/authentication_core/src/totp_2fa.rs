//! TOTP (RFC 6238) two-factor authentication.
//!
//! Seeds are generated from a CSPRNG (160-bit, per RFC 4226), stored only as a
//! base32 secret that the caller seals with [`crate::security::SecretBox`], and
//! verified with a small time skew to tolerate clock drift. Backup codes are
//! generated from the CSPRNG and are meant to be hashed at rest by the caller.

use rand::Rng;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Secret, TOTP};

/// Number of digits in a TOTP code.
pub const TOTP_DIGITS: usize = 6;
/// Time step in seconds.
pub const TOTP_PERIOD: u64 = 30;
/// Number of backup codes generated.
pub const BACKUP_CODE_COUNT: usize = 10;
/// Length of each backup code.
pub const BACKUP_CODE_LENGTH: usize = 10;

/// TOTP Config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpConfig {
    pub issuer: String,
    pub account_name: String,
    pub algorithm: String,
    pub digits: usize,
    pub period: u64,
    /// Accepted clock-skew steps in each direction.
    pub skew: u8,
}

impl Default for TotpConfig {
    fn default() -> Self {
        Self {
            issuer: "TigerEx".to_string(),
            account_name: String::new(),
            algorithm: "SHA1".to_string(),
            digits: TOTP_DIGITS,
            period: TOTP_PERIOD,
            skew: 1,
        }
    }
}

/// A newly generated TOTP secret and its provisioning URI.
#[derive(Debug, Clone)]
pub struct TotpEnrollment {
    /// Base32 secret to display once and store (sealed) server-side.
    pub secret_base32: String,
    /// `otpauth://` URI to render as a QR code.
    pub otpauth_url: String,
}

/// Generate a new TOTP secret and provisioning URI for an account.
pub fn generate_totp_secret(
    issuer: &str,
    account_name: &str,
) -> Result<TotpEnrollment, String> {
    if issuer.is_empty() || account_name.is_empty() {
        return Err("issuer and account name are required".to_string());
    }
    if issuer.contains(':') || account_name.contains(':') {
        return Err("issuer and account name must not contain ':'".to_string());
    }
    let secret = Secret::generate_secret();
    let secret_base32 = secret.to_encoded().to_string();
    let totp = TOTP::new(
        Algorithm::SHA1,
        TOTP_DIGITS,
        1,
        TOTP_PERIOD,
        secret.to_bytes().map_err(|e| e.to_string())?,
        Some(issuer.to_string()),
        account_name.to_string(),
    )
    .map_err(|e| e.to_string())?;
    Ok(TotpEnrollment {
        secret_base32,
        otpauth_url: totp.get_url(),
    })
}

/// Verify a TOTP code against a base32 secret, allowing one step of skew.
pub fn verify_totp(secret_base32: &str, code: &str) -> Result<bool, String> {
    if code.len() != TOTP_DIGITS || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(false);
    }
    let secret = Secret::Encoded(secret_base32.to_string());
    let totp = TOTP::new(
        Algorithm::SHA1,
        TOTP_DIGITS,
        1,
        TOTP_PERIOD,
        secret.to_bytes().map_err(|e| e.to_string())?,
        None,
        String::new(),
    )
    .map_err(|e| e.to_string())?;
    // `check_current` returns Result<bool, SystemTimeError>; a clock error is a
    // hard failure, not an accepted code.
    totp.check_current(code).map_err(|e| e.to_string())
}

/// Generate the current code for a secret (used in tests / server-side tooling).
pub fn current_code(secret_base32: &str) -> Result<String, String> {
    let secret = Secret::Encoded(secret_base32.to_string());
    let totp = TOTP::new(
        Algorithm::SHA1,
        TOTP_DIGITS,
        1,
        TOTP_PERIOD,
        secret.to_bytes().map_err(|e| e.to_string())?,
        None,
        String::new(),
    )
    .map_err(|e| e.to_string())?;
    totp.generate_current().map_err(|e| e.to_string())
}

/// Backup codes for 2FA recovery.
pub struct BackupCodes;

impl BackupCodes {
    /// Generate `count` random alphanumeric backup codes.
    pub fn generate(count: usize) -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..count)
            .map(|_| {
                (0..BACKUP_CODE_LENGTH)
                    .map(|_| {
                        let idx = rng.gen_range(0..36u8);
                        if idx < 10 {
                            (b'0' + idx) as char
                        } else {
                            (b'A' + idx - 10) as char
                        }
                    })
                    .collect()
            })
            .collect()
    }

    /// Validate the format of a backup code.
    pub fn validate(code: &str) -> bool {
        code.len() == BACKUP_CODE_LENGTH && code.chars().all(|c| c.is_ascii_alphanumeric())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_produces_usable_secret_and_uri() {
        let e = generate_totp_secret("TigerEx", "user@example.com").unwrap();
        assert!(!e.secret_base32.is_empty());
        assert!(e.otpauth_url.starts_with("otpauth://totp/"));
        let code = current_code(&e.secret_base32).unwrap();
        assert_eq!(code.len(), TOTP_DIGITS);
        assert!(verify_totp(&e.secret_base32, &code).unwrap());
    }

    #[test]
    fn wrong_code_is_rejected() {
        let e = generate_totp_secret("TigerEx", "user@example.com").unwrap();
        let real = current_code(&e.secret_base32).unwrap();
        let wrong = if real == "000000" { "111111" } else { "000000" };
        assert!(!verify_totp(&e.secret_base32, wrong).unwrap());
    }

    #[test]
    fn malformed_code_is_rejected_without_error() {
        let e = generate_totp_secret("TigerEx", "user@example.com").unwrap();
        assert!(!verify_totp(&e.secret_base32, "abc").unwrap());
        assert!(!verify_totp(&e.secret_base32, "12345").unwrap());
    }

    #[test]
    fn rejects_invalid_issuer_or_account() {
        assert!(generate_totp_secret("", "user").is_err());
        assert!(generate_totp_secret("TigerEx", "bad:name").is_err());
    }

    #[test]
    fn backup_codes_are_unique_and_valid_format() {
        let codes = BackupCodes::generate(BACKUP_CODE_COUNT);
        assert_eq!(codes.len(), BACKUP_CODE_COUNT);
        assert!(codes.iter().all(|c| BackupCodes::validate(c)));
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), BACKUP_CODE_COUNT);
    }
}
