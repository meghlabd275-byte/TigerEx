//! TigerEx Auth Service - Rust
//! Authentication and authorization

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// User account
#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub kyc_level: u8,
    pub status: UserStatus,
    pub created_at: u64,
    pub two_factor_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UserStatus {
    Active,
    Suspended,
    Locked,
    Pending,
}

impl User {
    pub fn new(email: &str, password_hash: &str) -> Self {
        Self {
            id: generate_id(),
            email: email.to_string(),
            password_hash: password_hash.to_string(),
            kyc_level: 0,
            status: UserStatus::Pending,
            created_at: current_timestamp(),
            two_factor_enabled: false,
        }
    }
}

/// Session
#[derive(Debug, Clone)]
pub struct Session {
    pub user_id: String,
    pub token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    pub ip_address: Option<String>,
}

impl Session {
    pub fn is_valid(&self) -> bool {
        current_timestamp() < self.expires_at
    }
}

/// API Key
#[derive(Debug, Clone)]
pub struct ApiKey {
    pub id: String,
    pub user_id: String,
    pub key: String,
    pub permissions: Vec<String>,
    pub created_at: u64,
    pub last_used: Option<u64>,
}

/// Auth service
pub struct AuthService {
    users: RwLock<HashMap<String, User>>,
    sessions: RwLock<HashMap<String, Session>>,
    api_keys: RwLock<Vec<ApiKey>>,
    refresh_tokens: RwLock<HashMap<String, String>>,
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            users: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            api_keys: RwLock::new(Vec::new()),
            refresh_tokens: RwLock::new(HashMap::new()),
        }
    }

    /// Register user
    pub fn register(&self, email: &str, password: &str) -> Result<String, String> {
        // Validate email
        if !email.contains('@') {
            return Err("Invalid email".to_string());
        }

        // Validate password
        if password.len() < 8 {
            return Err("Password must be at least 8 characters".to_string());
        }

        // Hash password (simplified - use proper hashing in production)
        let hash = format!("hash_{}", password);

        let user = User::new(email, &hash);
        let user_id = user.id.clone();

        let mut users = self.users.write().unwrap();
        users.insert(user_id.clone(), user);

        Ok(user_id)
    }

    /// Login with email/password
    pub fn login(&self, email: &str, password: &str, ip: Option<&str>) -> Result<LoginResponse, String> {
        let users = self.users.read().unwrap();
        
        let user = users
            .values()
            .find(|u| u.email == email)
            .ok_or("Invalid credentials")?;

        // Verify password (simplified)
        let expected_hash = format!("hash_{}", password);
        if user.password_hash != expected_hash {
            return Err("Invalid credentials".to_string());
        }

        if user.status != UserStatus::Active {
            return Err("Account not active".to_string());
        }

        // Create session
        let token = generate_token();
        let refresh_token = generate_token();
        
        let session = Session {
            user_id: user.id.clone(),
            token: token.clone(),
            refresh_token: refresh_token.clone(),
            expires_at: current_timestamp() + 86400000, // 24 hours
            ip_address: ip.map(|s| s.to_string()),
        };

        drop(users);

        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(token.clone(), session);

        let mut refresh = self.refresh_tokens.write().unwrap();
        refresh.insert(refresh_token.clone(), user.id.clone());

        Ok(LoginResponse {
            user_id: user.id.clone(),
            token,
            refresh_token,
            expires_in: 86400,
        })
    }

    /// Logout
    pub fn logout(&self, token: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().unwrap();
        sessions.remove(token);
        Ok(())
    }

    /// Refresh token
    pub fn refresh_token(&self, refresh_token: &str) -> Result<LoginResponse, String> {
        let refresh = self.refresh_tokens.read().unwrap();
        let user_id = refresh.get(refresh_token).ok_or("Invalid token")?;
        
        let users = self.users.read().unwrap();
        let user = users.get(user_id).ok_or("User not found")?;

        drop(refresh);

        // Generate new tokens
        let new_token = generate_token();
        let new_refresh = generate_token();
        
        let session = Session {
            user_id: user.id.clone(),
            token: new_token.clone(),
            refresh_token: new_refresh.clone(),
            expires_at: current_timestamp() + 86400000,
            ip_address: None,
        };

        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(new_token.clone(), session);

        let mut refresh = self.refresh_tokens.write().unwrap();
        refresh.insert(new_refresh.clone(), user.id.clone());

        Ok(LoginResponse {
            user_id: user.id.clone(),
            token: new_token,
            refresh_token: new_refresh,
            expires_in: 86400,
        })
    }

    /// Verify token
    pub fn verify_token(&self, token: &str) -> Option<String> {
        let sessions = self.sessions.read().unwrap();
        sessions.get(token).filter(|s| s.is_valid()).map(|s| s.user_id.clone())
    }

    /// Create API key
    pub fn create_api_key(&self, user_id: &str, permissions: Vec<String>) -> Result<ApiKey, String> {
        let users = self.users.read().unwrap();
        if !users.contains_key(user_id) {
            return Err("User not found".to_string());
        }

        let key = ApiKey {
            id: generate_id(),
            user_id: user_id.to_string(),
            key: generate_key(),
            permissions,
            created_at: current_timestamp(),
            last_used: None,
        };

        let mut keys = self.api_keys.write().unwrap();
        keys.push(key.clone());

        Ok(key)
    }

    /// Verify API key
    pub fn verify_api_key(&self, key: &str) -> Option<String> {
        let keys = self.api_keys.read().unwrap();
        keys.iter().find(|k| k.key == key).map(|k| k.user_id.clone())
    }

    /// Enable 2FA
    pub fn enable_2fa(&self, user_id: &str) -> Result<String, String> {
        let mut users = self.users.write().unwrap();
        
        if let Some(user) = users.get_mut(user_id) {
            user.two_factor_enabled = true;
            Ok("2FA enabled".to_string())
        } else {
            Err("User not found".to_string())
        }
    }
}

impl Default for AuthService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LoginResponse {
    pub user_id: String,
    pub token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("u_{:x}", ts)
}

fn generate_token() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("tok_{:x}", ts)
}

fn generate_key() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("key_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register() {
        let service = AuthService::new();
        
        let result = service.register("test@example.com", "password123").unwrap();
        assert!(!result.is_empty());
    }
}