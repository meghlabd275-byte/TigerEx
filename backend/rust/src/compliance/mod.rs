//! Compliance - Rust Implementation
//! 
//! Travel rule, AML, audit logging

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Transaction report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionReport {
    pub tx_id: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub asset: String,
    pub timestamp: i64,
    pub travel_rule_data: Option<TravelRuleData>,
}

/// Travel rule data (FATF requirement)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TravelRuleData {
    pub sender_name: String,
    pub sender_wallet: String,
    pub sender_country: String,
    pub recipient_name: String,
    pub recipient_wallet: String,
    pub recipient_country: String,
}

/// Suspicious activity report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SAR {
    pub id: String,
    pub user_id: String,
    pub activity_type: String,
    pub description: String,
    pub amount: Option<f64>,
    pub filed_at: i64,
    pub status: SARStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SARStatus { Filed, UnderReview, Resolved, Escalated }

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: String,
    pub user_id: String,
    pub action: String,
    pub details: String,
    pub ip: String,
    pub timestamp: i64,
}

/// Compliance service
pub struct ComplianceService {
    pub pending_reports: HashMap<String, TransactionReport>,
    pub sar_logs: Vec<SAR>,
    pub audit_logs: Vec<AuditLog>,
}

impl ComplianceService {
    pub fn new() -> Self {
        Self { pending_reports: HashMap::new(), sar_logs: vec![], audit_logs: vec![] }
    }
    
    /// Check and apply travel rule
    pub fn check_travel_rule(&mut self, from: &str, to: &str, amount: f64) -> Option<TravelRuleData> {
        // FATF threshold: $3000
        if amount >= 3000.0 {
            Some(TravelRuleData {
                sender_name: "Sender".to_string(),
                sender_wallet: from.to_string(),
                sender_country: "US".to_string(),
                recipient_name: "Recipient".to_string(),
                recipient_wallet: to.to_string(),
                recipient_country: "US".to_string(),
            })
        } else { None }
    }
    
    /// File suspicious activity
    pub fn file_sar(&mut self, user_id: &str, act_type: &str, desc: &str) -> String {
        let id = format!("SAR_{}", self.sar_logs.len() + 1);
        self.sar_logs.push(SAR {
            id: id.clone(),
            user_id: user_id.to_string(),
            activity_type: act_type.to_string(),
            description: desc.to_string(),
            amount: None,
            filed_at: current_timestamp_ms(),
            status: SARStatus::Filed,
        });
        id
    }
    
    /// Audit user action
    pub fn log_action(&mut self, user_id: &str, action: &str, details: &str, ip: &str) {
        self.audit_logs.push(AuditLog {
            id: format!("AUD_{}", self.audit_logs.len() + 1),
            user_id: user_id.to_string(),
            action: action.to_string(),
            details: details.to_string(),
            ip: ip.to_string(),
            timestamp: current_timestamp_ms(),
        });
    }
    
    /// Get user audit trail
    pub fn get_user_audit(&self, user_id: &str) -> Vec<&AuditLog> {
        self.audit_logs.iter().filter(|l| l.user_id == user_id).collect()
    }
}

/// Country risk score
pub struct CountryRisk {
    pub country_code: String,
    pub risk_level: u8,
    pub fatf_listed: bool,
}

impl CountryRisk {
    pub fn new(code: &str) -> Self {
        let high_risk = ["KP", "IR", "SY", "CU", "BY"];
        Self {
            country_code: code.to_string(),
            risk_level: if high_risk.contains(&code) { 10 } else { 1 },
            fatf_listed: high_risk.contains(&code),
        }
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_travel_rule() {
        let mut svc = ComplianceService::new();
        let tr = svc.check_travel_rule("wallet1", "wallet2", 5000.0);
        assert!(tr.is_some());
    }
}