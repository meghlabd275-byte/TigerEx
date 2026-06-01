// Fraud Prevention Engine - Money Path in Rust
// blocks accounts, rejects transactions in production

use std::collections::{HashMap, HashSet};

/// Risk score
#[derive(Debug, Clone, Copy)]
pub enum RiskLevel {
    Low,      // 0-39
    Medium,   // 40-59
    High,     // 60-79
    Critical, // 80-100
}

/// Action to take
#[derive(Debug, Clone, Copy)]
pub enum FraudAction {
    Allow,
    Flag,
    Review,
    Block,
}

/// Transaction check result
#[derive(Debug, Clone)]
pub struct FraudResult {
    pub user_id: String,
    pub tx_id: String,
    pub risk_score: u32,
    pub action: FraudAction,
    pub signals: Vec<String>,
}

/// User risk history
#[derive(Debug, Clone)]
pub struct UserRisk {
    pub user_id: String,
    pub avg_score: f64,
    pub blocked_count: u32,
    pub last_check: u64,
}

/// Fraud Prevention Engine - production enforcement
pub struct FraudEngine {
    // Risk scoring weights
    velocity_weight: u32,
    amount_weight: u32,
    country_weight: u32,
    device_weight: u32,
    ip_weight: u32,
    
    // Blocked entities
    blocked_ips: HashSet<String>,
    blocked_devices: HashSet<String>,
    blocked_countries: HashSet<String>,
    
    // Thresholds
    block_threshold: u32,
    review_threshold: u32,
    flag_threshold: u32,
    
    // History
    risk_history: HashMap<String, Vec<u32>>,
}

impl FraudEngine {
    pub fn new() -> FraudEngine {
        let mut blocked_countries = HashSet::new();
        blocked_countries.insert("KP".to_string());  // North Korea
        blocked_countries.insert("IR".to_string());  // Iran  
        blocked_countries.insert("SY".to_string()); // Syria
        blocked_countries.insert("CU".to_string()); // Cuba
        
        FraudEngine {
            velocity_weight: 40,
            amount_weight: 30,
            country_weight: 85,
            device_weight: 20,
            ip_weight: 25,
            
            blocked_ips: HashSet::new(),
            blocked_devices: HashSet::new(),
            blocked_countries,
            
            block_threshold: 80,
            review_threshold: 60,
            flag_threshold: 40,
            
            risk_history: HashMap::new(),
        }
    }
    
    /// Check transaction - called for every transaction
    pub fn check_transaction(
        &mut self,
        user_id: &str,
        tx_id: &str,
        amount: f64,
        ip: &str,
        device_id: &str,
        country: &str,
        is_new_device: bool,
        ip_changed: bool,
    ) -> FraudResult {
        let mut signals = Vec::new();
        let mut total_risk: u32 = 0;
        
        // Amount check
        if amount > 100_000.0 {
            signals.push("high_amount".to_string());
            total_risk += self.amount_weight;
        }
        
        // Velocity check
        if let Some(history) = self.risk_history.get(user_id) {
            if history.len() > 10 {
                signals.push("high_velocity".to_string());
                total_risk += self.velocity_weight;
            }
        }
        
        // Country check
        if self.blocked_countries.contains(country) {
            signals.push("blocked_country".to_string());
            total_risk += self.country_weight;
        }
        
        // IP check
        if ip_changed {
            signals.push("ip_change".to_string());
            total_risk += self.ip_weight;
        }
        
        // Device check
        if is_new_device {
            signals.push("new_device".to_string());
            total_risk += self.device_weight;
        }
        
        let risk_score = total_risk.min(100);
        
        // Determine action
        let action = if risk_score >= self.block_threshold {
            FraudAction::Block
        } else if risk_score >= self.review_threshold {
            FraudAction::Review
        } else if risk_score >= self.flag_threshold {
            FraudAction::Flag
        } else {
            FraudAction::Allow
        };
        
        // Record history
        self.risk_history
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(risk_score);
        
        FraudResult {
            user_id: user_id.to_string(),
            tx_id: tx_id.to_string(),
            risk_score,
            action,
            signals,
        }
    }
    
    /// Check user - for account-level decisions
    pub fn check_user(&self, user_id: &str) -> (bool, f64) {
        if let Some(history) = self.risk_history.get(user_id) {
            if history.is_empty() {
                return (true, 0.0);
            }
            
            let recent: Vec<_> = history.iter().rev().take(10).collect();
            let avg: f64 = recent.iter().map(|&&s| s as f64).sum::<f64>() / recent.len() as f64;
            
            (avg < 40.0, avg)
        } else {
            (true, 0.0) // No history = trusted
        }
    }
    
    /// Block entity - called by admins
    pub fn block_ip(&mut self, ip: &str) {
        self.blocked_ips.insert(ip.to_string());
    }
    
    pub fn block_device(&mut self, device: &str) {
        self.blocked_devices.insert(device.to_string());
    }
    
    pub fn block_country(&mut self, country: &str) {
        self.blocked_countries.insert(country.to_string());
    }
    
    /// Unblock
    pub fn unblock_ip(&mut self, ip: &str) {
        self.blocked_ips.remove(ip);
    }
    
    /// Get blocked entities
    pub fn get_blocked_ips(&self) -> Vec<String> {
        self.blocked_ips.iter().cloned().collect()
    }
    
    /// Check if transaction should be allowed
    pub fn should_allow(&self, result: &FraudResult) -> bool {
        matches!(result.action, FraudAction::Allow)
    }
    
    /// Force block - emergency
    pub fn emergency_block(&mut self, user_id: &str) {
        self.risk_history
            .entry(user_id.to_string())
            .or_insert_with(Vec::new);
        
        // Add max risk score
        if let Some(scores) = self.risk_history.get_mut(user_id) {
            scores.push(100);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fraud_detection() {
        let mut engine = FraudEngine::new();
        
        let result = engine.check_transaction(
            "user1", "tx1", 5000.0,
            "192.168.1.1", "device1",
            "US", false, false,
        );
        
        assert!(result.risk_score < 100);
    }
}