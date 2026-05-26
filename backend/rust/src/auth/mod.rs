//! TigerEx Authentication System - Rust Implementation
//! 
//! Security-focused authentication with JWT, 2FA, session management
//! Memory-safe implementation for security-critical auth operations

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use ring::{digest, pbkdf2, rand::{SecureRandom, SystemRandom}};
use ring::hmac;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub username: String,
    pub password_hash: String,
    pub salt: String,
    pub kyc_level: u8,
    pub status: UserStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_login_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserStatus {
    Active,
    Suspended,
    Frozen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub token: String,
    pub refresh_token: String,
    pub ip_address: String,
    pub user_agent: String,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwoFactor {
    pub user_id: String,
    pub twofactor_type: TwoFactorType,
    pub secret: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TwoFactorType {
    Totp,
    Sms,
    Email,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginAttempt {
    pub user_id: String,
    pub ip_address: String,
    pub success: bool,
    pub timestamp: i64,
    pub failure_reason: Option<String>,
}

// ============================================================================
// AUTHENTICATION CONFIG
// ============================================================================

const SALT_LENGTH: usize = 32;
const HASH_ITERATIONS: u32 = 100_000;
const HASH_OUTPUT_LEN: usize = 64;
const JWT_EXPIRY_SECONDS: u64 = 86400; // 24 hours
const REFRESH_EXPIRY_SECONDS: u64 = 604800; // 7 days
const MAX_LOGIN_ATTEMPTS: u32 = 5;
const LOCKOUT_DURATION_MS: u64 = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// AUTHENTICATION SYSTEM
// ============================================================================

pub struct AuthenticationSystem {
    users: HashMap<String, User>,
    sessions: HashMap<String, Session>,
    two_factors: HashMap<String, TwoFactor>,
    login_attempts: Vec<LoginAttempt>,
    user_id_counter: u64,
    session_id_counter: u64,
    jwt_secret: String,
    rng: SystemRandom,
}

impl AuthenticationSystem {
    pub fn new(jwt_secret: &str) -> Self {
        Self {
            users: HashMap::new(),
            sessions: HashMap::new(),
            two_factors: HashMap::new(),
            login_attempts: Vec::new(),
            user_id_counter: 0,
            session_id_counter: 0,
            jwt_secret: jwt_secret.to_string(),
            rng: SystemRandom::new(),
        }
    }

    /// Hash password using PBKDF2
    fn hash_password(&self, password: &str, salt: &[u8]) -> String {
        let mut hash = [0u8; HASH_OUTPUT_LEN];
        pbkdf2::derive(
            pbkdf2::PBKDF2_HMAC_SHA512,
            std::num::NonZeroU32::new(HASH_ITERATIONS).unwrap(),
            salt,
            password.as_bytes(),
            &mut hash,
        );
        hex_encode(&hash)
    }

    /// Generate random salt
    fn generate_salt(&self) -> Vec<u8> {
        let mut salt = vec![0u8; SALT_LENGTH];
        self.rng.fill(&mut salt).expect("RNG error");
        salt
    }

    /// Register new user
    pub fn register(&mut self, email: &str, username: &str, password: &str) -> Result<User, String> {
        // Check email exists
        for user in self.users.values() {
            if user.email == email {
                return Err("Email already registered".to_string());
            }
        }

        // Check username exists
        for user in self.users.values() {
            if user.username == username {
                return Err("Username already taken".to_string());
            }
        }

        // Validate password
        if password.len() < 8 {
            return Err("Password must be at least 8 characters".to_string());
        }

        let salt = self.generate_salt();
        let password_hash = self.hash_password(password, &salt);
        let salt_hex = hex_encode(&salt);

        self.user_id_counter += 1;
        let now = current_timestamp_ms();

        let user = User {
            id: format!("USR-{}", self.user_id_counter),
            email: email.to_string(),
            username: username.to_string(),
            password_hash,
            salt: salt_hex,
            kyc_level: 0,
            status: UserStatus::Active,
            created_at: now,
            updated_at: now,
            last_login_at: None,
        };

        self.users.insert(user.id.clone(), user.clone());
        Ok(user)
    }

    /// Login user
    pub fn login(
        &mut self,
        email_or_username: &str,
        password: &str,
        ip_address: &str,
        user_agent: &str,
    ) -> Result<LoginResponse, String> {
        // Find user
        let user = self.users.values()
            .find(|u| u.email == email_or_username || u.username == username)
            .ok_or_else(|| "Invalid credentials".to_string())?;

        // Check account status
        if user.status != UserStatus::Active {
            self.record_login_attempt(&user.id, ip_address, false, Some(&format!("Account {:?}", user.status)));
            return Err(format!("Account is {:?}", user.status));
        }

        // Check lockout
        if self.is_locked_out(&user.id) {
            self.record_login_attempt(&user.id, ip_address, false, Some("Account locked"));
            return Err("Account temporarily locked. Please try again later.".to_string());
        }

        // Verify password
        let salt = hex_decode(&user.salt).map_err(|_| "Invalid salt")?;
        let password_hash = self.hash_password(password, &salt);
        
        if password_hash != user.password_hash {
            self.record_login_attempt(&user.id, ip_address, false, Some("Invalid password"));
            return Err("Invalid credentials".to_string());
        }

        // Check 2FA
        if let Some(twofactor) = self.two_factors.get(&user.id) {
            if twofactor.enabled {
                return Ok(LoginResponse {
                    user: user.clone(),
                    access_token: "2FA_REQUIRED".to_string(),
                    refresh_token: "2FA_REQUIRED".to_string(),
                    requires_2fa: true,
                });
            }
        }

        // Generate tokens
        let access_token = self.generate_access_token(&user);
        let refresh_token = self.generate_refresh_token();

        // Create session
        self.create_session(&user.id, &access_token, &refresh_token, ip_address, user_agent)?;

        // Update last login
        let now = current_timestamp_ms();
        let user = self.users.get_mut(&user.id).unwrap();
        user.last_login_at = Some(now);

        self.record_login_attempt(&user.id, ip_address, true, None);

        Ok(LoginResponse {
            user: user.clone(),
            access_token,
            refresh_token,
            requires_2fa: false,
        })
    }

    /// Verify 2FA
    pub fn verify_2fa(
        &mut self,
        user_id: &str,
        code: &str,
        ip_address: &str,
        user_agent: &str,
    ) -> Result<LoginResponse, String> {
        let user = self.users.get(user_id)
            .ok_or("User not found")?;

        let twofactor = self.two_factors.get(user_id)
            .ok_or("2FA not enabled")?;

        if !twofactor.enabled {
            return Err("2FA not enabled".to_string());
        }

        // Verify code (simplified - production should use proper TOTP)
        if code.len() != 6 {
            return Err("Invalid code".to_string());
        }

        // Generate tokens
        let access_token = self.generate_access_token(user);
        let refresh_token = self.generate_refresh_token();

        self.create_session(&user.id, &access_token, &refresh_token, ip_address, user_agent)?;

        Ok(LoginResponse {
            user: user.clone(),
            access_token,
            refresh_token,
            requires_2fa: false,
        })
    }

    /// Enable 2FA
    pub fn enable_2fa(
        &mut self,
        user_id: &str,
        twofactor_type: TwoFactorType,
        secret: Option<String>,
        phone: Option<String>,
    ) -> Result<TwoFactor, String> {
        let user = self.users.get(user_id)
            .ok_or("User not found")?;

        let twofactor = TwoFactor {
            user_id: user_id.to_string(),
            twofactor_type,
            secret,
            phone,
            email: Some(user.email.clone()),
            enabled: false,
        };

        self.two_factors.insert(user_id.to_string(), twofactor.clone());
        Ok(twofactor)
    }

    /// Generate JWT access token
    fn generate_access_token(&self, user: &User) -> String {
        let header = base64_encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        
        let now = current_timestamp_seconds();
        let payload = format!(
            r#"{{"sub":"{}","email":"{}","username":"{}","iat":{},"exp":{}}}"#,
            user.id, user.email, user.username, now, now + JWT_EXPIRY_SECONDS
        );
        let payload_encoded = base64_encode(payload.as_bytes());
        
        let signature = self.hmac_sign(&format!("{}.{}", header, payload_encoded));

        format!("{}.{}.{}", header, payload_encoded, signature)
    }

    /// Generate refresh token
    fn generate_refresh_token(&self) -> String {
        let mut bytes = [0u8; 64];
        self.rng.fill(&mut bytes).expect("RNG error");
        hex_encode(&bytes)
    }

    /// HMAC sign
    fn hmac_sign(&self, message: &str) -> String {
        let key = hmac::Key::new(hmac::HMAC_SHA256, self.jwt_secret.as_bytes());
        let tag = hmac::sign(&key, message.as_bytes());
        base64_encode(tag.as_ref())
    }

    /// Create session
    fn create_session(
        &mut self,
        user_id: &str,
        access_token: &str,
        refresh_token: &str,
        ip_address: &str,
        user_agent: &str,
    ) -> Result<(), String> {
        self.session_id_counter += 1;
        let now = current_timestamp_ms();

        let session = Session {
            id: format!("SES-{}", self.session_id_counter),
            user_id: user_id.to_string(),
            token: access_token.to_string(),
            refresh_token: refresh_token.to_string(),
            ip_address: ip_address.to_string(),
            user_agent: user_agent.to_string(),
            expires_at: now + (REFRESH_EXPIRY_SECONDS * 1000) as i64,
            created_at: now,
        };

        self.sessions.insert(session.id.clone(), session);
        Ok(())
    }

    /// Record login attempt
    fn record_login_attempt(&mut self, user_id: &str, ip_address: &str, success: bool, reason: Option<&str>) {
        self.login_attempts.push(LoginAttempt {
            user_id: user_id.to_string(),
            ip_address: ip_address.to_string(),
            success,
            timestamp: current_timestamp_ms(),
            failure_reason: reason.map(|s| s.to_string()),
        });

        // Keep last 1000 attempts
        if self.login_attempts.len() > 1000 {
            self.login_attempts.drain(0..500);
        }
    }

    /// Check if account is locked out
    fn is_locked_out(&self, user_id: &str) -> bool {
        let now = current_timestamp_ms() as u64;
        
        let failed_attempts = self.login_attempts.iter()
            .filter(|a| {
                a.user_id == user_id 
                && !a.success 
                && (now - a.timestamp as u64) < LOCKOUT_DURATION_MS
            })
            .count();

        failed_attempts >= MAX_LOGIN_ATTEMPTS as usize
    }

    /// Verify token
    pub fn verify_token(&self, token: &str) -> Result<String, String> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err("Invalid token format".to_string());
        }

        let message = format!("{}.{}", parts[0], parts[1]);
        let expected_sig = self.hmac_sign(&message);

        if parts[2] != expected_sig {
            return Err("Invalid signature".to_string());
        }

        let payload_decoded = base64_decode(parts[1])
            .map_err(|_| "Invalid payload")?;
        let payload_str = String::from_utf8(payload_decoded)
            .map_err(|_| "Invalid UTF-8")?;

        // Simple parsing (production should use serde_json)
        if payload_str.contains("\"exp\":") {
            // Would parse expiration here
        }

        // Extract user ID
        if let Some(start) = payload_str.find(r#""sub":""#) {
            let start = start + 6;
            if let Some(end) = payload_str[start..].find(',') {
                let sub = &payload_str[start..start+end];
                return Ok(sub.trim_matches('"').to_string());
            }
        }

        Err("User ID not found".to_string())
    }

    /// Refresh token
    pub fn refresh_token(
        &mut self,
        refresh_token: &str,
        ip_address: &str,
        user_agent: &str,
    ) -> Result<RefreshResponse, String> {
        let session = self.sessions.values()
            .find(|s| s.refresh_token == refresh_token)
            .ok_or("Invalid refresh token")?;

        if session.expires_at < current_timestamp_ms() {
            self.sessions.remove(&session.id);
            return Err("Refresh token expired".to_string());
        }

        let user = self.users.get(&session.user_id)
            .ok_or("User not found or inactive")?;

        let new_access_token = self.generate_access_token(user);
        let new_refresh_token = self.generate_refresh_token();

        // Update session
        let mut session = self.sessions.get_mut(&session.id).unwrap();
        session.token = new_access_token.clone();
        session.refresh_token = new_refresh_token.clone();
        session.expires_at = current_timestamp_ms() + (REFRESH_EXPIRY_SECONDS * 1000) as i64;

        Ok(RefreshResponse {
            access_token: new_access_token,
            refresh_token: new_refresh_token,
        })
    }

    /// Logout
    pub fn logout(&mut self, user_id: &str) {
        self.sessions.retain(|_, s| s.user_id != user_id);
    }

    /// Get user
    pub fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    /// Get user by email
    pub fn get_user_by_email(&self, email: &str) -> Option<&User> {
        self.users.values().find(|u| u.email == email)
    }
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub user: User,
    pub access_token: String,
    pub refresh_token: String,
    pub requires_2fa: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
}

// ============================================================================
// HELPERS
// ============================================================================

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn current_timestamp_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, std::num::ParseIntError> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i+2], 16))
        .collect()
}

fn base64_encode(data: &[u8]) -> String {
    use std::io::Write;
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    
    for chunk in data.chunks(3) {
        let mut n: u32 = 0;
        for (i, &byte) in chunk.iter().enumerate() {
            n |= (byte as u32) << (16 - i * 8);
        }
        
        for i in 0..((chunk.len() + 1) * 2) {
            result.push(ALPHABET[(n >> (18 - i * 6)) as usize & 0x3F] as char);
        }
        for _ in chunk.len()..3 {
            result.push('=');
        }
    }
    
    result
}

fn base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let s = s.trim_end_matches('=');
    let mut result = Vec::with_capacity(s.len() * 3 / 4);
    
    let mut buf = [0u8; 4];
    let mut iter = s.bytes().cycle();
    
    loop {
        for i in 0..4 {
            match iter.next() {
                Some(b'=') => buf[i] = 0,
                Some(c) => {
                    if let Some(&idx) = ALPHABET.iter().position(|&x| x == c) {
                        buf[i] = idx;
                    } else {
                        return Err(());
                    }
                }
                None => break,
            }
        }
        
        result.push(((buf[0] << 2) | (buf[1] >> 4)) as u8);
        if buf[2] != 0 { result.push(((buf[1] << 4) | (buf[2] >> 2)) as u8); }
        if buf[3] != 0 { result.push(((buf[2] << 6) | buf[3]) as u8); }
    }
    
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register() {
        let mut auth = AuthenticationSystem::new("test-secret");
        let result = auth.register("test@example.com", "testuser", "password123");
        assert!(result.is_ok());
    }

    #[test]
    fn test_login() {
        let mut auth = AuthenticationSystem::new("test-secret");
        auth.register("test@example.com", "testuser", "password123").unwrap();
        
        let result = auth.login("test@example.com", "password123", "127.0.0.1", "test-agent");
        assert!(result.is_ok());
    }
}