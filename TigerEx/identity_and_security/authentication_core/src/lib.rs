//! TigerEx Authentication Core Library
//!
//! Implements:
//! - Login/password authentication (bcrypt + Argon2id)
//! - JWT access/refresh tokens (HS256, algorithm-pinned)
//! - TOTP 2FA
//! - SMS/Email OTP (HMAC-digested, single-use)
//! - WebAuthn passkeys (ES256 assertion verification)
//! - Session lifecycle (rotation, revocation, replay detection)
//! - Anti-phishing codes
//! - Device fingerprinting
//! - Impossible travel detection
//! - Brute force protection
//! - Geo-restrictions
//! - Per-key rate limiting
//! - API-key and request signing (HMAC-SHA256), secret sealing (AES-256-GCM)

pub mod device;
pub mod jwt;
pub mod login;
pub mod otp;
pub mod rate_limit;
pub mod security;
pub mod session;
pub mod totp_2fa;
pub mod webauthn;

pub use device::*;
pub use jwt::*;
pub use login::*;
pub use otp::*;
pub use rate_limit::*;
pub use security::*;
pub use session::*;
pub use totp_2fa::*;
pub use webauthn::*;

/// Maximum login attempts before lockout
pub const MAX_LOGIN_ATTEMPTS: u32 = 5;

/// Lockout duration in hours
pub const LOCKOUT_DURATION_HOURS: i64 = 48;

/// OTP validity in minutes
pub const OTP_VALIDITY_MINUTES: i64 = 5;

/// Session expiry in seconds (24 hours)
pub const SESSION_EXPIRY_SECONDS: i64 = 86400;

/// Refresh token validity in seconds (30 days)
pub const REFRESH_TOKEN_EXPIRY_SECONDS: i64 = 2592000;

/// Trusted device expiry in days
pub const TRUSTED_DEVICE_EXPIRY_DAYS: i64 = 30;

/// Maximum devices per user
pub const MAX_DEVICES_PER_USER: usize = 10;

/// Anti-phishing code length
pub const ANTIPHISHING_CODE_LENGTH: usize = 8;