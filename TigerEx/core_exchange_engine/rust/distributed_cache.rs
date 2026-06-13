//! TigerEx Distributed Cache - Rust Implementation
//! 
//! High-performance distributed cache with TTL support
//! 
//! Migration from Go for lock-free performance

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH, Duration};

/// Cache entry
#[derive(Debug, Clone)]
pub struct CacheEntry<T: Clone> {
    pub key: String,
    pub value: T,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub hits: AtomicU64,
    pub is_dirty: AtomicBool,
}

impl<T: Clone> CacheEntry<T> {
    pub fn new(key: String, value: T, ttl_ms: Option<u64>) -> Self {
        let now = current_timestamp();
        let expires_at = ttl_ms.map(|ttl| now + ttl);
        
        CacheEntry {
            key,
            value,
            created_at: now,
            expires_at,
            hits: AtomicU64::new(0),
            is_dirty: AtomicBool::new(false),
        }
    }
    
    pub fn is_expired(&self) -> bool {
        if let Some(expires) = self.expires_at {
            current_timestamp() > expires
        } else {
            false
        }
    }
    
    pub fn touch(&self) {
        self.hits.fetch_add(1, Ordering::Relaxed);
    }
}

/// Distributed Cache
pub struct DistributedCache<T: Clone> {
    data: HashMap<String, CacheEntry<T>>,
    max_size: usize,
    ttl_default: Option<u64>,
    hits_total: AtomicU64,
    misses_total: AtomicU64,
    evictions: AtomicU64,
}

impl<T: Clone> DistributedCache<T> {
    pub fn new(max_size: usize) -> Self {
        DistributedCache {
            data: HashMap::new(),
            max_size,
            ttl_default: None,
            hits_total: AtomicU64::new(0),
            misses_total: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
        }
    }
    
    pub fn with_default_ttl(mut self, ttl_ms: u64) -> Self {
        self.ttl_default = Some(ttl_ms);
        self
    }
    
    /// Get value
    pub fn get(&self, key: &str) -> Option<T> {
        if let Some(entry) = self.data.get(key) {
            if entry.is_expired() {
                return None;
            }
            entry.touch();
            self.hits_total.fetch_add(1, Ordering::Relaxed);
            Some(entry.value.clone())
        } else {
            self.misses_total.fetch_add(1, Ordering::Relaxed);
            None
        }
    }
    
    /// Set value
    pub fn set(&mut self, key: String, value: T, ttl_ms: Option<u64>) {
        let ttl = ttl_ms.or(self.ttl_default);
        
        if self.data.len() >= self.max_size && !self.data.contains_key(&key) {
            self.evict_lru();
        }
        
        let entry = CacheEntry::new(key.clone(), value, ttl);
        self.data.insert(key, entry);
    }
    
    /// Delete key
    pub fn delete(&mut self, key: &str) -> bool {
        self.data.remove(key).is_some()
    }
    
    /// Check if exists
    pub fn exists(&self, key: &str) -> bool {
        self.data.get(key).map(|e| !e.is_expired()).unwrap_or(false)
    }
    
    /// Get TTL remaining
    pub fn ttl(&self, key: &str) -> Option<i64> {
        self.data.get(key).and_then(|e| {
            e.expires_at.map(|exp| exp as i64 - current_timestamp() as i64)
        })
    }
    
    /// Evict LRU entry
    fn evict_lru(&mut self) {
        if let Some((key, _)) = self.data.iter()
            .min_by_key(|(_, e)| e.hits.load(Ordering::Relaxed))
            .map(|(k, v)| (k.clone(), v))
        {
            self.data.remove(&key);
            self.evictions.fetch_add(1, Ordering::Relaxed);
        }
    }
    
    /// Cleanup expired entries
    pub fn cleanup(&mut self) {
        self.data.retain(|_, e| !e.is_expired());
    }
    
    /// Get stats
    pub fn stats(&self) -> CacheStats {
        CacheStats {
            size: self.data.len(),
            hits: self.hits_total.load(Ordering::Relaxed),
            misses: self.misses_total.load(Ordering::Relaxed),
            evictions: self.evictions.load(Ordering::Relaxed),
        }
    }
    
    /// Clear all
    pub fn clear(&mut self) {
        self.data.clear();
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub size: usize,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

impl CacheStats {
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 { 0.0 } else { self.hits as f64 / total as f64 }
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_cache() {
        let mut cache = DistributedCache::new(100);
        cache.set("key1".to_string(), "value1".to_string(), None);
        
        assert_eq!(cache.get("key1"), Some("value1".to_string()));
        assert_eq!(cache.get("nonexistent"), None);
    }
    
    #[test]
    fn test_stats() {
        let mut cache = DistributedCache::new(100);
        cache.set("key1".to_string(), "value1".to_string(), None);
        cache.get("key1");
        cache.get("missing");
        
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);
    }
}