//! Reserve Audit - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReserveAudit {
    pub id: String,
    pub asset: String,
    pub on_chain: f64,
    pub off_chain: f64,
    pub audited: bool,
}

pub struct ReserveAuditService {
    audits: HashMap<String, ReserveAudit>,
}

impl ReserveAuditService {
    pub fn new() -> Self { Self { audits: HashMap::new() } }
    pub fn create_audit(&mut self, asset: &str, on_chain: f64, off_chain: f64) -> String {
        let id = format!("AUDIT_{}", self.audits.len());
        self.audits.insert(id.clone(), ReserveAudit { id: id.clone(), asset: asset.to_string(), on_chain, off_chain, audited: false });
        id
    }
    pub fn complete(&mut self, id: &str) -> Result<(), String> {
        let a = self.audits.get_mut(id).ok_or("Audit not found")?;
        a.audited = true;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut a = ReserveAuditService::new(); let id = a.create_audit("BTC", 50000.0, 48000.0); assert!(!id.is_empty()); } }
