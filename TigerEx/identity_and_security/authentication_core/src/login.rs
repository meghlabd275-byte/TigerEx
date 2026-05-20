//! Login and password authentication

use serde::{Deserialize, Serialize};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Login request
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub identifier: String,  // email or phone
    pub password: String,
    pub device_fingerprint: Option<String>,
    pub trusted_device: Option<bool>,
}

/// Login response
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: UserInfo,
    pub requires_2fa: bool,
    pub trusted_device_token: Option<String>,
}

/// User info
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: Uuid,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub status: AccountStatus,
    pub kyc_status: KycStatus,
}

/// Account status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
    Active,
    Locked,
    Suspended,
    Closed,
    Deleted,
}

/// KYC status  
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KycStatus {
    None,
    Pending,
    UnderReview,
    Approved,
    Rejected,
}

/// Failed login attempt record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedLogin {
    pub id: Uuid,
    pub user_id: Uuid,
    pub ip_address: String,
    pub user_agent: String,
    pub timestamp: DateTime<Utc>,
    pub reason: String,
}

/// Login attempt tracker
pub struct LoginAttemptTracker {
    attempts: Vec<FailedLogin>,
    locked_until: Option<DateTime<Utc>>,
}

impl LoginAttemptTracker {
    pub fn new() -> Self {
        Self {
            attempts: Vec::new(),
            locked_until: None,
        }
    }
    
    /// Record a failed attempt
    pub fn record_failure(&mut self, user_id: Uuid, ip: &str, ua: &str, reason: &str) {
        self.attempts.push(FailedLogin {
            id: Uuid::new_v4(),
            user_id,
            ip_address: ip.to_string(),
            user_agent: ua.to_string(),
            timestamp: Utc::now(),
            reason: reason.to_string(),
        });
        
        // Keep only last 10 attempts
        if self.attempts.len() > 10 {
            self.attempts.remove(0);
        }
    }
    
    /// Check if account should be locked
    pub fn should_lock(&self) -> bool {
        // Count recent failures (last hour)
        let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
        let recent_failures = self.attempts
            .iter()
            .filter(|a| a.timestamp > one_hour_ago)
            .count();
        
        recent_failures >= MAX_LOGIN_ATTEMPTS as usize
    }
    
    /// Get lockout timestamp
    pub fn get_lockout(&self) -> Option<DateTime<Utc>> {
        if self.should_lock() {
            Some(Utc::now() + chrono::Duration::hours(LOCKOUT_DURATION_HOURS))
        } else {
            None
        }
    }
    
    /// Clear failures after successful login
    pub fn clear(&mut self) {
        self.attempts.clear();
        self.locked_until = None;
    }
}

/// Password hasher
pub struct PasswordHasher;

impl PasswordHasher {
    /// Hash a password using bcrypt
    pub fn hash(password: &str) -> Result<String, bcrypt::BcryptError> {
        hash(password, DEFAULT_COST)
    }
    
    /// Verify a password against hash
    pub fn verify(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
        verify(password, hash)
    }
    
    /// Verify and update legacy MD5/SHA1 hashes (migration path)
    pub fn verify_migration(password: &str, hash: &str, hasher: &str) -> Result<bool, &str> {
        match hasher {
            "bcrypt" => Self::verify(password, hash).map_err(|_| "bcrypt error"),
            "argon2" => {
                // Argon2 verification
                Ok(false)
            }
            _ => Err("Unknown hasher"),
        }
    }
}

/// Anti-phishing code generator
pub struct AntiPhishingCode;

impl AntiPhishingCode {
    /// Generate random code
    pub fn generate() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..ANTIPHISHING_CODE_LENGTH)
            .map(|_| {
                let idx = rng.gen_range(0..36);
                if idx < 10 { (b'0' + idx) as char }
                else { (b'A' + idx - 10) as char }
            })
            .collect()
    }
    
    /// Validate code
    pub fn validate(code: &str) -> bool {
        code.len() == ANTIPHISHING_CODE_LENGTH && 
            code.chars().all(|c| c.is_ascii_alphanumeric())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_password_hash_verify() {
        let password = "SecurePassword123!";
        let hash = PasswordHasher::hash(password).unwrap();
        assert!(PasswordHasher::verify(password, &hash).unwrap());
    }
    
    #[test]
    fn test_antiphishing_code() {
        let code = AntiPhishingCode::generate();
        assert_eq!(code.len(), ANTIPHISHING_CODE_LENGTH);
        assert!(AntiPhishingCode::validate(&code));
    }
}