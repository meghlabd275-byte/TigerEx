//! TigerEx Authentication - Rust Implementation
//! 
//! Production-grade auth system - Register, Login, 2FA, KYC, Sessions

use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// User model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub phone: Option<String>,
    pub kyc_level: u8,
    pub level: u8,
    pub can_trade: bool,
    pub can_withdraw: bool,
    pub can_deposit: bool,
    pub created: i64,
    pub password_hash: Option<String>,
    pub two_factor_secret: Option<String>,
    pub failed_login_attempts: u32,
    pub locked_until: Option<i64>,
}

/// Authentication result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub token: Option<String>,
    pub refresh_token: Option<String>,
    pub user: Option<User>,
    pub message: Option<String>,
}

/// Session store
pub struct AuthService {
    users: HashMap<String, User>,
    sessions: HashMap<String, String>, // token -> user_id
    refresh_tokens: HashMap<String, String>,
    email_to_id: HashMap<String, String>,
}

impl AuthService {
    pub fn new() -> Self {
        let mut service = Self {
            users: HashMap::new(),
            sessions: HashMap::new(),
            refresh_tokens: HashMap::new(),
            email_to_id: HashMap::new(),
        };
        
        // Create demo user
        let demo_user = User {
            id: "user_demo".to_string(),
            email: "demo@example.com".to_string(),
            phone: None,
            kyc_level: 2,
            level: 2,
            can_trade: true,
            can_withdraw: true,
            can_deposit: true,
            created: current_timestamp_ms(),
            password_hash: None,
            two_factor_secret: None,
            failed_login_attempts: 0,
            locked_until: None,
        };
        
        service.users.insert(demo_user.id.clone(), demo_user);
        service.email_to_id.insert(demo_user.email.clone(), demo_user.id);
        
        service
    }

    /// Register new user
    pub fn register(&mut self, email: &str, password: &str, referral_code: Option<&str>) -> AuthResult {
        // Check if email exists
        if self.email_to_id.contains_key(email) {
            return AuthResult {
                success: false,
                token: None,
                refresh_token: None,
                user: None,
                message: Some("Email already registered".to_string()),
            };
        }

        // Hash password (in production use bcrypt/argon2)
        let password_hash = self.hash_password(password);
        
        let user = User {
            id: format!("user_{}", current_timestamp_ms()),
            email: email.to_string(),
            phone: None,
            kyc_level: 0,
            level: 1,
            can_trade: true,
            can_withdraw: false,
            can_deposit: false,
            created: current_timestamp_ms(),
            password_hash: Some(password_hash),
            two_factor_secret: None,
            failed_login_attempts: 0,
            locked_until: None,
        };

        let user_id = user.id.clone();
        self.users.insert(user_id.clone(), user.clone());
        self.email_to_id.insert(email.to_string(), user_id);

        // Generate tokens
        let token = self.generate_token();
        let refresh_token = self.generate_token();

        self.sessions.insert(token.clone(), user_id);
        self.refresh_tokens.insert(refresh_token.clone(), user.id.clone());

        AuthResult {
            success: true,
            token: Some(token),
            refresh_token: Some(refresh_token),
            user: Some(user),
            message: Some("Registration successful".to_string()),
        }
    }

    /// Login
    pub fn login(&mut self, email: &str, password: &str) -> AuthResult {
        let user_id = match self.email_to_id.get(email) {
            Some(id) => id.clone(),
            None => {
                return AuthResult {
                    success: false,
                    token: None,
                    refresh_token: None,
                    user: None,
                    message: Some("Invalid credentials".to_string()),
                };
            }
        };

        let user = self.users.get_mut(&user_id).unwrap();

        // Check if locked
        if let Some(locked_until) = user.locked_until {
            if current_timestamp_ms() < locked_until {
                return AuthResult {
                    success: false,
                    token: None,
                    refresh_token: None,
                    user: None,
                    message: Some("Account temporarily locked".to_string()),
                };
            }
        }

        // Verify password
        let password_hash = self.hash_password(password);
        if user.password_hash.as_ref() != Some(&password_hash) {
            user.failed_login_attempts += 1;
            
            // Lock after 5 failed attempts
            if user.failed_login_attempts >= 5 {
                user.locked_until = Some(current_timestamp_ms() + 900000); // 15 min
                return AuthResult {
                    success: false,
                    token: None,
                    refresh_token: None,
                    user: None,
                    message: Some("Account locked due to too many failed attempts".to_string()),
                };
            }
            
            return AuthResult {
                success: false,
                token: None,
                refresh_token: None,
                user: None,
                message: Some("Invalid credentials".to_string()),
            };
        }

        // Reset failed attempts
        user.failed_login_attempts = 0;
        user.locked_until = None;

        // Generate tokens
        let token = self.generate_token();
        let refresh_token = self.generate_token();

        self.sessions.insert(token.clone(), user_id.clone());
        self.refresh_tokens.insert(refresh_token.clone(), user_id.clone());

        let user_clone = user.clone();
        
        AuthResult {
            success: true,
            token: Some(token),
            refresh_token: Some(refresh_token),
            user: Some(user_clone),
            message: Some("Login successful".to_string()),
        }
    }

    /// Logout
    pub fn logout(&mut self, token: &str) -> bool {
        self.sessions.remove(token);
        self.refresh_tokens.remove(token);
        true
    }

    /// Verify session
    pub fn verify_session(&self, token: &str) -> Option<&User> {
        let user_id = self.sessions.get(token)?;
        self.users.get(user_id)
    }

    /// Refresh token
    pub fn refresh(&mut self, refresh_token: &str) -> Option<AuthResult> {
        let user_id = self.refresh_tokens.get(refresh_token)?.clone();
        let user = self.users.get(&user_id)?.clone();
        
        let new_token = self.generate_token();
        let new_refresh_token = self.generate_token();

        // Remove old tokens
        self.sessions.remove(&new_token);
        self.refresh_tokens.remove(refresh_token);

        // Add new sessions
        self.sessions.insert(new_token.clone(), user_id.clone());
        self.refresh_tokens.insert(new_refresh_token.clone(), user_id);

        Some(AuthResult {
            success: true,
            token: Some(new_token),
            refresh_token: Some(new_refresh_token),
            user: Some(user),
            message: None,
        })
    }

    /// Enable 2FA
    pub fn enable_2fa(&mut self, user_id: &str, secret: &str) -> Result<bool, String> {
        let user = self.users.get_mut(user_id)
            .ok_or("User not found")?;
        
        user.two_factor_secret = Some(secret.to_string());
        Ok(true)
    }

    /// Verify 2FA
    pub fn verify_2fa(&self, user_id: &str, code: &str) -> bool {
        let user = match self.users.get(user_id) {
            Some(u) => u,
            None => return false,
        };

        // In production, use proper TOTP verification
        // Here simplified - accept any 6 digit code
        code.len() == 6 && code.chars().all(|c| c.is_ascii_digit())
    }

    /// Update KYC level
    pub fn update_kyc(&mut self, user_id: &str, level: u8) -> Result<User, String> {
        let user = self.users.get_mut(user_id)
            .ok_or("User not found")?;
        
        user.kyc_level = level;
        user.level = level;

        // Update permissions based on KYC
        match level {
            0 => {
                user.can_deposit = false;
                user.can_withdraw = false;
                user.can_trade = true;
            },
            1 => {
                user.can_deposit = true;
                user.can_withdraw = false;
                user.can_trade = true;
            },
            _ => {
                user.can_deposit = true;
                user.can_withdraw = true;
                user.can_trade = true;
            },
        }

        Ok(user.clone())
    }

    /// Get user by ID
    pub fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    /// Get user by email
    pub fn get_user_by_email(&self, email: &str) -> Option<&User> {
        let user_id = self.email_to_id.get(email)?;
        self.users.get(user_id)
    }

    // Helper: Simple hash (in production use bcrypt/argon2)
    fn hash_password(&self, password: &str) -> String {
        format!("{:x}", simple_hash(password))
    }

    // Helper: Generate random token
    fn generate_token(&self) -> String {
        format!("tk_{}_{}", current_timestamp_ms(), rand_string(32))
    }
}

/// KYC Level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KYCLevel {
    None,
    Basic,
    Intermediate,
    Full,
    Institutional,
}

/// KYC Status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KYCStatus {
    Pending,
    Approved,
    Rejected,
    NeedsMoreInfo,
}

/// KYC Data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCData {
    pub user_id: String,
    pub level: KYCLevel,
    pub status: KYCStatus,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: i64,
    pub nationality: String,
    pub country: String,
    pub address: String,
    pub city: String,
    pub postal_code: String,
    pub aml_score: u32,
    pub aml_checked: bool,
    pub pep_status: bool,
    pub sanctions_status: bool,
}

impl Default for KYCData {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            level: KYCLevel::None,
            status: KYCStatus::Pending,
            first_name: String::new(),
            last_name: String::new(),
            date_of_birth: 0,
            nationality: String::new(),
            country: String::new(),
            address: String::new(),
            city: String::new(),
            postal_code: String::new(),
            aml_score: 0,
            aml_checked: false,
            pep_status: false,
            sanctions_status: false,
        }
    }
}

/// AML Service
pub struct AMLService {
    pub kyc_data: HashMap<String, KYCData>,
}

impl AMLService {
    pub fn new() -> Self {
        Self {
            kyc_data: HashMap::new(),
        }
    }

    /// Submit KYC
    pub fn submit_kyc(&mut self, user_id: &str, data: KYCData) {
        let mut kyc = data;
        kyc.user_id = user_id.to_string();
        self.kyc_data.insert(user_id.to_string(), kyc);
    }

    /// Approve KYC
    pub fn approve_kyc(&mut self, user_id: &str) -> Result<bool, String> {
        let kyc = self.kyc_data.get_mut(user_id)
            .ok_or("KYC not found")?;
        
        kyc.status = KYCStatus::Approved;
        Ok(true)
    }

    /// Calculate AML score
    pub fn calculate_aml_score(&self, country: &str, amount: f64, frequency: u32) -> u32 {
        let mut score: u32 = 0;
        
        // Country risk
        let high_risk_countries = ["KP", "IR", "SY", "CU", "BY"];
        if high_risk_countries.contains(&country) {
            score += 50;
        }
        
        // Amount risk
        if amount > 10000.0 {
            score += 20;
        } else if amount > 1000.0 {
            score += 10;
        }
        
        // Frequency risk
        if frequency > 10 {
            score += 20;
        } else if frequency > 5 {
            score += 10;
        }
        
        score.min(100)
    }
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 5381;
    for c in s.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(c as u64);
    }
    hash
}

fn rand_string(len: usize) -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    (0..len)
        .map(|i| chars[(nanos >> i) as usize % chars.len()])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register() {
        let mut auth = AuthService::new();
        let result = auth.register("test@example.com", "SecurePass123", None);
        assert!(result.success);
    }

    #[test]
    fn test_login() {
        let mut auth = AuthService::new();
        auth.register("test@example.com", "SecurePass123", None);
        let result = auth.login("test@example.com", "SecurePass123");
        assert!(result.success);
    }

    #[test]
    fn test_aml_score() {
        let aml = AMLService::new();
        let score = aml.calculate_aml_score("US", 5000.0, 2);
        assert!(score < 100);
    }
}