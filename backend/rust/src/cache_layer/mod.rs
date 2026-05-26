//! Cache Layer - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry { pub value: String, pub expires_at: i64 }

pub struct CacheLayer {
    cache: HashMap<String, CacheEntry>,
}

impl CacheLayer {
    pub fn new() -> Self { Self { cache: HashMap::new() } }
    pub fn set(&mut self, key: &str, value: &str, ttl_sec: i64) {
        self.cache.insert(key.to_string(), CacheEntry { value: value.to_string(), expires_at: now_ms() + ttl_sec * 1000 });
    }
    pub fn get(&self, key: &str) -> Option<String> {
        self.cache.get(key).filter(|e| e.expires_at > now_ms()).map(|e| e.value.clone())
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = CacheLayer::new(); c.set("key", "val", 60); } }
