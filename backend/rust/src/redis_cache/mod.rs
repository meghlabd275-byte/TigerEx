//! Redis Cache - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheItem { pub value: String, pub expires: Option<i64> }

pub struct RedisCache {
    store: HashMap<String, CacheItem>,
}

impl RedisCache {
    pub fn new() -> Self { Self { store: HashMap::new() } }
    pub fn set(&mut self, key: &str, value: &str, ttl_secs: Option<u64>) {
        let exp = ttl_secs.map(|t| (std::time::SystemTime::now() + Duration::from_secs(t)).duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64);
        self.store.insert(key.to_string(), CacheItem { value: value.to_string(), expires: exp });
    }
    pub fn get(&self, key: &str) -> Option<String> {
        self.store.get(key).map(|i| i.value.clone())
    }
    pub fn del(&mut self, key: &str) { self.store.remove(key); }
    pub fn exists(&self, key: &str) -> bool { self.store.contains_key(key) }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = RedisCache::new(); c.set("key", "value", Some(60)); assert!(c.get("key") == Some("value".to_string())); } }
