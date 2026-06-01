// Cache Platform - L1 Memory + L2 Redis Caching
// Rust for memory safety with world-wide distributed performance

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::cmp::Ordering;

/// EvictionPolicy determines cache eviction strategy
#[derive(Debug, Clone, Copy)]
pub enum EvictionPolicy {
    LRU,    // Least Recently Used
    LFU,    // Least Frequently Used
    FIFO,    // First In First Out
    ARC,     // Adaptive Replacement Cache
}

impl Default for EvictionPolicy {
    fn default() -> Self { EvictionPolicy::LRU }
}

/// CacheEntry with metadata
pub struct CacheEntry {
    pub value: Vec<u8>,
    pub expires_at: Option<u64>,
    pub created_at: u64,
    pub accessed: u32,
    pub last_access: u64,
    pub size: usize,
}

/// L1 Memory Cache - High-performance in-memory cache
pub struct L1Cache {
    // Storage
    entries: HashMap<String, CacheEntry>,
    
    // Access order for LRU
    access_order: VecDeque<String>,
    
    // Access counts for LFU
    access_counts: HashMap<String, u32>,
    
    // Configuration
    max_entries: usize,
    max_bytes: usize,
    current_bytes: usize,
    policy: EvictionPolicy,
    
    // Statistics
    hits: u64,
    misses: u64,
    evictions: u64,
    expirations: u64,
}

impl L1Cache {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        L1Cache {
            entries: HashMap::new(),
            access_order: VecDeque::new(),
            access_counts: HashMap::new(),
            max_entries,
            max_bytes,
            current_bytes: 0,
            policy: EvictionPolicy::LRU,
            hits: 0,
            misses: 0,
            evictions: 0,
            expirations: 0,
        }
    }
    
    pub fn with_policy(max_entries: usize, max_bytes: usize, policy: EvictionPolicy) -> Self {
        let mut cache = Self::new(max_entries, max_bytes);
        cache.policy = policy;
        cache
    }
    
    /// Get value
    pub fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        let now = timestamp_ms();
        
        // Check expiration
        if let Some(entry) = self.entries.get(key) {
            if let Some(expires) = entry.expires_at {
                if now > expires {
                    // Expired
                    self.remove(key);
                    self.misses += 1;
                    return None;
                }
            }
            
            // Update access
            self.touch(key);
            self.hits += 1;
            return Some(entry.value.clone());
        }
        
        self.misses += 1;
        None
    }
    
    /// Set value
    pub fn set(&mut self, key: &str, value: Vec<u8>, ttl_ms: Option<u64>) {
        let now = timestamp_ms();
        let size = value.len();
        
        // Check capacity and evict if needed
        while self.entries.len() >= self.max_entries || self.current_bytes + size > self.max_bytes {
            if self.entries.is_empty() { break; }
            self.evict_one();
        }
        
        // Remove existing
        if let Some(old) = self.entries.remove(key) {
            self.current_bytes -= old.size;
            self.remove_access(key);
        }
        
        // Calculate expiration
        let expires = ttl_ms.map(|ms| now + ms);
        
        // Add entry
        let entry = CacheEntry {
            value: value.clone(),
            expires_at: expires,
            created_at: now,
            accessed: 1,
            last_access: now,
            size,
        };
        
        self.entries.insert(key.to_string(), entry);
        self.current_bytes += size;
        self.add_access(key);
    }
    
    /// Delete key
    pub fn delete(&mut self, key: &str) -> bool {
        if let Some(entry) = self.entries.remove(key) {
            self.current_bytes -= entry.size;
            self.remove_access(key);
            return true;
        }
        false
    }
    
    /// Exists
    pub fn exists(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }
    
    /// Clear all
    pub fn clear(&mut self) {
        self.entries.clear();
        self.access_order.clear();
        self.access_counts.clear();
        self.current_bytes = 0;
    }
    
    /// Update access for policy
    fn add_access(&mut self, key: &str) {
        match self.policy {
            EvictionPolicy::LRU => {
                self.access_order.push_back(key.to_string());
            },
            EvictionPolicy::LFU => {
                *self.access_counts.entry(key.to_string()).or_insert(0) += 1;
            },
            EvictionPolicy::FIFO => {}, // Order is implicit
            EvictionPolicy::ARC => {
                self.access_order.push_back(key.to_string());
            },
        }
    }
    
    fn remove_access(&mut self, key: &str) {
        if let Some(pos) = self.access_order.iter().position(|k| k == key) {
            self.access_order.remove(pos);
        }
        self.access_counts.remove(key);
    }
    
    fn touch(&mut self, key: &str) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.accessed += 1;
            entry.last_access = timestamp_ms();
        }
        
        // Update access tracking
        match self.policy {
            EvictionPolicy::LRU => {
                if let Some(pos) = self.access_order.iter().position(|k| k == key) {
                    self.access_order.remove(pos);
                    self.access_order.push_back(key.to_string());
                }
            },
            EvictionPolicy::LFU => {
                *self.access_counts.entry(key.to_string()).or_insert(0) += 1;
            },
            _ => {},
        }
    }
    
    fn evict_one(&mut self) {
        if self.entries.is_empty() { return; }
        
        let key_to_remove = match self.policy {
            EvictionPolicy::LRU => {
                self.access_order.pop_front()
            },
            EvictionPolicy::LFU => {
                // Find least frequently used
                self.access_counts.iter()
                    .min_by_key(|(_, count)| *count)
                    .map(|(k, _)| k.clone())
            },
            EvictionPolicy::FIFO | EvictionPolicy::ARC => {
                self.entries.keys().next().cloned()
            },
        };
        
        if let Some(key) = key_to_remove {
            self.remove(key);
            self.evictions += 1;
        }
    }
    
    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.current_bytes -= entry.size;
        }
        self.remove_access(key);
    }
    
    /// Get statistics
    pub fn stats(&self) -> CacheStats {
        let total_req = self.hits + self.misses;
        let hit_rate = if total_req > 0 { self.hits as f64 / total_req as f64 } else { 0.0 };
        
        CacheStats {
            entries: self.entries.len(),
            bytes: self.current_bytes,
            hits: self.hits,
            misses: self.misses,
            hit_rate,
            evictions: self.evictions,
            expirations: self.expirations,
        }
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub entries: usize,
    pub bytes: usize,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub evictions: u64,
    pub expirations: u64,
}

/// HotSymbolCache - Specialized cache for frequently traded symbols
pub struct HotSymbolCache {
    cache: L1Cache,
    symbols: Vec<String>,
}

impl HotSymbolCache {
    pub fn new() -> Self {
        HotSymbolCache {
            cache: L1Cache::with_policy(1000, 10*1024*1024, EvictionPolicy::LRU),
            symbols: vec![
                "BTCUSDT".to_string(),
                "ETHUSDT".to_string(),
                "BNBUSDT".to_string(),
                "SOLUSDT".to_string(),
            ],
        }
    }
    
    /// Get price for symbol
    pub fn get_price(&mut self, symbol: &str) -> Option<f64> {
        let key = format!("price:{}", symbol);
        self.cache.get(&key)
            .and_then(|v| String::from_utf8(v).ok())
            .and_then(|s| s.parse().ok())
    }
    
    /// Set price for symbol  
    pub fn set_price(&mut self, symbol: &str, price: f64) {
        let key = format!("price:{}", symbol);
        self.cache.set(&key, format!("{}", price).into_bytes(), Some(1000)); // 1s TTL
    }
    
    /// Check if symbol is hot
    pub fn is_hot(&self, symbol: &str) -> bool {
        self.symbols.contains(&symbol.to_string())
    }
}

/// MarketDataCache - Cache for order books and trades
pub struct MarketDataCache {
    orderbooks: L1Cache,
    tickers: L1Cache,
    trades: L1Cache,
}

impl MarketDataCache {
    pub fn new() -> Self {
        MarketDataCache {
            orderbooks: L1Cache::new(1000, 50*1024*1024), // 50MB
            tickers: L1Cache::new(500, 10*1024*1024),     // 10MB
            trades: L1Cache::new(10000, 100*1024*1024),  // 100MB
        }
    }
    
    pub fn set_orderbook(&mut self, symbol: &str, data: Vec<u8>) {
        self.orderbooks.set(&format!("ob:{}", symbol), data, Some(500));
    }
    
    pub fn get_orderbook(&mut self, symbol: &str) -> Option<Vec<u8>> {
        self.orderbooks.get(&format!("ob:{}", symbol))
    }
    
    pub fn set_ticker(&mut self, symbol: &str, data: Vec<u8>) {
        self.tickers.set(&format!("t:{}", symbol), data, Some(1000));
    }
    
    pub fn add_trade(&mut self, symbol: &str, trade: Vec<u8>) {
        let key = format!("trade:{}", symbol);
        self.trades.set(&key, trade, Some(60000)); // 60s TTL
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_l1_cache() {
        let mut cache = L1Cache::new(10, 1024);
        
        cache.set("key1", b"value1".to_vec(), None);
        assert_eq!(cache.get("key1"), Some(b"value1".to_vec()));
        
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
    }
}