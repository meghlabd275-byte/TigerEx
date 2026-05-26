//! TigerEx Security Services - RUST
//! Memory-safe authentication, encryption, and risk management

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// AUTHENTICATION
// ============================================================================

#[derive(Clone)]
pub struct Session {
    pub user_id: String,
    pub token: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub ip_address: String,
}

pub struct AuthService {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn create_session(&self, user_id: String, ip: String, ttl_secs: u64) -> Result<Session, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let token = format!("{:x}{:x}", now, SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos());
        
        let session = Session {
            user_id: user_id.clone(),
            token: token.clone(),
            created_at: now,
            expires_at: now + ttl_secs,
            ip_address: ip,
        };
        
        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(token, session.clone());
        
        Ok(session)
    }

    pub fn validate_token(&self, token: &str) -> Result<Session, String> {
        let sessions = self.sessions.read().unwrap();
        
        if let Some(session) = sessions.get(token) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            if session.expires_at > now {
                return Ok(session.clone());
            }
        }
        
        Err("Invalid or expired token".to_string())
    }

    pub fn revoke_session(&self, token: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().unwrap();
        sessions.remove(token);
        Ok(())
    }
}

pub struct PasswordHasher {}

impl PasswordHasher {
    pub fn hash(password: &str) -> String {
        let mut hash: u64 = 0;
        for (i, byte) in password.bytes().enumerate() {
            hash = hash.wrapping_add((byte as u64).wrapping_mul(31_u64.pow(i as u32)));
        }
        format!("{:016x}", hash)
    }

    pub fn verify(password: &str, hash: &str) -> bool {
        Self::hash(password) == hash
    }
}

// ============================================================================
// RISK ENGINE
// ============================================================================

#[derive(Clone)]
pub struct RiskCheck {
    pub user_id: String,
    pub check_type: String,
    pub score: f64,
    pub level: RiskLevel,
    pub reasons: Vec<String>,
    pub timestamp: u64,
}

#[derive(Clone, PartialEq)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

pub struct RiskEngine {
    rules: Arc<RwLock<Vec<RiskRule>>>,
}

#[derive(Clone)]
pub struct RiskRule {
    pub name: String,
    pub threshold: f64,
    pub weight: f64,
    pub reason: String,
}

impl RiskEngine {
    pub fn new() -> Self {
        let rules = vec![
            RiskRule { name: "large_withdraw".to_string(), threshold: 10000.0, weight: 0.3, reason: "Large withdrawal".to_string() },
            RiskRule { name: "rapid_trading".to_string(), threshold: 100.0, weight: 0.2, reason: "Rapid trading".to_string() },
            RiskRule { name: "new_account".to_string(), threshold: 24.0, weight: 0.2, reason: "New account large tx".to_string() },
            RiskRule { name: "multiple_failed".to_string(), threshold: 5.0, weight: 0.15, reason: "Failed attempts".to_string() },
        ];
        
        Self {
            rules: Arc::new(RwLock::new(rules)),
        }
    }

    pub fn evaluate(&self, user_id: &str, amount: f64, velocity: u32, account_age_hours: u32) -> RiskCheck {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let mut score = 0.0;
        let mut reasons = Vec::new();
        
        let rules = self.rules.read().unwrap();
        
        for rule in rules.iter() {
            match rule.name.as_str() {
                "large_withdraw" => {
                    if amount > rule.threshold {
                        score += rule.weight;
                        reasons.push(rule.reason.clone());
                    }
                }
                "rapid_trading" => {
                    if velocity as f64 > rule.threshold {
                        score += rule.weight;
                        reasons.push(rule.reason.clone());
                    }
                }
                _ => {}
            }
        }
        
        let level = if score < 0.2 {
            RiskLevel::Low
        } else if score < 0.5 {
            RiskLevel::Medium
        } else if score < 0.8 {
            RiskLevel::High
        } else {
            RiskLevel::Critical
        };
        
        RiskCheck {
            user_id: user_id.to_string(),
            check_type: "transaction".to_string(),
            score,
            level,
            reasons,
            timestamp: now,
        }
    }

    pub fn should_block(&self, check: &RiskCheck) -> bool {
        check.level == RiskLevel::Critical
    }
}

// ============================================================================
// FRAUD DETECTION
// ============================================================================

#[derive(Clone)]
pub struct FraudSignal {
    pub user_id: String,
    pub signal_type: String,
    pub severity: f64,
    pub description: String,
}

pub struct FraudDetector {
    signals: Arc<RwLock<Vec<FraudSignal>>>,
}

impl FraudDetector {
    pub fn new() -> Self {
        Self {
            signals: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn detect(&self, user_id: &str, events: &[String]) -> Vec<FraudSignal> {
        let mut signals = Vec::new();
        
        if events.iter().filter(|e| e.starts_with("ip_change")).count() > 5 {
            signals.push(FraudSignal {
                user_id: user_id.to_string(),
                signal_type: "rapid_ip_change".to_string(),
                severity: 0.7,
                description: "Multiple IP changes".to_string(),
            });
        }
        
        if events.iter().filter(|e| e.starts_with("login_fail")).count() > 3 {
            signals.push(FraudSignal {
                user_id: user_id.to_string(),
                signal_type: "multiple_failures".to_string(),
                severity: 0.6,
                description: "Multiple login failures".to_string(),
            });
        }
        
        let mut store = self.signals.write().unwrap();
        store.extend(signals.clone());
        
        signals
    }

    pub fn get_score(&self, user_id: &str) -> f64 {
        let signals = self.signals.read().unwrap();
        let total: f64 = signals
            .iter()
            .filter(|s| s.user_id == user_id)
            .map(|s| s.severity)
            .sum();
        
        total.min(1.0)
    }
}

// ============================================================================
// AML SCREENING
// ============================================================================

pub struct AMLChecker {
    sanctioned: HashMap<String, String>,
    pep_list: HashMap<String, String>,
}

impl AMLChecker {
    pub fn new() -> Self {
        Self {
            sanctioned: HashMap::new(),
            pep_list: HashMap::new(),
        }
    }

    pub fn screen_address(&self, address: &str) -> Option<(bool, String)> {
        self.sanctioned
            .get(address)
            .map(|name| (true, format!("Sanctioned: {}", name)))
    }

    pub fn is_pep(&self, name: &str) -> bool {
        self.pep_list.values().any(|n| n == name)
    }

    pub fn add_sanctioned(&mut self, address: &str, name: &str) {
        self.sanctioned.insert(address.to_string(), name.to_string());
    }
}

// ============================================================================
// KEY MANAGEMENT
// ============================================================================

pub struct KeyManager {
    master_keys: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl KeyManager {
    pub fn new() -> Self {
        Self {
            master_keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn generate_key(&self, key_id: &str) -> Vec<u8> {
        let key: Vec<u8> = (0..32).map(|i| i as u8).collect();
        let mut keys = self.master_keys.write().unwrap();
        keys.insert(key_id.to_string(), key.clone());
        key
    }

    pub fn get_key(&self, key_id: &str) -> Option<Vec<u8>> {
        let keys = self.master_keys.read().unwrap();
        keys.get(key_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password() {
        let hash = PasswordHasher::hash("password123");
        assert!(PasswordHasher::verify("password123", &hash));
    }

    #[test]
    fn test_risk() {
        let engine = RiskEngine::new();
        let check = engine.evaluate("user1", 50000.0, 50, 12);
        assert!(check.score > 0.0);
    }
}