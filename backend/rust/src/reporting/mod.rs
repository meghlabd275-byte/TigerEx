// Audit Logging Module
// Migrated from TypeScript to Rust for immutable audit trails

use std::collections::HashMap;
use serde::{Serialize, Deserialize};

// Audit action types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuditAction {
    Login,
    Logout,
    Deposit,
    Withdrawal,
    Trade,
    Transfer,
    KycUpdate,
    ApiKeyCreated,
    ApiKeyDeleted,
    SettingsChanged,
    AdminAction,
}

// Audit record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: String,
    pub user_id: String,
    pub action: AuditAction,
    pub resource: String,
    pub details: String,
    pub ip_address: String,
    pub user_agent: String,
    pub timestamp: i64,
    pub status: String, // success, failed
}

// Compliance report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceReport {
    pub record_id: String,
    pub report_type: String, // aml, kyc, tax
    pub period_start: i64,
    pub period_end: i64,
    pub generated_at: i64,
    pub data: HashMap<String, String>,
}

// Audit log store
pub struct AuditLog {
    records: Vec<AuditRecord>,
    compliance_reports: Vec<ComplianceReport>,
    indexes: HashMap<String, Vec<String>>, // user_id -> record_ids
}

impl AuditLog {
    pub fn new() -> Self {
        AuditLog {
            records: Vec::new(),
            compliance_reports: Vec::new(),
            indexes: HashMap::new(),
        }
    }

    // Log an action
    pub fn log(&mut self, user_id: &str, action: AuditAction, resource: &str, details: &str, ip: &str, user_agent: &str, status: &str) -> String {
        let id = format!("audit_{}", random_id());
        
        let record = AuditRecord {
            id: id.clone(),
            user_id: user_id.to_string(),
            action,
            resource: resource.to_string(),
            details: details.to_string(),
            ip_address: ip.to_string(),
            user_agent: user_agent.to_string(),
            timestamp: now_ms(),
            status: status.to_string(),
        };
        
        // Index by user
        self.indexes
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(id.clone());
        
        self.records.push(record);
        id
    }

    // Query user history
    pub fn get_user_history(&self, user_id: &str) -> Vec<&AuditRecord> {
        self.records
            .iter()
            .filter(|r| r.user_id == user_id)
            .collect()
    }

    // Query by action
    pub fn get_by_action(&self, action: &AuditAction) -> Vec<&AuditRecord> {
        self.records
            .iter()
            .filter(|r| r.action == *action)
            .collect()
    }

    // Query by date range
    pub fn get_by_timerange(&self, start: i64, end: i64) -> Vec<&AuditRecord> {
        self.records
            .iter()
            .filter(|r| r.timestamp >= start && r.timestamp <= end)
            .collect()
    }

    // Export for compliance
    pub fn export_compliance(&self, start: i64, end: i64) -> ComplianceReport {
        let records = self.get_by_timerange(start, end);
        
        let mut data = HashMap::new();
        data.insert("total_records".to_string(), records.len().to_string());
        data.insert("total_users".to_string(), self.indexes.len().to_string());
        
        ComplianceReport {
            record_id: format!("report_{}", random_id()),
            report_type: "aml".to_string(),
            period_start: start,
            period_end: end,
            generated_at: now_ms(),
            data,
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn random_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(16)
        .map(|c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_log() {
        let mut log = AuditLog::new();
        
        let id = log.log(
            "user1",
            AuditAction::Login,
            "session",
            "Successful login",
            "192.168.1.1",
            "Chrome",
            "success"
        );
        
        assert!(!id.is_empty());
        
        let history = log.get_user_history("user1");
        assert_eq!(history.len(), 1);
    }
}