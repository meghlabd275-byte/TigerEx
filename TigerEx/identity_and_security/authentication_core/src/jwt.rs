//! JWT issuance and verification.
//!
//! Tokens are signed HS256 with a server secret and carry a `typ` claim so an
//! access token can never be presented where a refresh token is required (and
//! vice versa). Verification pins the algorithm to HS256 — accepting the `alg`
//! header from the token would allow an `alg: none` or algorithm-confusion
//! forgery — and validates the audience/issuer and expiry.

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Access token lifetime in seconds (15 minutes).
pub const ACCESS_TOKEN_TTL_SECONDS: u64 = 900;
/// Refresh token lifetime in seconds (30 days).
pub const REFRESH_TOKEN_TTL_SECONDS: u64 = 2_592_000;

/// Token audience/issuer bound into every token.
const TOKEN_AUDIENCE: &str = "tigerex";
const TOKEN_ISSUER: &str = "tigerex-auth";

/// JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,           // User ID
    pub email: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub exp: u64,
    pub iat: u64,
    pub aud: String,
    pub iss: String,
    pub typ: String,        // "access" or "refresh"
    pub sid: String,        // Session ID
    pub jti: String,        // JWT ID
}

/// Token kind, so a token can only be used for its intended purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Access,
    Refresh,
}

impl TokenKind {
    fn as_str(self) -> &'static str {
        match self {
            TokenKind::Access => "access",
            TokenKind::Refresh => "refresh",
        }
    }
}

/// Token pairs generated on login
#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

/// Errors surfaced by the manager.
#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    /// The token was missing, malformed, expired, or failed signature checks.
    Invalid,
    /// The token was valid but of the wrong kind for this operation.
    WrongKind,
}

impl From<jsonwebtoken::errors::Error> for TokenError {
    fn from(_: jsonwebtoken::errors::Error) -> Self {
        TokenError::Invalid
    }
}

/// JWT Manager
pub struct JwtManager {
    encoding: EncodingKey,
    decoding: DecodingKey,
    access_expiry: u64,
    refresh_expiry: u64,
}

impl JwtManager {
    /// `secret` must be a high-entropy server key (>= 32 bytes recommended).
    pub fn new(secret: &str) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret.as_bytes()),
            decoding: DecodingKey::from_secret(secret.as_bytes()),
            access_expiry: ACCESS_TOKEN_TTL_SECONDS,
            refresh_expiry: REFRESH_TOKEN_TTL_SECONDS,
        }
    }

    fn encode(&self, claims: &Claims) -> Result<String, TokenError> {
        encode(&Header::new(Algorithm::HS256), claims, &self.encoding).map_err(Into::into)
    }

    /// Generate an access token.
    pub fn generate_access(
        &self,
        user_id: Uuid,
        email: Option<&str>,
        role: &str,
        session_id: Uuid,
    ) -> Result<String, TokenError> {
        let now = Utc::now().timestamp() as u64;
        self.encode(&Claims {
            sub: user_id.to_string(),
            email: email.map(String::from),
            phone: None,
            role: role.to_string(),
            exp: now + self.access_expiry,
            iat: now,
            aud: TOKEN_AUDIENCE.to_string(),
            iss: TOKEN_ISSUER.to_string(),
            typ: TokenKind::Access.as_str().to_string(),
            sid: session_id.to_string(),
            jti: Uuid::new_v4().to_string(),
        })
    }

    /// Generate a refresh token.
    pub fn generate_refresh(&self, user_id: Uuid, session_id: Uuid) -> Result<String, TokenError> {
        let now = Utc::now().timestamp() as u64;
        self.encode(&Claims {
            sub: user_id.to_string(),
            email: None,
            phone: None,
            role: "user".to_string(),
            exp: now + self.refresh_expiry,
            iat: now,
            aud: TOKEN_AUDIENCE.to_string(),
            iss: TOKEN_ISSUER.to_string(),
            typ: TokenKind::Refresh.as_str().to_string(),
            sid: session_id.to_string(),
            jti: Uuid::new_v4().to_string(),
        })
    }

    /// Issue a matched access/refresh pair bound to one session.
    pub fn generate_pair(
        &self,
        user_id: Uuid,
        email: Option<&str>,
        role: &str,
        session_id: Uuid,
    ) -> Result<TokenPair, TokenError> {
        Ok(TokenPair {
            access_token: self.generate_access(user_id, email, role, session_id)?,
            refresh_token: self.generate_refresh(user_id, session_id)?,
            expires_in: self.access_expiry,
            token_type: "Bearer".to_string(),
        })
    }

    /// Verify and decode a token of the expected kind.
    pub fn verify(&self, token: &str, expected: TokenKind) -> Result<Claims, TokenError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[TOKEN_AUDIENCE]);
        validation.set_issuer(&[TOKEN_ISSUER]);
        validation.validate_exp = true;
        let claims = decode::<Claims>(token, &self.decoding, &validation)
            .map(|t| t.claims)
            .map_err(TokenError::from)?;
        if claims.typ != expected.as_str() {
            return Err(TokenError::WrongKind);
        }
        Ok(claims)
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
            expires_at: Utc::now() + chrono::Duration::seconds(crate::SESSION_EXPIRY_SECONDS),
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
    #[serde(default)]
    pub ip: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_round_trips_with_correct_kinds() {
        let mgr = JwtManager::new("a-very-long-and-secret-signing-key-1234567890");
        let user = Uuid::new_v4();
        let sid = Uuid::new_v4();
        let pair = mgr.generate_pair(user, Some("u@example.com"), "user", sid).unwrap();

        let access = mgr.verify(&pair.access_token, TokenKind::Access).unwrap();
        assert_eq!(access.sub, user.to_string());
        assert_eq!(access.sid, sid.to_string());

        let refresh = mgr.verify(&pair.refresh_token, TokenKind::Refresh).unwrap();
        assert_eq!(refresh.sub, user.to_string());
    }

    #[test]
    fn access_token_rejected_where_refresh_required() {
        let mgr = JwtManager::new("a-very-long-and-secret-signing-key-1234567890");
        let token = mgr
            .generate_access(Uuid::new_v4(), None, "user", Uuid::new_v4())
            .unwrap();
        assert_eq!(mgr.verify(&token, TokenKind::Refresh).unwrap_err(), TokenError::WrongKind);
    }

    #[test]
    fn token_from_other_secret_is_rejected() {
        let signer = JwtManager::new("secret-one-aaaaaaaaaaaaaaaaaaaaaaaaaa");
        let verifier = JwtManager::new("secret-two-bbbbbbbbbbbbbbbbbbbbbbbbbb");
        let token = signer
            .generate_access(Uuid::new_v4(), None, "user", Uuid::new_v4())
            .unwrap();
        assert_eq!(verifier.verify(&token, TokenKind::Access).unwrap_err(), TokenError::Invalid);
    }

    #[test]
    fn alg_none_forgery_is_rejected() {
        // A token with header {"alg":"none"} and a valid-looking payload must
        // not verify: the manager pins HS256.
        use base64::Engine;
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let header = b64.encode(br#"{"alg":"none","typ":"JWT"}"#);
        let payload = b64.encode(
            br#"{"sub":"00000000-0000-0000-0000-000000000000","role":"admin","exp":9999999999,"iat":0,"aud":"tigerex","iss":"tigerex-auth","typ":"access","sid":"x","jti":"y","email":null,"phone":null}"#,
        );
        let forged = format!("{header}.{payload}.");
        let mgr = JwtManager::new("a-very-long-and-secret-signing-key-1234567890");
        assert_eq!(mgr.verify(&forged, TokenKind::Access).unwrap_err(), TokenError::Invalid);
    }

    #[test]
    fn session_manager_validate() {
        let dev = DeviceInfo {
            device_type: "desktop".into(),
            browser: "chrome".into(),
            os: "linux".into(),
            fingerprint: "fp".into(),
            ip: "10.0.0.1".into(),
        };
        let session = SessionManager::create(Uuid::new_v4(), &dev);
        assert!(SessionManager::validate(&session));
        assert_eq!(session.ip_address, "10.0.0.1");
    }
}
