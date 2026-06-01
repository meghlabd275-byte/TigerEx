// Cache Core - Hybrid Rust + Go
// L1 memory cache in Rust for hot data

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cache entry
pub struct Entry {
    pub value: Vec<u8>,
    pub expires_at: Option<u64>,
    pub created_at: u64,
    pub accessed: u32,
}

/// L1 Cache - In-memory
pub struct Cache {
    entries: HashMap<String, Entry>,
    access_order: VecDeque<String>,
    max_entries: usize,
    max_bytes: usize,
    current_bytes: usize,
    hits: u64,
    misses: u64,
}

impl Cache {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Cache {
            entries: HashMap::new(),
            access_order: VecDeque::new(),
            max_entries,
            max_bytes,
            current_bytes: 0,
            hits: 0,
            misses: 0,
        }
    }
    
    pub fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        let now = timestamp_ms();
        
        if let Some(entry) = self.entries.get(key) {
            if let Some(expires) = entry.expires_at {
                if now > expires {
                    self.remove(key);
                    self.misses += 1;
                    return None;
                }
            }
            
            // Update LRU
            self.touch(key);
            self.hits += 1;
            return Some(entry.value.clone());
        }
        
        self.misses += 1;
        None
    }
    
    pub fn set(&mut self, key: &str, value: Vec<u8>, ttl_ms: Option<u64>) {
        let now = timestamp_ms();
        let size = value.len();
        
        // Evict if needed
        while self.entries.len() >= self.max_entries || self.current_bytes + size > self.max_bytes {
            if self.entries.is_empty() { break; }
            self.evict();
        }
        
        // Remove old
        if let Some(old) = self.entries.remove(key) {
            self.current_bytes -= old.value.len();
            self.remove_access(key);
        }
        
        // Add new
        let entry = Entry {
            value: value.clone(),
            expires_at: ttl_ms.map(|ms| now + ms),
            created_at: now,
            accessed: 1,
        };
        
        self.entries.insert(key.to_string(), entry);
        self.current_bytes += size;
        self.access_order.push_back(key.to_string());
    }
    
    pub fn delete(&mut self, key: &str) -> bool {
        if let Some(entry) = self.entries.remove(key) {
            self.current_bytes -= entry.value.len();
            self.remove_access(key);
            return true;
        }
        false
    }
    
    pub fn exists(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }
    
    pub fn clear(&mut self) {
        self.entries.clear();
        self.access_order.clear();
        self.current_bytes = 0;
    }
    
    pub fn stats(&self) -> CacheStats {
        let total = self.hits + self.misses;
        let hit_rate = if total > 0 { self.hits as f64 / total as f64 } else { 0.0 };
        
        CacheStats {
            entries: self.entries.len(),
            bytes: self.current_bytes,
            hits: self.hits,
            misses: self.misses,
            hit_rate,
        }
    }
    
    fn touch(&mut self, key: &str) {
        if let Some(pos) = self.access_order.iter().position(|k| k == key) {
            self.access_order.remove(pos);
            self.access_order.push_back(key.to_string());
        }
        
        if let Some(e) = self.entries.get_mut(key) {
            e.accessed += 1;
        }
    }
    
    fn remove_access(&mut self, key: &str) {
        if let Some(pos) = self.access_order.iter().position(|k| k == key) {
            self.access_order.remove(pos);
        }
    }
    
    fn evict(&mut self) {
        if let Some(key) = self.access_order.pop_front() {
            self.remove(&key);
        }
    }
    
    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.current_bytes -= entry.value.len();
        }
        self.remove_access(key);
    }
}

#[derive(Debug)]
pub struct CacheStats {
    pub entries: usize,
    pub bytes: usize,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_cache() {
        let mut cache = Cache::new(100, 1024*1024);
        
        cache.set("key1", b"value1".to_vec(), None);
        assert!(cache.get("key1").is_some());
        
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
    }
}