//! Admin Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminAction {
    pub id: String,
    pub admin_id: String,
    pub action: String,
    pub target: String,
    pub timestamp: i64,
}

pub struct AdminService {
    actions: Vec<AdminAction>,
    privileges: HashMap<String, Vec<String>>,
}

impl AdminService {
    pub fn new() -> Self { Self { actions: Vec::new(), privileges: HashMap::new() } }
    pub fn grant(&mut self, admin: &str, privs: &[&str]) {
        self.privileges.insert(admin.to_string(), privs.iter().map(|s| s.to_string()).collect());
    }
    pub fn has_priv(&self, admin: &str, priv: &str) -> bool {
        self.privileges.get(admin).map(|p| p.contains(&priv.to_string())).unwrap_or(false)
    }
    pub fn log_action(&mut self, admin: &str, action: &str, target: &str) {
        self.actions.push(AdminAction { id: format!("ADM_{}", self.actions.len()), admin_id: admin.to_string(), action: action.to_string(), target: target.to_string(), timestamp: now_ms() });
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut a = AdminService::new(); a.grant("admin", &["users:write"]); assert!(a.has_priv("admin", "users:write")); } }
