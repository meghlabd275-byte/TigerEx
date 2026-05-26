// Fraud Detection Module
// Migrated from TypeScript to Rust for memory-safe fraud detection

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

// Risk level classification
#[derive(Debug, Clone, PartialEq)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

// Alert severity
#[derive(Debug, Clone, PartialEq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

// Transaction metadata
#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub tx_type: String,  // deposit, withdrawal, transfer
    pub timestamp: u64,
}

// User behavior profile
#[derive(Debug, Clone)]
pub struct BehaviorProfile {
    pub user_id: String,
    pub typical_amounts: Vec<f64>,
    pub typical_times: Vec<u64>,  // hour of day
    pub ip_addresses: Vec<String>,
    pub devices: Vec<String>,
    pub last_activity: u64,
}

// Fraud alert
#[derive(Debug, Clone)]
pub struct FraudAlert {
    pub user_id: String,
    pub alert_type: String,
    pub severity: AlertSeverity,
    pub description: String,
    pub timestamp: u64,
    pub blocked: bool,
}

// Rule engine for fraud detection
pub struct FraudDetector {
    threshold_large_withdrawal: f64,
    threshold_unusual_time: u64,  // hour (e.g., 2am unusual)
    threshold_new_device: usize,
    threshold_multi_ip: usize,
    suspicious_patterns: HashMap<String, Vec<String>>,
    alerts: Vec<FraudAlert>,
}

impl FraudDetector {
    pub fn new() -> Self {
        let mut patterns = HashMap::new();
        patterns.insert(
            "rapid_trades".to_string(),
            vec!["BUY_SELL".to_string(), "SELL_BUY".to_string()],
        );
        patterns.insert(
            "layering".to_string(),
            vec!["small_orders".to_string(), "large_order".to_string()],
        );

        FraudDetector {
            threshold_large_withdrawal: 10000.0,
            threshold_unusual_time: 2,
            threshold_new_device: 3,
            threshold_multi_ip: 5,
            suspicious_patterns: patterns,
            alerts: Vec::new(),
        }
    }

    // Check for large withdrawal
    pub fn check_large_withdrawal(&mut self, tx: &Transaction) -> Option<FraudAlert> {
        if tx.tx_type == "withdrawal" && tx.amount > self.threshold_large_withdrawal {
            let alert = FraudAlert {
                user_id: tx.user_id.clone(),
                alert_type: "large_withdrawal".to_string(),
                severity: AlertSeverity::Warning,
                description: format!("Large withdrawal: {} {}", tx.amount, tx.currency),
                timestamp: tx.timestamp,
                blocked: false,
            };
            self.alerts.push(alert.clone());
            return Some(alert);
        }
        None
    }

    // Check for unusual activity time
    pub fn check_unusual_time(&mut self, tx: &Transaction) -> Option<FraudAlert> {
        let hour = (tx.timestamp / 3600) % 24;
        
        if hour < self.threshold_unusual_time || hour > 22 {
            let alert = FraudAlert {
                user_id: tx.user_id.clone(),
                alert_type: "unusual_time".to_string(),
                severity: AlertSeverity::Info,
                description: format!("Activity at unusual hour: {}", hour),
                timestamp: tx.timestamp,
                blocked: false,
            };
            self.alerts.push(alert.clone());
            return Some(alert);
        }
        None
    }

    // Check transaction velocity
    pub fn check_velocity(&mut self, user_id: &str, tx_count: u64, window_seconds: u64) -> Option<FraudAlert> {
        let threshold = 10;
        
        if tx_count > threshold {
            let alert = FraudAlert {
                user_id: user_id.to_string(),
                alert_type: "high_velocity".to_string(),
                severity: AlertSeverity::Warning,
                description: format!("{} transactions in {} seconds", tx_count, window_seconds),
                timestamp: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                blocked: false,
            };
            self.alerts.push(alert.clone());
            return Some(alert);
        }
        None
    }

    // Calculate overall risk score
    pub fn calculate_risk_score(&self, profile: &BehaviorProfile, tx: &Transaction) -> u8 {
        let mut score = 0;

        // Amount anomaly
        let is_unusual = profile.typical_amounts.iter()
            .all(|&amt| (tx.amount - amt).abs() / amt > 0.5);
        if is_unusual && profile.typical_amounts.len() > 0 {
            score += 3;
        }

        // Time anomaly
        let hour = (tx.timestamp / 3600) % 24;
        let matches_time = profile.typical_times.iter()
            .any(|&h| h == hour);
        if !matches_time && profile.typical_times.len() > 0 {
            score += 2;
        }

        // New IP check
        if profile.ip_addresses.len() > self.threshold_multi_ip {
            score += 3;
        }

        min(score, 10)
    }

    // Block transaction
    pub fn should_block(&self, risk_score: u8) -> bool {
        risk_score >= 8
    }

    // Get all alerts
    pub fn get_alerts(&self) -> &[FraudAlert] {
        &self.alerts
    }

    // Clear alerts
    pub fn clear_alerts(&mut self) {
        self.alerts.clear();
    }
}

fn min(a: u8, b: u8) -> u8 {
    if a < b { a } else { b }
}

// Machine learning anomaly detection (simplified)
pub struct AnomalyDetector {
    threshold: f64,
}

impl AnomalyDetector {
    pub fn new(threshold: f64) -> Self {
        AnomalyDetector { threshold }
    }

    // Detect anomaly using z-score
    pub fn detect(&self, value: f64, mean: f64, std_dev: f64) -> bool {
        if std_dev == 0.0 {
            return false;
        }
        let z_score = (value - mean).abs() / std_dev;
        z_score > self.threshold
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fraud_detection() {
        let mut detector = FraudDetector::new();
        
        let tx = Transaction {
            id: "tx_1".to_string(),
            user_id: "user_1".to_string(),
            amount: 15000.0,
            currency: "USDT".to_string(),
            tx_type: "withdrawal".to_string(),
            timestamp: 1000000,
        };

        let result = detector.check_large_withdrawal(&tx);
        assert!(result.is_some());
    }
}