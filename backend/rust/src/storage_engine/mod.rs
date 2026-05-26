//! Storage Engine - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub driver: String,
    pub host: String,
    pub port: u16,
    pub database: String,
}

pub struct StorageEngine {
    config: StorageConfig,
    collections: HashMap<String, Collection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub name: String,
    pub indices: Vec<String>,
}

impl StorageEngine {
    pub fn new() -> Self {
        Self {
            config: StorageConfig { driver: "postgres".to_string(), host: "db".to_string(), port: 5432, database: "tigerex".to_string() },
            collections: HashMap::new(),
        }
    }
    pub fn create_collection(&mut self, name: &str) {
        self.collections.insert(name.to_string(), Collection { name: name.to_string(), indices: vec![] });
    }
    pub fn add_index(&mut self, coll: &str, idx: &str) {
        if let Some(c) = self.collections.get_mut(coll) { c.indices.push(idx.to_string()); }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = StorageEngine::new(); s.create_collection("users"); assert!(s.collections.len() == 1); } }
