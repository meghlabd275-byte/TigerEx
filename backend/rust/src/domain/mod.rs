//! Domain Management - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Domain { pub name: String, pub registrar: String, pub expires_at: i64, pub locked: bool }

pub struct DomainService {
    domains: HashMap<String, Domain>,
}

impl DomainService {
    pub fn new() -> Self { Self { domains: HashMap::new() } }
    pub fn register(&mut self, name: &str, reg: &str, expiry: i64) {
        self.domains.insert(name.to_string(), Domain { name: name.to_string(), registrar: reg.to_string(), expires_at: expiry, locked: false });
    }
    pub fn lock(&mut self, name: &str) -> Result<(), String> {
        let d = self.domains.get_mut(name).ok_or("Domain not found")?;
        d.locked = true;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut d = DomainService::new(); d.register("tigerex.com", "GoDaddy", 9999999999); } }
