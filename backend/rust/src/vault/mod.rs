//! Vault Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry { pub id: String, pub data: String, pub created_at: i64 }

pub struct Vault {
    entries: HashMap<String, VaultEntry>,
}

impl Vault {
    pub fn new() -> Self { Self { entries: HashMap::new() } }
    pub fn put(&mut self, id: &str, data: &str) {
        self.entries.insert(id.to_string(), VaultEntry { id: id.to_string(), data: data.to_string(), created_at: now_ms() });
    }
    pub fn get(&self, id: &str) -> Option<String> { self.entries.get(id).map(|e| e.data.clone()) }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut v = Vault::new(); v.put("config", "{}"); } }
