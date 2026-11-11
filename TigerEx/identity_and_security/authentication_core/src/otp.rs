//! Email/SMS one-time passwords (OTP).
//!
//! OTPs are generated from a CSPRNG, stored only as a keyed HMAC-SHA256 digest
//! (never in plaintext), compared in constant time, and single-use. Attempts are
//! counted so a code cannot be brute-forced within its validity window.

use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;
use std::collections::HashMap;
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Which channel an OTP was delivered over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtpChannel {
    Email,
    Sms,
}

/// Reason an OTP verification failed.
#[derive(Debug, PartialEq, Eq)]
pub enum OtpError {
    NotFound,
    Expired,
    AlreadyUsed,
    TooManyAttempts,
    Incorrect,
    InvalidFormat,
}

struct OtpRecord {
    /// HMAC-SHA256 of the code, keyed by the server secret.
    digest: [u8; 32],
    expires_at: DateTime<Utc>,
    attempts: u32,
    used: bool,
}

/// Maximum verification attempts before a code is burned.
pub const MAX_OTP_ATTEMPTS: u32 = 5;
/// Digits in a generated code.
pub const OTP_DIGITS: u32 = 6;

/// OTP issuance and verification service.
pub struct OtpService {
    secret: Vec<u8>,
    ttl: Duration,
    records: HashMap<Uuid, OtpRecord>,
}

/// A freshly issued OTP. The plaintext `code` is returned exactly once, to be
/// delivered to the user; it is never stored.
#[derive(Debug)]
pub struct IssuedOtp {
    pub id: Uuid,
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub channel: OtpChannel,
}

impl OtpService {
    /// `secret` must be a high-entropy server-side key (e.g. from the HSM/KMS).
    pub fn new(secret: &[u8], ttl_minutes: i64) -> Self {
        Self {
            secret: secret.to_vec(),
            ttl: Duration::minutes(ttl_minutes),
            records: HashMap::new(),
        }
    }

    fn digest(&self, id: Uuid, code: &str) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(&self.secret)
            .expect("HMAC accepts keys of any length");
        mac.update(id.as_bytes());
        mac.update(b":");
        mac.update(code.as_bytes());
        mac.finalize().into_bytes().into()
    }

    /// Generate and store a new OTP for `id` (e.g. a user id or a pending-login
    /// id). Any previous code for the same id is replaced.
    pub fn issue(&mut self, id: Uuid, channel: OtpChannel) -> IssuedOtp {
        let mut rng = rand::thread_rng();
        let code: String = (0..OTP_DIGITS)
            .map(|_| char::from(b'0' + rng.gen_range(0..10u8)))
            .collect();
        let expires_at = Utc::now() + self.ttl;
        self.records.insert(
            id,
            OtpRecord {
                digest: self.digest(id, &code),
                expires_at,
                attempts: 0,
                used: false,
            },
        );
        IssuedOtp { id, code, expires_at, channel }
    }

    /// Verify a presented code. On success the code is consumed (single use).
    pub fn verify(&mut self, id: Uuid, code: &str) -> Result<(), OtpError> {
        if code.len() != OTP_DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(OtpError::InvalidFormat);
        }
        let expected = self.digest(id, code);
        let record = self.records.get_mut(&id).ok_or(OtpError::NotFound)?;
        if record.used {
            return Err(OtpError::AlreadyUsed);
        }
        if record.expires_at <= Utc::now() {
            return Err(OtpError::Expired);
        }
        if record.attempts >= MAX_OTP_ATTEMPTS {
            return Err(OtpError::TooManyAttempts);
        }
        record.attempts += 1;

        // Constant-time comparison prevents a timing oracle on the digest.
        if expected.ct_eq(&record.digest).into() {
            record.used = true;
            Ok(())
        } else {
            Err(OtpError::Incorrect)
        }
    }

    /// Drop records that have expired or been used.
    pub fn purge(&mut self) {
        let now = Utc::now();
        self.records.retain(|_, r| !r.used && r.expires_at > now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_then_verify_succeeds_once() {
        let mut svc = OtpService::new(b"test-secret-key", 5);
        let id = Uuid::new_v4();
        let otp = svc.issue(id, OtpChannel::Email);
        assert_eq!(otp.code.len(), 6);
        assert!(svc.verify(id, &otp.code).is_ok());
        // Single use: the same code cannot be replayed.
        assert_eq!(svc.verify(id, &otp.code), Err(OtpError::AlreadyUsed));
    }

    #[test]
    fn wrong_code_is_rejected_and_counted() {
        let mut svc = OtpService::new(b"test-secret-key", 5);
        let id = Uuid::new_v4();
        let _ = svc.issue(id, OtpChannel::Sms);
        for _ in 0..MAX_OTP_ATTEMPTS {
            assert_eq!(svc.verify(id, "000000"), Err(OtpError::Incorrect));
        }
        assert_eq!(svc.verify(id, "000000"), Err(OtpError::TooManyAttempts));
    }

    #[test]
    fn malformed_code_rejected_before_lookup() {
        let mut svc = OtpService::new(b"test-secret-key", 5);
        let id = Uuid::new_v4();
        let _ = svc.issue(id, OtpChannel::Email);
        assert_eq!(svc.verify(id, "abc"), Err(OtpError::InvalidFormat));
        assert_eq!(svc.verify(Uuid::new_v4(), "123456"), Err(OtpError::NotFound));
    }

    #[test]
    fn expired_code_rejected() {
        let mut svc = OtpService::new(b"test-secret-key", -1); // already expired
        let id = Uuid::new_v4();
        let otp = svc.issue(id, OtpChannel::Email);
        assert_eq!(svc.verify(id, &otp.code), Err(OtpError::Expired));
    }

    #[test]
    fn reissue_invalidates_previous_code() {
        let mut svc = OtpService::new(b"test-secret-key", 5);
        let id = Uuid::new_v4();
        let first = svc.issue(id, OtpChannel::Email);
        let second = svc.issue(id, OtpChannel::Email);
        assert_eq!(svc.verify(id, &first.code), Err(OtpError::Incorrect));
        assert!(svc.verify(id, &second.code).is_ok());
    }
}
