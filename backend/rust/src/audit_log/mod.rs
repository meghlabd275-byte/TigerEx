//! Audit Log - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub user_id: String,
    pub action: String,
    pub timestamp: i64,
    pub ip: String,
}

pub struct AuditLog {
    entries: Vec<AuditEntry>,
}

impl AuditLog {
    pub fn new() -> Self { Self { entries: vec![] } }
    pub fn log(&mut self, user: &str, action: &str, ip: &str) -> String {
        let id = format!("AUDIT_{}", self.entries.len());
        self.entries.push(AuditEntry { id: id.clone(), user_id: user.to_string(), action: action.to_string(), timestamp: now_ms(), ip: ip.to_string() });
        id
    }
    pub fn get_user_logs(&self, user: &str) -> Vec<&AuditEntry> { self.entries.iter().filter(|e| e.user_id == user).collect() }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut a = AuditLog::new(); let id = a.log("user1", "login", "192.168.1.1"); assert!(!id.is_empty()); } }
