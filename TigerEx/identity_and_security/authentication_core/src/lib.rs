//! TigerEx Authentication Core Library
//! 
//! Implements:
//! - Login/password authentication
//! - JWT refresh tokens  
//! - TOTP 2FA
//! - SMS/Email OTP
//! - WebAuthn passkeys
//! - Hardware 2FA (YubiKey)
//! - Biometric authentication
//! - Anti-phishing codes
//! - Device fingerprinting
//! - Impossible travel detection
//! - Brute force protection
//! - Geo-restrictions

pub mod login;
pub mod totp_2fa;
pub mod otp;
pub mod webauthn;
pub mod session;
pub mod jwt;
pub mod device;
pub mod security;
pub mod rate_limit;

pub use login::*;
pub use totp_2fa::*;
pub use otp::*;
pub use webauthn::*;
pub use session::*;
pub use jwt::*;
pub use device::*;
pub use security::*;
pub use rate_limit::*;

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