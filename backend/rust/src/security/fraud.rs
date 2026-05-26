//! TigerEx Fraud Detection Module - RUST
//! Real-time fraud detection and prevention

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// FRAUD DETECTION ENGINE
// ============================================================================

#[derive(Clone)]
pub struct FraudEvent {
    pub event_id: String,
    pub user_id: String,
    pub event_type: String,
    pub amount: Option<f64>,
    pub ip_address: String,
    pub user_agent: String,
    pub metadata: HashMap<String, String>,
    pub timestamp: u64,
    pub risk_score: f64,
    pub blocked: bool,
}

#[derive(Clone)]
pub struct FraudRule {
    pub name: String,
    pub threshold: f64,
    pub action: RuleAction,
    pub description: String,
}

#[derive(Clone)]
pub enum RuleAction {
    Allow,
    Warn,
    Block,
    Require2FA,
}

pub struct FraudDetector {
    rules: Arc<RwLock<Vec<FraudRule>>>,
    events: Arc<RwLock<Vec<FraudEvent>>>,
    ip_blacklist: Arc<RwLock<HashMap<String, u64>>>>,
    user_flags: Arc<RwLock<HashMap<String, FraudUserFlags>>>,
}

#[derive(Clone)]
pub struct FraudUserFlags {
    pub user_id: String,
    pub failed_logins: u32,
    pub suspicious_ips: u32,
    pub velocity_score: f64,
    pub flagged: bool,
    pub last_flagged: Option<u64>,
}

impl FraudDetector {
    pub fn new() -> Self {
        let rules = vec![
            FraudRule {
                name: "high_velocity".to_string(),
                threshold: 0.7,
                action: RuleAction::Require2FA,
                description: "High transaction velocity".to_string(),
            },
            FraudRule {
                name: "large_transaction".to_string(),
                threshold: 0.5,
                action: RuleAction::Warn,
                description: "Large transaction detected".to_string(),
            },
            FraudRule {
                name: "new_device".to_string(),
                threshold: 0.3,
                action: RuleAction::Warn,
                description: "New device login".to_string(),
            },
            FraudRule {
                name: "geo_anomaly".to_string(),
                threshold: 0.6,
                action: RuleAction::Block,
                description: "Geographic anomaly".to_string(),
            },
            FraudRule {
                name: "rapid_logins".to_string(),
                threshold: 0.8,
                action: RuleAction::Block,
                description: "Too many login attempts".to_string(),
            },
        ];

        Self {
            rules: Arc::new(RwLock::new(rules)),
            events: Arc::new(RwLock::new(Vec::new())),
            ip_blacklist: Arc::new(RwLock::new(HashMap::new())),
            user_flags: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn analyze_event(&self, user_id: &str, event_type: &str, amount: Option<f64>, 
                     ip: &str, metadata: HashMap<String, String>) -> FraudEvent {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let mut risk_score = 0.0;
        let mut blocked = false;

        let rules = self.rules.read().unwrap();
        
        // Check velocity
        if event_type == "transaction" {
            if let Some(amt) = amount {
                if amt > 10000.0 {
                    risk_score += 0.4;
                }
                if amt > 50000.0 {
                    risk_score += 0.3;
                    blocked = true;
                }
            }
        }

        // Check IP blacklist
        {
            let blacklist = self.ip_blacklist.read().unwrap();
            if blacklist.contains_key(ip) {
                risk_score += 0.9;
                blocked = true;
            }
        }

        // Check user flags
        {
            let flags = self.user_flags.read().unwrap();
            if let Some(user_flags) = flags.get(user_id) {
                risk_score += user_flags.velocity_score;
                if user_flags.flagged {
                    risk_score += 0.5;
                }
            }
        }

        let event = FraudEvent {
            event_id: format!("evt_{}", now),
            user_id: user_id.to_string(),
            event_type: event_type.to_string(),
            amount,
            ip_address: ip.to_string(),
            user_agent: metadata.get("user_agent").cloned().unwrap_or_default(),
            metadata,
            timestamp: now,
            risk_score: risk_score.min(1.0),
            blocked,
        };

        // Store event
        let mut events = self.events.write().unwrap();
        events.push(event.clone());

        // Keep last 10000 events
        if events.len() > 10000 {
            events.drain(0..1000);
        }

        event
    }

    pub fn check_transaction(&self, user_id: &str, amount: f64, ip: &str) -> (bool, String) {
        let mut metadata = HashMap::new();
        metadata.insert("amount".to_string(), format!("{}", amount));
        
        let event = self.analyze_event(user_id, "transaction", Some(amount), ip, metadata);
        
        if event.blocked {
            return (false, "Transaction blocked due to high risk".to_string());
        }
        
        if event.risk_score > 0.7 {
            return (false, "Requires additional verification".to_string());
        }
        
        (true, "Approved".to_string())
    }

    pub fn check_login(&self, user_id: &str, ip: &str, device_fingerprint: &str) -> (bool, String) {
        let mut now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Check for rapid logins
        let events = self.events.read().unwrap();
        let recent_logins = events.iter()
            .filter(|e| e.user_id == user_id && e.event_type == "login")
            .filter(|e| now - e.timestamp < 60)
            .count();
        
        if recent_logins > 5 {
            // Flag user
            let mut flags = self.user_flags.write().unwrap();
            let user_flags = flags.entry(user_id.to_string()).or_insert(FraudUserFlags {
                user_id: user_id.to_string(),
                failed_logins: 0,
                suspicious_ips: 0,
                velocity_score: 0.0,
                flagged: true,
                last_flagged: Some(now),
            });
            user_flags.failed_logins += 1;
            
            return (false, "Too many login attempts".to_string());
        }
        
        (true, "Login approved".to_string())
    }

    pub fn add_ip_to_blacklist(&self, ip: &str) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let mut blacklist = self.ip_blacklist.write().unwrap();
        blacklist.insert(ip.to_string(), now);
    }

    pub fn remove_ip_from_blacklist(&self, ip: &str) {
        let mut blacklist = self.ip_blacklist.write().unwrap();
        blacklist.remove(ip);
    }

    pub fn flag_user(&self, user_id: &str, reason: &str) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let mut flags = self.user_flags.write().unwrap();
        let user_flags = flags.entry(user_id.to_string()).or_insert(FraudUserFlags {
            user_id: user_id.to_string(),
            failed_logins: 0,
            suspicious_ips: 0,
            velocity_score: 0.0,
            flagged: false,
            last_flagged: None,
        });
        
        user_flags.flagged = true;
        user_flags.last_flagged = Some(now);
    }

    pub fn unflag_user(&self, user_id: &str) {
        let mut flags = self.user_flags.write().unwrap();
        if let Some(user_flags) = flags.get_mut(user_id) {
            user_flags.flagged = false;
        }
    }

    pub fn get_user_risk_score(&self, user_id: &str) -> f64 {
        let flags = self.user_flags.read().unwrap();
        if let Some(user_flags) = flags.get(user_id) {
            if user_flags.flagged {
                return 1.0;
            }
            return user_flags.velocity_score;
        }
        0.0
    }
}

// ============================================================================
// ANOMALY DETECTION
// ============================================================================

pub struct AnomalyDetector {
    baseline: HashMap<String, BaselineStats>,
}

#[derive(Clone)]
pub struct BaselineStats {
    pub mean: f64,
    pub std_dev: f64,
    pub samples: u32,
}

impl AnomalyDetector {
    pub fn new() -> Self {
        Self {
            baseline: HashMap::new(),
        }
    }

    pub fn update_baseline(&mut self, metric: &str, value: f64) {
        let stats = self.baseline.entry(metric.to_string()).or_insert(BaselineStats {
            mean: 0.0,
            std_dev: 0.0,
            samples: 0,
        });

        stats.samples += 1;
        stats.mean = (stats.mean * (stats.samples - 1) as f64 + value) / stats.samples as f64;
    }

    pub fn is_anomalous(&self, metric: &str, value: f64, threshold: f64) -> bool {
        if let Some(stats) = self.baseline.get(metric) {
            let z_score = (value - stats.mean) / stats.std_dev;
            return z_score.abs() > threshold;
        }
        false
    }
}

// ============================================================================
// EXPORT
// ============================================================================

pub use fraud::{FraudDetector, FraudEvent, FraudRule};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fraud_check() {
        let detector = FraudDetector::new();
        let (approved, msg) = detector.check_transaction("user1", 5000.0, "192.168.1.1");
        assert!(approved);
        println!("{}", msg);
    }

    #[test]
    fn test_large_transaction() {
        let detector = FraudDetector::new();
        let (approved, msg) = detector.check_transaction("user1", 100000.0, "192.168.1.1");
        assert!(!approved);
        println!("{}", msg);
    }
}