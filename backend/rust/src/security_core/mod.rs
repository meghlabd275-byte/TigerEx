// Security Core - Critical Security Functions
// Migrated from TypeScript to Rust for memory-safe security

use std::collections::HashMap;

// Security event types
#[derive(Debug, Clone)]
pub enum EventType {
    Login,
    Logout,
    Trade,
    Withdrawal,
    KycUpdate,
    ApiKeyCreate,
    ApiKeyDelete,
}

// Security severity levels
#[derive(Debug, Clone)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

// Security event
#[derive(Debug, Clone)]
pub struct SecurityEvent {
    pub user_id: String,
    pub event_type: EventType,
    pub ip_address: String,
    pub timestamp: i64,
    pub severity: Severity,
    pub details: String,
}

// Failed attempt tracking
#[derive(Debug, Clone)]
pub struct FailedAttempt {
    pub user_id: String,
    pub ip_address: String,
    pub attempts: u32,
    pub first_attempt: i64,
    pub last_attempt: i64,
}

// IP blocking
#[derive(Debug, Clone)]
pub struct IpBlock {
    pub ip: String,
    pub blocked_until: i64,
    pub reason: String,
}

// API key
#[derive(Debug, Clone)]
pub struct ApiKey {
    pub key_id: String,
    pub user_id: String,
    pub name: String,
    pub permissions: Vec<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub last_used: Option<i64>,
    pub active: bool,
}

// Security manager
pub struct SecurityManager {
    failed_logins: HashMap<String, FailedAttempt>,
    ip_blocks: HashMap<String, IpBlock>,
    api_keys: HashMap<String, ApiKey>,
    events: Vec<SecurityEvent>,
}

impl SecurityManager {
    pub fn new() -> Self {
        SecurityManager {
            failed_logins: HashMap::new(),
            ip_blocks: HashMap::new(),
            api_keys: HashMap::new(),
            events: Vec::new(),
        }
    }

    // Record failed login
    pub fn record_failed_login(&mut self, user_id: &str, ip: &str) {
        let key = format!("{}:{}", user_id, ip);
        
        if let Some(attempt) = self.failed_logins.get_mut(&key) {
            attempt.attempts += 1;
            attempt.last_attempt = now_ms();
        } else {
            let attempt = FailedAttempt {
                user_id: user_id.to_string(),
                ip_address: ip.to_string(),
                attempts: 1,
                first_attempt: now_ms(),
                last_attempt: now_ms(),
            };
            self.failed_logins.insert(key, attempt);
        }
    }

    // Check if locked out
    pub fn is_locked_out(&self, user_id: &str, ip: &str) -> bool {
        let key = format!("{}:{}", user_id, ip);
        
        if let Some(attempt) = self.failed_logins.get(&key) {
            if attempt.attempts >= 5 {
                // Lockout for 15 minutes
                if now_ms() - attempt.last_attempt < 900000 {
                    return true;
                }
            }
        }
        false
    }

    // Block IP
    pub fn block_ip(&mut self, ip: &str, reason: &str, duration_minutes: i64) {
        let block = IpBlock {
            ip: ip.to_string(),
            blocked_until: now_ms() + (duration_minutes * 60000),
            reason: reason.to_string(),
        };
        self.ip_blocks.insert(ip.to_string(), block);
    }

    // Check if IP blocked
    pub fn is_ip_blocked(&self, ip: &str) -> bool {
        if let Some(block) = self.ip_blocks.get(ip) {
            if block.blocked_until > now_ms() {
                return true;
            }
        }
        false
    }

    // Create API key
    pub fn create_api_key(
        &mut self,
        user_id: &str,
        name: &str,
        permissions: Vec<String>,
        expires_days: i64,
    ) -> String {
        let key_id = format!("ak_{}", random_string(32));
        
        let api_key = ApiKey {
            key_id: key_id.clone(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            permissions,
            created_at: now_ms(),
            expires_at: now_ms() + (expires_days * 86400000),
            last_used: None,
            active: true,
        };
        
        self.api_keys.insert(key_id.clone(), api_key);
        key_id
    }

    // Validate API key
    pub fn validate_api_key(&self, key_id: &str) -> Option<&ApiKey> {
        if let Some(key) = self.api_keys.get(key_id) {
            if key.active && key.expires_at > now_ms() {
                return Some(key);
            }
        }
        None
    }

    // Revoke API key
    pub fn revoke_api_key(&mut self, key_id: &str) -> bool {
        if let Some(key) = self.api_keys.get_mut(key_id) {
            key.active = false;
            return true;
        }
        false
    }

    // Record security event
    pub fn record_event(&mut self, event: SecurityEvent) {
        self.events.push(event);
        
        // Keep only last 10000 events
        if self.events.len() > 10000 {
            self.events.remove(0);
        }
    }

    // Get recent events for user
    pub fn get_user_events(&self, user_id: &str) -> Vec<&SecurityEvent> {
        self.events
            .iter()
            .filter(|e| e.user_id == user_id)
            .collect()
    }
}

// Helper: current time in ms
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

// Helper: generate random string
fn random_string(length: usize) -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(length)
        .map(|&c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_failed_login() {
        let mut sm = SecurityManager::new();
        
        sm.record_failed_login("user1", "192.168.1.1");
        sm.record_failed_login("user1", "192.168.1.1");
        
        assert!(sm.is_locked_out("user1", "192.168.1.1"));
    }

    #[test]
    fn test_api_key() {
        let mut sm = SecurityManager::new();
        
        let key_id = sm.create_api_key(
            "user1",
            "Trading Key",
            vec!["trade".to_string()],
            365,
        );
        
        assert!(sm.validate_api_key(&key_id).is_some());
    }
}