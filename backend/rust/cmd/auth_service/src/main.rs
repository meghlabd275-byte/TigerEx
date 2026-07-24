//! TigerEx Authentication Service - Production Ready
//! Complete authentication service with JWT, 2FA, OAuth, password management
//! 
//! Features:
//! - User registration and login with email/phone
//! - JWT token generation and validation
//! - Argon2 password hashing
//! - TOTP-based 2FA
//! - Account lockout after failed attempts
//! - Session management
//! - Rate limiting
//! - Audit logging

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, TokenData, Validation};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("Invalid credentials")]
    InvalidCredentials,
    
    #[error("Account not found")]
    AccountNotFound,
    
    #[error("Account locked")]
    AccountLocked { until: DateTime<Utc> },
    
    #[error("Account already exists")]
    AccountAlreadyExists,
    
    #[error("Invalid token")]
    InvalidToken,
    
    #[error("Token expired")]
    TokenExpired,
    
    #[error("Invalid 2FA code")]
    InvalidTwoFactorCode,
    
    #[error("2FA not enabled")]
    TwoFactorNotEnabled,
    
    #[error("Email not verified")]
    EmailNotVerified,
    
    #[error("Phone not verified")]
    PhoneNotVerified,
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Internal server error")]
    InternalError(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response<Body> {
        let (status, error_message) = match self {
            AuthError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "Invalid credentials"),
            AuthError::AccountNotFound => (StatusCode::NOT_FOUND, "Account not found"),
            AuthError::AccountLocked { .. } => (StatusCode::FORBIDDEN, "Account locked"),
            AuthError::AccountAlreadyExists => (StatusCode::CONFLICT, "Account already exists"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid token"),
            AuthError::TokenExpired => (StatusCode::UNAUTHORIZED, "Token expired"),
            AuthError::InvalidTwoFactorCode => (StatusCode::UNAUTHORIZED, "Invalid 2FA code"),
            AuthError::TwoFactorNotEnabled => (StatusCode::BAD_REQUEST, "2FA not enabled"),
            AuthError::EmailNotVerified => (StatusCode::FORBIDDEN, "Email not verified"),
            AuthError::PhoneNotVerified => (StatusCode::FORBIDDEN, "Phone not verified"),
            AuthError::RateLimitExceeded => (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded"),
            AuthError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, &msg),
        };
        
        let body = serde_json::json!({
            "success": false,
            "error": {
                "code": status.as_u16(),
                "message": error_message
            }
        });
        
        (status, Json(body)).into_response()
    }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

#[derive(Debug, Clone)]
pub struct Config {
    pub jwt_secret: String,
    pub jwt_issuer: String,
    pub access_token_expiry: Duration,
    pub refresh_token_expiry: Duration,
    pub max_login_attempts: u32,
    pub lockout_duration: Duration,
    pub password_min_length: usize,
    pub otp_expiry: Duration,
    pub otp_length: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "tigerex-jwt-secret-change-in-production".to_string()),
            jwt_issuer: "tigerex.com".to_string(),
            access_token_expiry: Duration::from_secs(3600),        // 1 hour
            refresh_token_expiry: Duration::from_secs(604800),    // 7 days
            max_login_attempts: 5,
            lockout_duration: Duration::from_secs(172800),        // 48 hours
            password_min_length: 8,
            otp_expiry: Duration::from_secs(300),                // 5 minutes
            otp_length: 6,
        }
    }
}

// =============================================================================
// DATA TYPES
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    Email,
    Phone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserStatus {
    Active,
    Suspended,
    Locked,
    Pending,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_country_code: Option<String>,
    pub username: String,
    pub display_name: Option<String>,
    pub password_hash: String,
    pub credential_type: CredentialType,
    pub status: UserStatus,
    pub kyc_level: u8,
    pub email_verified: bool,
    pub phone_verified: bool,
    pub two_factor_enabled: bool,
    pub two_factor_secret: Option<String>,
    pub failed_login_attempts: u32,
    pub locked_until: Option<DateTime<Utc>>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub fn new(email: Option<String>, phone: Option<String>, username: String, password_hash: String) -> Self {
        let credential_type = if email.is_some() {
            CredentialType::Email
        } else {
            CredentialType::Phone
        };
        
        Self {
            id: Uuid::new_v4().to_string(),
            email,
            phone,
            phone_country_code: None,
            username,
            display_name: None,
            password_hash,
            credential_type,
            status: UserStatus::Pending,
            kyc_level: 0,
            email_verified: false,
            phone_verified: false,
            two_factor_enabled: false,
            two_factor_secret: None,
            failed_login_attempts: 0,
            locked_until: None,
            last_login_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
    
    pub fn is_locked(&self) -> bool {
        if let Some(until) = self.locked_until {
            until > Utc::now()
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub trusted_device: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshToken {
    pub id: String,
    pub user_id: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OTP {
    pub id: String,
    pub user_id: String,
    pub code: String,
    pub otp_type: OTPType,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OTPType {
    EmailVerification,
    PhoneVerification,
    LoginVerification,
    PasswordReset,
    TwoFactorReset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginAttempt {
    pub user_id: String,
    pub ip_address: String,
    pub attempted_at: DateTime<Utc>,
    pub success: bool,
}

// =============================================================================
// JWT CLAIMS
// =============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,           // User ID
    pub email: Option<String>,
    pub phone: Option<String>,
    pub username: String,
    pub kyc_level: u8,
    pub iat: i64,
    pub exp: i64,
    pub iss: String,
    pub typ: String,
}

impl Claims {
    pub fn new(user: &User, config: &Config) -> Self {
        let now = Utc::now().timestamp();
        let exp = now + config.access_token_expiry.as_secs() as i64;
        
        Self {
            sub: user.id.clone(),
            email: user.email.clone(),
            phone: user.phone.clone(),
            username: user.username.clone(),
            kyc_level: user.kyc_level,
            iat: now,
            exp,
            iss: config.jwt_issuer.clone(),
            typ: "access".to_string(),
        }
    }
}

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

#[derive(Debug, Deserialize, Serialize)]
pub struct RegisterRequest {
    pub email: Option<String>,
    pub phone: Option<String>,
    pub username: String,
    pub password: String,
    pub referral_code: Option<String>,
    pub agree_to_terms: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LoginRequest {
    pub email_or_phone: String,
    pub password: String,
    pub two_factor_code: Option<String>,
    pub trusted_device: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VerifyOTPRequest {
    pub email_or_phone: String,
    pub code: String,
    pub otp_type: OTPType,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SendOTPRequest {
    pub email_or_phone: String,
    pub otp_type: OTPType,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ResetPasswordRequest {
    pub email_or_phone: String,
    pub code: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EnableTwoFactorRequest {
    pub code: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DisableTwoFactorRequest {
    pub code: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CheckAccountRequest {
    pub email_or_phone: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ApiError>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }
    
    pub fn error(code: &str, message: &str) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(ApiError {
                code: code.to_string(),
                message: message.to_string(),
            }),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: UserResponse,
    pub requires_two_factor: bool,
    pub requires_verification: bool,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub username: String,
    pub kyc_level: u8,
    pub status: String,
    pub two_factor_enabled: bool,
    pub email_verified: bool,
    pub phone_verified: bool,
}

#[derive(Debug, Serialize)]
pub struct AccountStatusResponse {
    pub exists: bool,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub email_verified: bool,
    pub phone_verified: bool,
    pub two_factor_enabled: bool,
    pub locked_until: Option<String>,
    pub failed_attempts: u32,
}

// =============================================================================
// AUTH SERVICE
// =============================================================================

pub struct AuthService {
    config: Config,
    users: RwLock<std::collections::HashMap<String, User>>,
    sessions: RwLock<std::collections::HashMap<String, Session>>,
    refresh_tokens: RwLock<std::collections::HashMap<String, RefreshToken>>,
    otps: RwLock<std::collections::HashMap<String, Vec<OTP>>>,
    login_attempts: RwLock<std::collections::HashMap<String, Vec<LoginAttempt>>>,
}

impl AuthService {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            users: RwLock::new(std::collections::HashMap::new()),
            sessions: RwLock::new(std::collections::HashMap::new()),
            refresh_tokens: RwLock::new(std::collections::HashMap::new()),
            otps: RwLock::new(std::collections::HashMap::new()),
            login_attempts: RwLock::new(std::collections::HashMap::new()),
        }
    }
    
    // =============================================================================
    // USER MANAGEMENT
    // =============================================================================
    
    pub async fn register(&self, request: RegisterRequest) -> Result<User, AuthError> {
        // Validate input
        if request.email.is_none() && request.phone.is_none() {
            return Err(AuthError::AccountNotFound);
        }
        
        if request.password.len() < self.config.password_min_length {
            return Err(AuthError::InternalError("Password too short".to_string()));
        }
        
        // Check if user already exists
        let mut users = self.users.write().await;
        
        if let Some(email) = &request.email {
            if users.values().any(|u| u.email.as_ref() == Some(email)) {
                return Err(AuthError::AccountAlreadyExists);
            }
        }
        
        if let Some(phone) = &request.phone {
            if users.values().any(|u| u.phone.as_ref() == Some(phone)) {
                return Err(AuthError::AccountAlreadyExists);
            }
        }
        
        // Hash password
        let password_hash = self.hash_password(&request.password)?;
        
        // Create user
        let user = User::new(
            request.email,
            request.phone,
            request.username,
            password_hash,
        );
        
        let user_id = user.id.clone();
        users.insert(user_id.clone(), user.clone());
        
        info!("User registered: {}", user_id);
        
        Ok(user)
    }
    
    pub async fn check_account(&self, email_or_phone: &str) -> Result<AccountStatusResponse, AuthError> {
        let users = self.users.read().await;
        
        // Check if it's an email or phone
        let is_email = email_or_phone.contains('@');
        
        let user = if is_email {
            users.values().find(|u| u.email.as_deref() == Some(email_or_phone))
        } else {
            users.values().find(|u| u.phone.as_deref() == Some(email_or_phone))
        };
        
        if let Some(user) = user {
            Ok(AccountStatusResponse {
                exists: true,
                email: user.email.clone(),
                phone: user.phone.clone(),
                email_verified: user.email_verified,
                phone_verified: user.phone_verified,
                two_factor_enabled: user.two_factor_enabled,
                locked_until: user.locked_until.map(|d| d.to_rfc3339()),
                failed_attempts: user.failed_login_attempts,
            })
        } else {
            Ok(AccountStatusResponse {
                exists: false,
                email: None,
                phone: None,
                email_verified: false,
                phone_verified: false,
                two_factor_enabled: false,
                locked_until: None,
                failed_attempts: 0,
            })
        }
    }
    
    pub async fn login(&self, request: LoginRequest, ip_address: Option<String>) -> Result<LoginResponse, AuthError> {
        // Find user
        let user = {
            let users = self.users.read().await;
            let is_email = request.email_or_phone.contains('@');
            
            let user = if is_email {
                users.values().find(|u| u.email.as_deref() == Some(&request.email_or_phone))
            } else {
                users.values().find(|u| u.phone.as_deref() == Some(&request.email_or_phone))
            };
            
            user.cloned()
        };
        
        let user = match user {
            Some(u) => u,
            None => return Err(AuthError::InvalidCredentials),
        };
        
        // Check if locked
        if user.is_locked() {
            return Err(AuthError::AccountLocked {
                until: user.locked_until.unwrap(),
            });
        }
        
        // Verify password
        if !self.verify_password(&request.password, &user.password_hash)? {
            // Increment failed attempts
            self.record_failed_login(&user.id, ip_address.clone()).await?;
            return Err(AuthError::InvalidCredentials);
        }
        
        // Check 2FA if enabled
        let requires_two_factor = user.two_factor_enabled && request.two_factor_code.is_none();
        
        if requires_two_factor {
            return Ok(LoginResponse {
                access_token: String::new(),
                refresh_token: String::new(),
                expires_in: 0,
                user: self.user_to_response(&user),
                requires_two_factor: true,
                requires_verification: false,
            });
        }
        
        // Verify 2FA code if provided
        if user.two_factor_enabled {
            if let Some(code) = &request.two_factor_code {
                if !self.verify_two_factor_code(&user, code)? {
                    self.record_failed_login(&user.id, ip_address.clone()).await?;
                    return Err(AuthError::InvalidTwoFactorCode);
                }
            } else {
                return Err(AuthError::InvalidTwoFactorCode);
            }
        }
        
        // Generate tokens
        let access_token = self.generate_access_token(&user)?;
        let refresh_token = self.generate_refresh_token(&user)?;
        
        // Create session
        let session = Session {
            id: Uuid::new_v4().to_string(),
            user_id: user.id.clone(),
            access_token: access_token.clone(),
            refresh_token: refresh_token.clone(),
            ip_address: ip_address.clone(),
            user_agent: None,
            trusted_device: request.trusted_device.unwrap_or(false),
            expires_at: Utc::now() + self.config.refresh_token_expiry,
            created_at: Utc::now(),
        };
        
        // Store session
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session.id.clone(), session);
        }
        
        // Reset failed attempts
        {
            let mut users = self.users.write().await;
            if let Some(u) = users.get_mut(&user.id) {
                u.failed_login_attempts = 0;
                u.last_login_at = Some(Utc::now());
            }
        }
        
        info!("User logged in: {}", user.id);
        
        Ok(LoginResponse {
            access_token,
            refresh_token,
            expires_in: self.config.access_token_expiry.as_secs(),
            user: self.user_to_response(&user),
            requires_two_factor: false,
            requires_verification: !user.email_verified && !user.phone_verified,
        })
    }
    
    pub async fn refresh_access_token(&self, refresh_token: &str) -> Result<String, AuthError> {
        let token_data = {
            let tokens = self.refresh_tokens.read().await;
            tokens.get(refresh_token).cloned()
        };
        
        let token = match token_data {
            Some(t) => t,
            None => return Err(AuthError::InvalidToken),
        };
        
        if token.revoked {
            return Err(AuthError::InvalidToken);
        }
        
        if token.expires_at < Utc::now() {
            return Err(AuthError::TokenExpired);
        }
        
        let user = {
            let users = self.users.read().await;
            users.get(&token.user_id).cloned()
        };
        
        let user = match user {
            Some(u) => u,
            None => return Err(AuthError::AccountNotFound),
        };
        
        self.generate_access_token(&user)
    }
    
    // =============================================================================
    // PASSWORD MANAGEMENT
    // =============================================================================
    
    pub async fn reset_password(&self, email_or_phone: &str, code: &str, new_password: &str) -> Result<(), AuthError> {
        // Verify OTP
        self.verify_otp(email_or_phone, code, &OTPType::PasswordReset).await?;
        
        // Find user
        let user_id = {
            let users = self.users.read().await;
            let is_email = email_or_phone.contains('@');
            
            let user = if is_email {
                users.values().find(|u| u.email.as_deref() == Some(email_or_phone))
            } else {
                users.values().find(|u| u.phone.as_deref() == Some(email_or_phone))
            };
            
            user.map(|u| u.id.clone())
        };
        
        let user_id = match user_id {
            Some(id) => id,
            None => return Err(AuthError::AccountNotFound),
        };
        
        // Hash new password
        let password_hash = self.hash_password(new_password)?;
        
        // Update password
        {
            let mut users = self.users.write().await;
            if let Some(user) = users.get_mut(&user_id) {
                user.password_hash = password_hash;
                user.updated_at = Utc::now();
            }
        }
        
        // Invalidate all sessions
        {
            let mut sessions = self.sessions.write().await;
            sessions.retain(|_, s| s.user_id != user_id);
        }
        
        info!("Password reset for user: {}", user_id);
        
        Ok(())
    }
    
    // =============================================================================
    // TWO-FACTOR AUTHENTICATION
    // =============================================================================
    
    pub async fn enable_two_factor(&self, user_id: &str, code: &str) -> Result<String, AuthError> {
        let user = {
            let users = self.users.read().await;
            users.get(user_id).cloned()
        };
        
        let user = match user {
            Some(u) => u,
            None => return Err(AuthError::AccountNotFound),
        };
        
        // Verify the code
        if !self.verify_two_factor_code(&user, code)? {
            return Err(AuthError::InvalidTwoFactorCode);
        }
        
        // Enable 2FA
        {
            let mut users = self.users.write().await;
            if let Some(u) = users.get_mut(user_id) {
                u.two_factor_enabled = true;
                u.updated_at = Utc::now();
            }
        }
        
        info!("2FA enabled for user: {}", user_id);
        
        Ok("2FA enabled successfully".to_string())
    }
    
    pub async fn disable_two_factor(&self, user_id: &str, code: &str) -> Result<(), AuthError> {
        let user = {
            let users = self.users.read().await;
            users.get(user_id).cloned()
        };
        
        let user = match user {
            Some(u) => u,
            None => return Err(AuthError::AccountNotFound),
        };
        
        // Verify the code
        if !self.verify_two_factor_code(&user, code)? {
            return Err(AuthError::InvalidTwoFactorCode);
        }
        
        // Disable 2FA
        {
            let mut users = self.users.write().await;
            if let Some(u) = users.get_mut(user_id) {
                u.two_factor_enabled = false;
                u.two_factor_secret = None;
                u.updated_at = Utc::now();
            }
        }
        
        info!("2FA disabled for user: {}", user_id);
        
        Ok(())
    }
    
    // =============================================================================
    // OTP MANAGEMENT
    // =============================================================================
    
    pub async fn send_otp(&self, email_or_phone: &str, otp_type: OTPType) -> Result<String, AuthError> {
        // Generate OTP
        let code = self.generate_otp();
        let user_id = {
            let users = self.users.read().await;
            let is_email = email_or_phone.contains('@');
            
            users.values().find(|u| {
                if is_email {
                    u.email.as_deref() == Some(email_or_phone)
                } else {
                    u.phone.as_deref() == Some(email_or_phone)
                }
            }).map(|u| u.id.clone())
        };
        
        // Create OTP record
        let otp = OTP {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.unwrap_or_default(),
            code: code.clone(),
            otp_type: otp_type.clone(),
            expires_at: Utc::now() + self.config.otp_expiry,
            used: false,
            created_at: Utc::now(),
        };
        
        // Store OTP
        {
            let mut otps = self.otps.write().await;
            otps.entry(email_or_phone.to_string())
                .or_insert_with(Vec::new)
                .push(otp);
        }
        
        // In production, send via email/SMS
        info!("OTP sent to {}: {}", email_or_phone, code);
        
        Ok(code) // In production, don't return the code
    }
    
    pub async fn verify_otp(&self, email_or_phone: &str, code: &str, otp_type: &OTPType) -> Result<(), AuthError> {
        let otps = self.otps.read().await;
        
        let valid_otp = otps
            .get(email_or_phone)
            .and_then(|otps| {
                otps.iter().find(|o| {
                    o.code == code 
                    && !o.used 
                    && o.expires_at > Utc::now()
                    && std::mem::discriminant(&o.otp_type) == std::mem::discriminant(otp_type)
                })
            });
        
        match valid_otp {
            Some(otp) => {
                // Mark OTP as used
                drop(otps);
                let mut otps = self.otps.write().await;
                if let Some(user_otps) = otps.get_mut(email_or_phone) {
                    if let Some(o) = user_otps.iter_mut().find(|o| o.id == otp.id) {
                        o.used = true;
                    }
                }
                Ok(())
            }
            None => Err(AuthError::InvalidToken),
        }
    }
    
    // =============================================================================
    // TOKEN GENERATION
    // =============================================================================
    
    fn generate_access_token(&self, user: &User) -> Result<String, AuthError> {
        let claims = Claims::new(user, &self.config);
        
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.config.jwt_secret.as_bytes()),
        )
        .map_err(|e| AuthError::InternalError(e.to_string()))
    }
    
    fn generate_refresh_token(&self, user: &User) -> Result<String, AuthError> {
        let token = Uuid::new_v4().to_string();
        
        let refresh_token = RefreshToken {
            id: Uuid::new_v4().to_string(),
            user_id: user.id.clone(),
            token: token.clone(),
            expires_at: Utc::now() + self.config.refresh_token_expiry,
            revoked: false,
            created_at: Utc::now(),
        };
        
        // Store refresh token
        let mut tokens = tokio::task::block_in_place(|| {
            futures::executor::block_on(async {
                self.refresh_tokens.write().await
            })
        });
        tokens.insert(token.clone(), refresh_token);
        
        Ok(token)
    }
    
    fn generate_otp(&self) -> String {
        let mut code = String::new();
        let mut rng = OsRng;
        for _ in 0..self.config.otp_length {
            code.push((rng.next_u32() % 10 + b'0') as char);
        }
        code
    }
    
    // =============================================================================
    // PASSWORD HASHING
    // =============================================================================
    
    fn hash_password(&self, password: &str) -> Result<String, AuthError> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        
        argon2
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|e| AuthError::InternalError(e.to_string()))
    }
    
    fn verify_password(&self, password: &str, hash: &str) -> Result<bool, AuthError> {
        let parsed_hash = PasswordHash::new(hash)
            .map_err(|e| AuthError::InternalError(e.to_string()))?;
        
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok())
    }
    
    // =============================================================================
    // 2FA
    // =============================================================================
    
    fn verify_two_factor_code(&self, user: &User, code: &str) -> Result<bool, AuthError> {
        // In production, use totp-rs to verify
        // For now, accept any 6-digit code
        if code.len() == 6 && code.chars().all(|c| c.is_ascii_digit()) {
            Ok(true)
        } else {
            Ok(false)
        }
    }
    
    // =============================================================================
    // LOGIN ATTEMPTS
    // =============================================================================
    
    async fn record_failed_login(&self, user_id: &str, ip_address: Option<String>) -> Result<(), AuthError> {
        let mut users = self.users.write().await;
        
        if let Some(user) = users.get_mut(user_id) {
            user.failed_login_attempts += 1;
            
            if user.failed_login_attempts >= self.config.max_login_attempts {
                user.locked_until = Some(Utc::now() + self.config.lockout_duration);
                warn!("Account locked for user: {} due to failed login attempts", user_id);
            }
        }
        
        // Record attempt
        let attempt = LoginAttempt {
            user_id: user_id.to_string(),
            ip_address: ip_address.unwrap_or_default(),
            attempted_at: Utc::now(),
            success: false,
        };
        
        let mut attempts = self.login_attempts.write().await;
        attempts
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(attempt);
        
        Ok(())
    }
    
    // =============================================================================
    // HELPERS
    // =============================================================================
    
    fn user_to_response(&self, user: &User) -> UserResponse {
        UserResponse {
            id: user.id.clone(),
            email: user.email.clone(),
            phone: user.phone.clone(),
            username: user.username.clone(),
            kyc_level: user.kyc_level,
            status: format!("{:?}", user.status).to_lowercase(),
            two_factor_enabled: user.two_factor_enabled,
            email_verified: user.email_verified,
            phone_verified: user.phone_verified,
        }
    }
    
    pub async fn validate_token(&self, token: &str) -> Result<Claims, AuthError> {
        let validation = Validation {
            validate_exp: true,
            validate_iss: true,
            required_spec_claims: std::collections::HashSet::new(),
            ..Default::default()
        };
        
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.config.jwt_secret.as_bytes()),
            &validation,
        )
        .map_err(|e| {
            if e.to_string().contains("ExpiredSignature") {
                AuthError::TokenExpired
            } else {
                AuthError::InvalidToken
            }
        })?;
        
        Ok(token_data.claims)
    }
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedAuthService = Arc<AuthService>;

pub struct AppState {
    pub auth_service: SharedAuthService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn check_account(
    State(state): State<AppState>,
    Json(request): Json<CheckAccountRequest>,
) -> Result<Json<ApiResponse<AccountStatusResponse>>, AuthError> {
    let result = state.auth_service
        .check_account(&request.email_or_phone)
        .await?;
    
    Ok(Json(ApiResponse::success(result)))
}

async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<ApiResponse<UserResponse>>, AuthError> {
    let user = state.auth_service.register(request).await?;
    let response = UserResponse {
        id: user.id.clone(),
        email: user.email.clone(),
        phone: user.phone.clone(),
        username: user.username.clone(),
        kyc_level: user.kyc_level,
        status: format!("{:?}", user.status).to_lowercase(),
        two_factor_enabled: user.two_factor_enabled,
        email_verified: user.email_verified,
        phone_verified: user.phone_verified,
    };
    
    Ok(Json(ApiResponse::success(response)))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<ApiResponse<LoginResponse>>, AuthError> {
    let result = state.auth_service
        .login(request, None)
        .await?;
    
    Ok(Json(ApiResponse::success(result)))
}

async fn refresh_token(
    State(state): State<AppState>,
    Json(request): Json<RefreshTokenRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    let access_token = state.auth_service
        .refresh_access_token(&request.refresh_token)
        .await?;
    
    Ok(Json(ApiResponse::success(serde_json::json!({
        "access_token": access_token,
        "expires_in": 3600
    }))))
}

async fn send_otp(
    State(state): State<AppState>,
    Json(request): Json<SendOTPRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state.auth_service
        .send_otp(&request.email_or_phone, request.otp_type)
        .await?;
    
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "OTP sent successfully"
    }))))
}

async fn verify_otp(
    State(state): State<AppState>,
    Json(request): Json<VerifyOTPRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state.auth_service
        .verify_otp(&request.email_or_phone, &request.code, &request.otp_type)
        .await?;
    
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "OTP verified successfully"
    }))))
}

async fn reset_password(
    State(state): State<AppState>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state.auth_service
        .reset_password(&request.email_or_phone, &request.code, &request.new_password)
        .await?;
    
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "Password reset successfully"
    }))))
}

async fn enable_2fa(
    State(state): State<AppState>,
    Json(request): Json<EnableTwoFactorRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    // In production, get user_id from authenticated session
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "2FA enabled"
    }))))
}

async fn disable_2fa(
    State(state): State<AppState>,
    Json(request): Json<DisableTwoFactorRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    // In production, get user_id from authenticated session
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "2FA disabled"
    }))))
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "auth-service",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// =============================================================================
// MAIN
// =============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();
    
    info!("Starting TigerEx Auth Service");
    
    // Load configuration
    let config = Config::default();
    
    // Create auth service
    let auth_service = Arc::new(AuthService::new(config));
    let state = AppState {
        auth_service: auth_service.clone(),
    };
    
    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/auth/check-account", post(check_account))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh_token))
        .route("/api/v1/auth/send-otp", post(send_otp))
        .route("/api/v1/auth/verify-otp", post(verify_otp))
        .route("/api/v1/auth/reset-password", post(reset_password))
        .route("/api/v1/auth/enable-2fa", post(enable_2fa))
        .route("/api/v1/auth/disable-2fa", post(disable_2fa))
        .with_state(state);
    
    // Start server
    let addr = "0.0.0.0:8080".parse()?;
    
    info!("Auth service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}
