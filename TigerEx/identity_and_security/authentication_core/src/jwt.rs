//! JWT and session management

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, TokenClaims, Validation};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// JWT Claims
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,           // User ID
    pub email: Option<String>,
    pub phone: Option<String>, 
    pub role: String,
    pub exp: u64,
    pub iat: u64,
    pub typ: String,        // "access" or "refresh"
    pub sid: String,        // Session ID
    pub jti: String,      // JWT ID
}

/// Token pairs generated on login
#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

/// JWT Manager
pub struct JwtManager {
    secret: Vec<u8>,
    access_expiry: u64,
    refresh_expiry: u64,
}

impl JwtManager {
    pub fn new(secret: &str) -> Self {
        let now = Utc::now().timestamp() as u64;
        Self {
            secret: secret.as_bytes().to_vec(),
            access_expiry: now + 900,      // 15 minutes
            refresh_expiry: now + 2592000,  // 30 days
        }
    }
    
    /// Generate access token
    pub fn generate_access(&self, user_id: Uuid, email: Option<&str>, role: &str, session_id: Uuid) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = Claims {
            sub: user_id.to_string(),
            email: email.map(String::from),
            phone: None,
            role: role.to_string(),
            exp: self.access_expiry,
            iat: Utc::now().timestamp() as u64,
            typ: "access".to_string(),
            sid: session_id.to_string(),
            jti: Uuid::new_v4().to_string(),
        };
        
        encode(&Header::default(), &claims, &EncodingKey::from_secret(&self.secret))
    }
    
    /// Generate refresh token
    pub fn generate_refresh(&self, user_id: Uuid, session_id: Uuid) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = Claims {
            sub: user_id.to_string(),
            email: None,
            phone: None,
            role: "user".to_string(),
            exp: self.refresh_expiry,
            iat: Utc::now().timestamp() as u64,
            typ: "refresh".to_string(),
            sid: session_id.to_string(),
            jti: Uuid::new_v4().to_string(),
        };
        
        encode(&Header::default(), &claims, &EncodingKey::from_secret(&self.secret))
    }
    
    /// Verify and decode token
    pub fn verify(&self, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        let val = Validation::default();
        decode::<Claims>(token, &DecodingKey::from_secret(&self.secret), &val)
            .map(|t| t.claims)
    }
}

/// Session manager
pub struct SessionManager;

impl SessionManager {
    /// Validate session
    pub fn validate(session: &Session) -> bool {
        session.valid && session.expires_at > Utc::now()
    }
    
    /// Create new session
    pub fn create(user_id: Uuid, device_info: &DeviceInfo) -> Session {
        Session {
            id: Uuid::new_v4(),
            user_id,
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::seconds(SESSION_EXPIRY_SECONDS),
            last_active_at: Utc::now(),
            device_info: device_info.clone(),
            ip_address: device_info.ip.clone(),
            valid: true,
        }
    }
}

/// Session record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
    pub device_info: DeviceInfo,
    pub ip_address: String,
    pub valid: bool,
}

/// Device info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_type: String,
    pub browser: String,
    pub os: String,
    pub fingerprint: String,
}