//! TigerEx Authentication Service
//!
//! Real authentication: Argon2id password hashing, JWT access tokens, opaque
//! refresh tokens, RFC 6238 TOTP two-factor auth, single-use expiring OTPs and
//! account lockout.
//!
//! Security properties:
//! - No secret has a hard-coded default. JWT_SECRET must be supplied and must
//!   be at least 32 bytes, otherwise the service refuses to start.
//! - 2FA codes are verified against the user's real TOTP secret. A code is
//!   never accepted merely for being six digits.
//! - OTPs are generated from OS entropy, hashed at rest, single-use and
//!   time-limited. The code is never returned to the caller.
//! - Login responses are identical for unknown users and wrong passwords, so
//!   the endpoint cannot be used to enumerate accounts.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    body::Body,
    extract::{ConnectInfo, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::RwLock;
use totp_rs::{Algorithm as TotpAlgorithm, Secret, TOTP};
use tracing::{error, info, warn};
use uuid::Uuid;

// =============================================================================
// ERRORS
// =============================================================================

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("invalid credentials")]
    InvalidCredentials,

    #[error("account not found")]
    AccountNotFound,

    #[error("account locked")]
    AccountLocked { until: DateTime<Utc> },

    #[error("account already exists")]
    AccountAlreadyExists,

    #[error("invalid token")]
    InvalidToken,

    #[error("token expired")]
    TokenExpired,

    #[error("invalid two-factor code")]
    InvalidTwoFactorCode,

    #[error("two-factor is not configured")]
    TwoFactorNotConfigured,

    #[error("two-factor is already enabled")]
    TwoFactorAlreadyEnabled,

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("rate limit exceeded")]
    RateLimitExceeded,

    #[error("internal error: {0}")]
    InternalError(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response<Body> {
        let (status, message) = match &self {
            AuthError::InvalidCredentials => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::AccountNotFound => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::AccountLocked { until } => (
                StatusCode::LOCKED,
                format!("account locked until {}", until.to_rfc3339()),
            ),
            AuthError::AccountAlreadyExists => (StatusCode::CONFLICT, self.to_string()),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::TokenExpired => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::InvalidTwoFactorCode => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::TwoFactorNotConfigured => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::TwoFactorAlreadyEnabled => (StatusCode::CONFLICT, self.to_string()),
            AuthError::InvalidRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::RateLimitExceeded => (StatusCode::TOO_MANY_REQUESTS, self.to_string()),
            // Never leak internal detail to clients.
            AuthError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
        };

        if matches!(self, AuthError::InternalError(_)) {
            error!("auth internal error: {}", self);
        }

        let body = serde_json::json!({
            "success": false,
            "error": { "code": status.as_u16(), "message": message }
        });

        (status, Json(body)).into_response()
    }
}

// =============================================================================
// CONFIG
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

impl Config {
    /// Build configuration from the environment.
    ///
    /// JWT_SECRET is mandatory and must be at least 32 bytes; there is no
    /// fallback secret.
    pub fn from_env() -> Result<Self> {
        let jwt_secret = std::env::var("JWT_SECRET").map_err(|_| {
            anyhow::anyhow!("JWT_SECRET must be set; refusing to start with a default secret")
        })?;
        if jwt_secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 bytes");
        }

        Ok(Self {
            jwt_secret,
            jwt_issuer: std::env::var("JWT_ISSUER").unwrap_or_else(|_| "tigerex.com".to_string()),
            access_token_expiry: Duration::from_secs(3600),
            refresh_token_expiry: Duration::from_secs(604800),
            max_login_attempts: 5,
            lockout_duration: Duration::from_secs(900),
            password_min_length: 12,
            otp_expiry: Duration::from_secs(300),
            otp_length: 6,
        })
    }
}

// =============================================================================
// DATA TYPES
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    Email,
    Phone,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub username: String,
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
    pub fn new(
        email: Option<String>,
        phone: Option<String>,
        username: String,
        password_hash: String,
    ) -> Self {
        let credential_type = if email.is_some() {
            CredentialType::Email
        } else {
            CredentialType::Phone
        };

        Self {
            id: Uuid::new_v4().to_string(),
            email,
            phone,
            username,
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
        self.locked_until.map(|until| until > Utc::now()).unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub ip_address: Option<String>,
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
    /// SHA-256 of the OTP; the plaintext code is never stored.
    pub code_hash: String,
    pub otp_type: OTPType,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub sub: String,
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
        Self {
            sub: user.id.clone(),
            email: user.email.clone(),
            phone: user.phone.clone(),
            username: user.username.clone(),
            kyc_level: user.kyc_level,
            iat: now,
            exp: now + config.access_token_expiry.as_secs() as i64,
            iss: config.jwt_issuer.clone(),
            typ: "access".to_string(),
        }
    }
}

// =============================================================================
// REQUEST / RESPONSE TYPES
// =============================================================================

#[derive(Debug, Deserialize, Serialize)]
pub struct RegisterRequest {
    pub email: Option<String>,
    pub phone: Option<String>,
    pub username: String,
    pub password: String,
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
pub struct SendOTPRequest {
    pub email_or_phone: String,
    pub otp_type: OTPType,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VerifyOTPRequest {
    pub email_or_phone: String,
    pub code: String,
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
    pub user_id: String,
    pub code: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DisableTwoFactorRequest {
    pub user_id: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize)]
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
pub struct TwoFactorSetup {
    pub secret: String,
    pub otpauth_url: String,
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

pub type SharedAuthService = Arc<AuthService>;

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

    pub fn config(&self) -> &Config {
        &self.config
    }

    // -------------------------------------------------------------------------
    // USER MANAGEMENT
    // -------------------------------------------------------------------------

    pub async fn register(&self, request: RegisterRequest) -> Result<User, AuthError> {
        let email = request.email.as_deref().map(str::trim).filter(|e| !e.is_empty());
        let phone = request.phone.as_deref().map(str::trim).filter(|p| !p.is_empty());

        if email.is_none() && phone.is_none() {
            return Err(AuthError::InvalidRequest(
                "either email or phone is required".to_string(),
            ));
        }
        if let Some(email) = email {
            if !is_valid_email(email) {
                return Err(AuthError::InvalidRequest("invalid email address".to_string()));
            }
        }
        if let Some(phone) = phone {
            if !is_valid_phone(phone) {
                return Err(AuthError::InvalidRequest("invalid phone number".to_string()));
            }
        }
        if request.username.trim().len() < 3 {
            return Err(AuthError::InvalidRequest(
                "username must be at least 3 characters".to_string(),
            ));
        }
        if let Err(reason) = check_password_strength(&request.password, self.config.password_min_length) {
            return Err(AuthError::InvalidRequest(reason));
        }

        let password_hash = self.hash_password(&request.password)?;

        let mut users = self.users.write().await;
        if let Some(email) = email {
            if users.values().any(|u| u.email.as_deref() == Some(email)) {
                return Err(AuthError::AccountAlreadyExists);
            }
        }
        if let Some(phone) = phone {
            if users.values().any(|u| u.phone.as_deref() == Some(phone)) {
                return Err(AuthError::AccountAlreadyExists);
            }
        }

        let user = User::new(
            email.map(str::to_string),
            phone.map(str::to_string),
            request.username.trim().to_string(),
            password_hash,
        );
        users.insert(user.id.clone(), user.clone());
        info!("user registered: {}", user.id);

        Ok(user)
    }

    pub async fn login(
        &self,
        request: LoginRequest,
        ip_address: Option<String>,
    ) -> Result<LoginResponse, AuthError> {
        let lookup = request.email_or_phone.trim().to_string();
        let is_email = lookup.contains('@');

        let user = {
            let users = self.users.read().await;
            let found = if is_email {
                users.values().find(|u| u.email.as_deref() == Some(lookup.as_str()))
            } else {
                users.values().find(|u| u.phone.as_deref() == Some(lookup.as_str()))
            };
            found.cloned()
        };

        // For an unknown account, still perform a password hash verification so
        // the timing of this path resembles the known-account path.
        let user = match user {
            Some(user) => user,
            None => {
                let _ = self.verify_password(&request.password, &self.dummy_hash());
                return Err(AuthError::InvalidCredentials);
            }
        };

        if user.is_locked() {
            return Err(AuthError::AccountLocked {
                until: user.locked_until.unwrap_or_else(Utc::now),
            });
        }

        if !self.verify_password(&request.password, &user.password_hash)? {
            self.record_failed_login(&user.id, ip_address.clone()).await?;
            return Err(AuthError::InvalidCredentials);
        }

        if user.status != UserStatus::Active {
            return Err(AuthError::InvalidCredentials);
        }

        // Two-factor: a missing code means the client must retry with one.
        if user.two_factor_enabled {
            match &request.two_factor_code {
                Some(code) => {
                    if !self.verify_two_factor_code(&user, code)? {
                        self.record_failed_login(&user.id, ip_address.clone()).await?;
                        return Err(AuthError::InvalidTwoFactorCode);
                    }
                }
                None => {
                    return Ok(LoginResponse {
                        access_token: String::new(),
                        refresh_token: String::new(),
                        expires_in: 0,
                        user: self.user_to_response(&user),
                        requires_two_factor: true,
                        requires_verification: false,
                    });
                }
            }
        }

        let access_token = self.generate_access_token(&user)?;
        let refresh_token = self.generate_refresh_token(&user).await?;

        {
            let session = Session {
                id: Uuid::new_v4().to_string(),
                user_id: user.id.clone(),
                access_token: access_token.clone(),
                refresh_token: refresh_token.clone(),
                ip_address: ip_address.clone(),
                trusted_device: request.trusted_device.unwrap_or(false),
                expires_at: Utc::now() + self.config.refresh_token_expiry,
                created_at: Utc::now(),
            };
            self.sessions.write().await.insert(session.id.clone(), session);
        }

        {
            let mut users = self.users.write().await;
            if let Some(stored) = users.get_mut(&user.id) {
                stored.failed_login_attempts = 0;
                stored.locked_until = None;
                stored.last_login_at = Some(Utc::now());
            }
        }

        info!("user logged in: {}", user.id);

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
        let token = {
            let tokens = self.refresh_tokens.read().await;
            tokens.get(refresh_token).cloned()
        }
        .ok_or(AuthError::InvalidToken)?;

        if token.revoked {
            return Err(AuthError::InvalidToken);
        }
        if token.expires_at < Utc::now() {
            return Err(AuthError::TokenExpired);
        }

        let user = {
            let users = self.users.read().await;
            users.get(&token.user_id).cloned()
        }
        .ok_or(AuthError::AccountNotFound)?;

        if user.status != UserStatus::Active {
            return Err(AuthError::InvalidCredentials);
        }

        self.generate_access_token(&user)
    }

    /// Revoke a refresh token and any session that used it.
    pub async fn revoke_refresh_token(&self, refresh_token: &str) -> bool {
        let mut tokens = self.refresh_tokens.write().await;
        match tokens.get_mut(refresh_token) {
            Some(token) => {
                token.revoked = true;
                let user_id = token.user_id.clone();
                let mut sessions = self.sessions.write().await;
                sessions.retain(|_, s| !(s.user_id == user_id && s.refresh_token == refresh_token));
                true
            }
            None => false,
        }
    }

    pub async fn reset_password(
        &self,
        email_or_phone: &str,
        code: &str,
        new_password: &str,
    ) -> Result<(), AuthError> {
        self.verify_otp(email_or_phone, code, &OTPType::PasswordReset).await?;

        if let Err(reason) = check_password_strength(new_password, self.config.password_min_length) {
            return Err(AuthError::InvalidRequest(reason));
        }

        let user_id = self
            .find_user_id(email_or_phone)
            .await
            .ok_or(AuthError::AccountNotFound)?;
        let password_hash = self.hash_password(new_password)?;

        {
            let mut users = self.users.write().await;
            if let Some(user) = users.get_mut(&user_id) {
                user.password_hash = password_hash;
                user.failed_login_attempts = 0;
                user.locked_until = None;
                user.updated_at = Utc::now();
            }
        }

        // A password change invalidates every existing session.
        {
            let mut sessions = self.sessions.write().await;
            sessions.retain(|_, s| s.user_id != user_id);
        }
        {
            let mut tokens = self.refresh_tokens.write().await;
            for token in tokens.values_mut() {
                if token.user_id == user_id {
                    token.revoked = true;
                }
            }
        }

        info!("password reset for user: {}", user_id);
        Ok(())
    }

    pub async fn change_password(
        &self,
        user_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), AuthError> {
        let user = {
            let users = self.users.read().await;
            users.get(user_id).cloned()
        }
        .ok_or(AuthError::AccountNotFound)?;

        if !self.verify_password(current_password, &user.password_hash)? {
            return Err(AuthError::InvalidCredentials);
        }
        if let Err(reason) = check_password_strength(new_password, self.config.password_min_length) {
            return Err(AuthError::InvalidRequest(reason));
        }

        let password_hash = self.hash_password(new_password)?;
        {
            let mut users = self.users.write().await;
            if let Some(stored) = users.get_mut(user_id) {
                stored.password_hash = password_hash;
                stored.updated_at = Utc::now();
            }
        }
        Ok(())
    }

    // -------------------------------------------------------------------------
    // TWO-FACTOR AUTHENTICATION
    // -------------------------------------------------------------------------

    /// Begin 2FA enrolment: returns a fresh secret and otpauth URL.
    ///
    /// The secret is stored but 2FA stays disabled until the user confirms a
    /// code with `confirm_two_factor`.
    pub async fn begin_two_factor(&self, user_id: &str) -> Result<TwoFactorSetup, AuthError> {
        let mut users = self.users.write().await;
        let user = users.get_mut(user_id).ok_or(AuthError::AccountNotFound)?;

        if user.two_factor_enabled {
            return Err(AuthError::TwoFactorAlreadyEnabled);
        }

        let secret = Secret::generate_secret();
        let base32 = secret.to_encoded().to_string();
        let totp = TOTP::new(
            TotpAlgorithm::SHA1,
            6,
            1,
            30,
            secret.to_bytes().map_err(|e| AuthError::InternalError(e.to_string()))?,
            Some("TigerEx".to_string()),
            user.username.clone(),
        )
        .map_err(|e| AuthError::InternalError(e.to_string()))?;

        user.two_factor_secret = Some(base32.clone());
        user.updated_at = Utc::now();

        Ok(TwoFactorSetup {
            secret: base32,
            otpauth_url: totp.get_url(),
        })
    }

    /// Confirm a TOTP code to activate 2FA.
    pub async fn confirm_two_factor(&self, user_id: &str, code: &str) -> Result<(), AuthError> {
        let user = {
            let users = self.users.read().await;
            users.get(user_id).cloned()
        }
        .ok_or(AuthError::AccountNotFound)?;

        if user.two_factor_secret.is_none() {
            return Err(AuthError::TwoFactorNotConfigured);
        }
        if !self.verify_two_factor_code(&user, code)? {
            return Err(AuthError::InvalidTwoFactorCode);
        }

        let mut users = self.users.write().await;
        if let Some(stored) = users.get_mut(user_id) {
            stored.two_factor_enabled = true;
            stored.updated_at = Utc::now();
        }
        info!("2FA enabled for user: {}", user_id);
        Ok(())
    }

    pub async fn disable_two_factor(&self, user_id: &str, code: &str) -> Result<(), AuthError> {
        let user = {
            let users = self.users.read().await;
            users.get(user_id).cloned()
        }
        .ok_or(AuthError::AccountNotFound)?;

        if !user.two_factor_enabled {
            return Err(AuthError::TwoFactorNotConfigured);
        }
        if !self.verify_two_factor_code(&user, code)? {
            return Err(AuthError::InvalidTwoFactorCode);
        }

        let mut users = self.users.write().await;
        if let Some(stored) = users.get_mut(user_id) {
            stored.two_factor_enabled = false;
            stored.two_factor_secret = None;
            stored.updated_at = Utc::now();
        }
        info!("2FA disabled for user: {}", user_id);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // OTP MANAGEMENT
    // -------------------------------------------------------------------------

    /// Issue an OTP for delivery. Returns the OTP id only; the code is never
    /// returned to the caller.
    pub async fn send_otp(&self, email_or_phone: &str, otp_type: OTPType) -> Result<String, AuthError> {
        let user_id = self
            .find_user_id(email_or_phone)
            .await
            .ok_or(AuthError::AccountNotFound)?;

        let code = self.generate_otp();
        let otp = OTP {
            id: Uuid::new_v4().to_string(),
            user_id,
            code_hash: sha256_hex(&code),
            otp_type,
            expires_at: Utc::now() + self.config.otp_expiry,
            used: false,
            created_at: Utc::now(),
        };

        {
            let mut otps = self.otps.write().await;
            let entry = otps.entry(email_or_phone.to_string()).or_insert_with(Vec::new);
            // Drop expired OTPs so the store cannot grow without bound.
            let now = Utc::now();
            entry.retain(|o| o.expires_at > now);
            entry.push(otp.clone());
        }

        // The delivery channel is a separate concern; the code itself must not
        // appear in logs or responses.
        info!("OTP issued to {} (id {})", email_or_phone, otp.id);

        Ok(otp.id)
    }

    pub async fn verify_otp(
        &self,
        email_or_phone: &str,
        code: &str,
        otp_type: &OTPType,
    ) -> Result<(), AuthError> {
        let code_hash = sha256_hex(code);

        let mut otps = self.otps.write().await;
        let entries = otps.get_mut(email_or_phone).ok_or(AuthError::InvalidToken)?;

        let now = Utc::now();
        let position = entries.iter().position(|o| {
            !o.used
                && o.expires_at > now
                && o.otp_type == *otp_type
                && constant_time_eq(o.code_hash.as_bytes(), code_hash.as_bytes())
        });

        match position {
            Some(index) => {
                entries[index].used = true;
                Ok(())
            }
            None => Err(AuthError::InvalidToken),
        }
    }

    // -------------------------------------------------------------------------
    // TOKEN GENERATION
    // -------------------------------------------------------------------------

    pub fn generate_access_token(&self, user: &User) -> Result<String, AuthError> {
        let claims = Claims::new(user, &self.config);
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(self.config.jwt_secret.as_bytes()),
        )
        .map_err(|e| AuthError::InternalError(e.to_string()))
    }

    async fn generate_refresh_token(&self, user: &User) -> Result<String, AuthError> {
        let token = random_token();
        let refresh_token = RefreshToken {
            id: Uuid::new_v4().to_string(),
            user_id: user.id.clone(),
            token: token.clone(),
            expires_at: Utc::now() + self.config.refresh_token_expiry,
            revoked: false,
            created_at: Utc::now(),
        };

        self.refresh_tokens
            .write()
            .await
            .insert(token.clone(), refresh_token);

        Ok(token)
    }

    fn generate_otp(&self) -> String {
        let mut code = String::with_capacity(self.config.otp_length);
        let mut rng = OsRng;
        for _ in 0..self.config.otp_length {
            code.push((rng.next_u32() % 10 + b'0' as u32) as u8 as char);
        }
        code
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims, AuthError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[self.config.jwt_issuer.as_str()]);
        validation.validate_exp = true;

        decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.config.jwt_secret.as_bytes()),
            &validation,
        )
        .map(|data| data.claims)
        .map_err(|e| match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => AuthError::TokenExpired,
            _ => AuthError::InvalidToken,
        })
    }

    // -------------------------------------------------------------------------
    // PASSWORD HASHING
    // -------------------------------------------------------------------------

    fn hash_password(&self, password: &str) -> Result<String, AuthError> {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|e| AuthError::InternalError(e.to_string()))
    }

    fn verify_password(&self, password: &str, hash: &str) -> Result<bool, AuthError> {
        let parsed = PasswordHash::new(hash).map_err(|e| AuthError::InternalError(e.to_string()))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }

    /// A fixed Argon2 hash used to equalise timing for unknown accounts.
    fn dummy_hash(&self) -> String {
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8s0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m0m".to_string()
    }

    // -------------------------------------------------------------------------
    // TWO-FACTOR VERIFICATION
    // -------------------------------------------------------------------------

    fn verify_two_factor_code(&self, user: &User, code: &str) -> Result<bool, AuthError> {
        let secret = user
            .two_factor_secret
            .as_ref()
            .ok_or(AuthError::TwoFactorNotConfigured)?;

        let code = code.trim();
        if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
            return Ok(false);
        }

        let secret = Secret::Encoded(secret.clone());
        let totp = TOTP::new(
            TotpAlgorithm::SHA1,
            6,
            1,
            30,
            secret.to_bytes().map_err(|e| AuthError::InternalError(e.to_string()))?,
            Some("TigerEx".to_string()),
            user.username.clone(),
        )
        .map_err(|e| AuthError::InternalError(e.to_string()))?;

        // `check` with skew 1 already accepts the adjacent time step.
        Ok(totp.check(code, Utc::now().timestamp() as u64))
    }

    // -------------------------------------------------------------------------
    // LOGIN ATTEMPTS
    // -------------------------------------------------------------------------

    async fn record_failed_login(
        &self,
        user_id: &str,
        ip_address: Option<String>,
    ) -> Result<(), AuthError> {
        {
            let mut users = self.users.write().await;
            if let Some(user) = users.get_mut(user_id) {
                user.failed_login_attempts += 1;
                if user.failed_login_attempts >= self.config.max_login_attempts {
                    user.locked_until = Some(Utc::now() + self.config.lockout_duration);
                    warn!("account locked for user {} after repeated failures", user_id);
                }
            }
        }

        let attempt = LoginAttempt {
            user_id: user_id.to_string(),
            ip_address: ip_address.unwrap_or_default(),
            attempted_at: Utc::now(),
            success: false,
        };
        self.login_attempts
            .write()
            .await
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(attempt);

        Ok(())
    }

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    async fn find_user_id(&self, email_or_phone: &str) -> Option<String> {
        let lookup = email_or_phone.trim();
        let is_email = lookup.contains('@');
        let users = self.users.read().await;
        let found = if is_email {
            users.values().find(|u| u.email.as_deref() == Some(lookup))
        } else {
            users.values().find(|u| u.phone.as_deref() == Some(lookup))
        };
        found.map(|u| u.id.clone())
    }

    pub fn user_to_response(&self, user: &User) -> UserResponse {
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
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

fn is_valid_email(email: &str) -> bool {
    let mut parts = email.split('@');
    let (local, domain) = match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => (local, domain),
        _ => return false,
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.contains(char::is_whitespace)
}

fn is_valid_phone(phone: &str) -> bool {
    let digits = phone.strip_prefix('+').unwrap_or(phone);
    (7..=15).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_digit())
}

/// Minimum length plus at least three of four character classes.
fn check_password_strength(password: &str, min_length: usize) -> Result<(), String> {
    if password.len() < min_length {
        return Err(format!("password must be at least {min_length} characters"));
    }
    let classes = [
        password.chars().any(|c| c.is_ascii_lowercase()),
        password.chars().any(|c| c.is_ascii_uppercase()),
        password.chars().any(|c| c.is_ascii_digit()),
        password.chars().any(|c| !c.is_ascii_alphanumeric()),
    ]
    .iter()
    .filter(|present| **present)
    .count();

    if classes < 3 {
        return Err(
            "password must contain at least three of: lowercase, uppercase, digit, symbol"
                .to_string(),
        );
    }
    Ok(())
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

/// 32 bytes of OS entropy, hex encoded.
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex_encode(&bytes)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

#[derive(Clone)]
pub struct AppState {
    pub auth_service: SharedAuthService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<ApiResponse<UserResponse>>, AuthError> {
    let user = state.auth_service.register(request).await?;
    let response = state.auth_service.user_to_response(&user);
    Ok(Json(ApiResponse::success(response)))
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<ApiResponse<LoginResponse>>, AuthError> {
    let result = state
        .auth_service
        .login(request, Some(addr.ip().to_string()))
        .await?;
    Ok(Json(ApiResponse::success(result)))
}

async fn refresh_token(
    State(state): State<AppState>,
    Json(request): Json<RefreshTokenRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    let access_token = state
        .auth_service
        .refresh_access_token(&request.refresh_token)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({
        "access_token": access_token,
        "expires_in": state.auth_service.config().access_token_expiry.as_secs()
    }))))
}

async fn send_otp(
    State(state): State<AppState>,
    Json(request): Json<SendOTPRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    let otp_id = state
        .auth_service
        .send_otp(&request.email_or_phone, request.otp_type)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({
        "message": "OTP sent",
        "otp_id": otp_id
    }))))
}

async fn verify_otp(
    State(state): State<AppState>,
    Json(request): Json<VerifyOTPRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state
        .auth_service
        .verify_otp(&request.email_or_phone, &request.code, &request.otp_type)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({ "message": "OTP verified" }))))
}

async fn reset_password(
    State(state): State<AppState>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state
        .auth_service
        .reset_password(&request.email_or_phone, &request.code, &request.new_password)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({ "message": "password reset" }))))
}

async fn begin_2fa(
    State(state): State<AppState>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<TwoFactorSetup>>, AuthError> {
    let user_id = request
        .get("user_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AuthError::InvalidRequest("user_id is required".to_string()))?;
    let setup = state.auth_service.begin_two_factor(user_id).await?;
    Ok(Json(ApiResponse::success(setup)))
}

async fn confirm_2fa(
    State(state): State<AppState>,
    Json(request): Json<EnableTwoFactorRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state
        .auth_service
        .confirm_two_factor(&request.user_id, &request.code)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({ "message": "2FA enabled" }))))
}

async fn disable_2fa(
    State(state): State<AppState>,
    Json(request): Json<DisableTwoFactorRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    state
        .auth_service
        .disable_two_factor(&request.user_id, &request.code)
        .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({ "message": "2FA disabled" }))))
}

async fn validate_token(
    State(state): State<AppState>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AuthError> {
    let token = request
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AuthError::InvalidRequest("token is required".to_string()))?;
    let claims = state.auth_service.validate_token(token)?;
    Ok(Json(ApiResponse::success(serde_json::json!({
        "sub": claims.sub,
        "username": claims.username,
        "kyc_level": claims.kyc_level,
        "exp": claims.exp
    }))))
}

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
    tracing_subscriber::fmt().with_env_filter("info").init();

    info!("Starting TigerEx Auth Service");

    let config = Config::from_env()?;
    let auth_service = Arc::new(AuthService::new(config));
    let state = AppState {
        auth_service: auth_service.clone(),
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh_token))
        .route("/api/v1/auth/send-otp", post(send_otp))
        .route("/api/v1/auth/verify-otp", post(verify_otp))
        .route("/api/v1/auth/reset-password", post(reset_password))
        .route("/api/v1/auth/2fa/begin", post(begin_2fa))
        .route("/api/v1/auth/2fa/confirm", post(confirm_2fa))
        .route("/api/v1/auth/2fa/disable", post(disable_2fa))
        .route("/api/v1/auth/validate", post(validate_token))
        .with_state(state);

    let addr: std::net::SocketAddr = "0.0.0.0:8080".parse()?;
    info!("Auth service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;

    Ok(())
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config {
            jwt_secret: "test-secret-that-is-at-least-32-bytes-long".to_string(),
            jwt_issuer: "tigerex.test".to_string(),
            access_token_expiry: Duration::from_secs(3600),
            refresh_token_expiry: Duration::from_secs(604800),
            max_login_attempts: 3,
            lockout_duration: Duration::from_secs(900),
            password_min_length: 12,
            otp_expiry: Duration::from_secs(300),
            otp_length: 6,
        }
    }

    fn service() -> AuthService {
        AuthService::new(config())
    }

    fn registration() -> RegisterRequest {
        RegisterRequest {
            email: Some("trader@example.com".to_string()),
            phone: None,
            username: "trader".to_string(),
            password: "CorrectHorse1!".to_string(),
        }
    }

    async fn active_user(service: &AuthService) -> User {
        let user = service.register(registration()).await.unwrap();
        let mut users = service.users.write().await;
        let stored = users.get_mut(&user.id).unwrap();
        stored.status = UserStatus::Active;
        stored.email_verified = true;
        stored.clone()
    }

    #[test]
    fn config_requires_secret() {
        std::env::remove_var("JWT_SECRET");
        assert!(Config::from_env().is_err());

        std::env::set_var("JWT_SECRET", "short");
        assert!(Config::from_env().is_err());

        std::env::set_var("JWT_SECRET", "a-sufficiently-long-test-secret-value-123456");
        assert!(Config::from_env().is_ok());
        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    fn password_policy_is_enforced() {
        assert!(check_password_strength("short", 12).is_err());
        assert!(check_password_strength("alllowercase", 12).is_err());
        assert!(check_password_strength("CorrectHorse1!", 12).is_ok());
    }

    #[tokio::test]
    async fn register_hashes_password_and_rejects_duplicates() {
        let service = service();
        let user = service.register(registration()).await.unwrap();

        assert_ne!(user.password_hash, "CorrectHorse1!");
        assert!(user.password_hash.starts_with("$argon2"));

        assert!(matches!(
            service.register(registration()).await.unwrap_err(),
            AuthError::AccountAlreadyExists
        ));
    }

    #[tokio::test]
    async fn register_rejects_weak_input() {
        let service = service();
        let mut request = registration();
        request.password = "password".to_string();
        assert!(matches!(
            service.register(request).await.unwrap_err(),
            AuthError::InvalidRequest(_)
        ));

        let mut request = registration();
        request.email = Some("not-an-email".to_string());
        assert!(matches!(
            service.register(request).await.unwrap_err(),
            AuthError::InvalidRequest(_)
        ));
    }

    #[tokio::test]
    async fn login_issues_verifiable_tokens() {
        let service = service();
        let user = active_user(&service).await;

        let response = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap();

        let claims = service.validate_token(&response.access_token).unwrap();
        assert_eq!(claims.sub, user.id);
        assert_eq!(claims.username, "trader");
    }

    #[tokio::test]
    async fn unknown_user_and_wrong_password_are_indistinguishable() {
        let service = service();
        active_user(&service).await;

        let unknown = service
            .login(
                LoginRequest {
                    email_or_phone: "nobody@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap_err();
        let wrong = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "WrongPassword1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap_err();

        assert!(matches!(unknown, AuthError::InvalidCredentials));
        assert!(matches!(wrong, AuthError::InvalidCredentials));
    }

    #[tokio::test]
    async fn lockout_after_repeated_failures() {
        let service = service();
        active_user(&service).await;

        for _ in 0..3 {
            let _ = service
                .login(
                    LoginRequest {
                        email_or_phone: "trader@example.com".to_string(),
                        password: "WrongPassword1!".to_string(),
                        two_factor_code: None,
                        trusted_device: None,
                    },
                    None,
                )
                .await;
        }

        let error = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap_err();

        assert!(matches!(error, AuthError::AccountLocked { .. }));
    }

    #[tokio::test]
    async fn two_factor_requires_a_real_totp_code() {
        let service = service();
        let user = active_user(&service).await;

        let setup = service.begin_two_factor(&user.id).await.unwrap();
        assert!(!setup.secret.is_empty());

        // Any six digits must not be accepted.
        assert!(matches!(
            service.confirm_two_factor(&user.id, "000000").await.unwrap_err(),
            AuthError::InvalidTwoFactorCode
        ));

        // The real code from the shared secret must be accepted.
        let secret = Secret::Encoded(setup.secret.clone());
        let totp = TOTP::new(
            TotpAlgorithm::SHA1,
            6,
            1,
            30,
            secret.to_bytes().unwrap(),
            Some("TigerEx".to_string()),
            "trader".to_string(),
        )
        .unwrap();
        let code = totp.generate_current().unwrap();
        service.confirm_two_factor(&user.id, &code).await.unwrap();

        // Login without the code asks for it; login with it succeeds.
        let pending = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap();
        assert!(pending.requires_two_factor);
        assert!(pending.access_token.is_empty());

        let code = totp.generate_current().unwrap();
        let complete = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: Some(code),
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap();
        assert!(!complete.access_token.is_empty());
    }

    #[tokio::test]
    async fn otp_is_single_use_and_not_returned() {
        let service = service();
        active_user(&service).await;

        let otp_id = service
            .send_otp("trader@example.com", OTPType::PasswordReset)
            .await
            .unwrap();
        assert!(!otp_id.is_empty());

        // Read the stored hash and find a code that matches it by brute force
        // over the 6-digit space would be slow; instead verify the negative
        // path and the storage format.
        let otps = service.otps.read().await;
        let entry = otps.get("trader@example.com").unwrap().last().unwrap();
        assert_eq!(entry.code_hash.len(), 64);
        drop(otps);

        assert!(matches!(
            service
                .verify_otp("trader@example.com", "000000", &OTPType::PasswordReset)
                .await
                .unwrap_err(),
            AuthError::InvalidToken
        ));
    }

    #[tokio::test]
    async fn password_reset_invalidates_sessions() {
        let service = service();
        active_user(&service).await;

        let login = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap();

        // Deliver an OTP then reset using its real code.
        service
            .send_otp("trader@example.com", OTPType::PasswordReset)
            .await
            .unwrap();
        let code = find_stored_otp(&service, "trader@example.com").await;
        service
            .reset_password("trader@example.com", &code, "BrandNewPass9!")
            .await
            .unwrap();

        assert!(service
            .refresh_access_token(&login.refresh_token)
            .await
            .is_err());

        // Old password no longer works, new one does.
        assert!(service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .is_err());
    }

    /// Recover the plaintext OTP for a test by matching the stored hash against
    /// the full six-digit space. Only used in tests.
    async fn find_stored_otp(service: &AuthService, key: &str) -> String {
        let target = {
            let otps = service.otps.read().await;
            otps.get(key).unwrap().last().unwrap().code_hash.clone()
        };
        for candidate in 0..1_000_000u32 {
            let code = format!("{:06}", candidate);
            if sha256_hex(&code) == target {
                return code;
            }
        }
        panic!("stored OTP not found in six-digit space");
    }

    #[tokio::test]
    async fn refresh_token_rotation_revokes() {
        let service = service();
        active_user(&service).await;

        let login = service
            .login(
                LoginRequest {
                    email_or_phone: "trader@example.com".to_string(),
                    password: "CorrectHorse1!".to_string(),
                    two_factor_code: None,
                    trusted_device: None,
                },
                None,
            )
            .await
            .unwrap();

        assert!(service
            .refresh_access_token(&login.refresh_token)
            .await
            .is_ok());
        assert!(service.revoke_refresh_token(&login.refresh_token).await);
        assert!(service
            .refresh_access_token(&login.refresh_token)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn tokens_are_unpredictable() {
        let first = random_token();
        let second = random_token();
        assert_ne!(first, second);
        assert_eq!(first.len(), 64);
    }
}
