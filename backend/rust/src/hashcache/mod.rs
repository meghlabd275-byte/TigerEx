// Hash Cache - LRU Cache with Hashing
// Rust for memoization and caching

use std::collections::{HashMap, VecDeque};

// Cache entry
#[derive(Debug, Clone)]
pub struct CacheEntry<V> {
    pub key: String,
    pub value: V,
    pub hits: u32,
    pub created_at: i64,
}

// LRU cache
pub struct HashCache<K, V> {
    capacity: usize,
    cache: HashMap<K, CacheEntry<V>>,
    order: VecDeque<K>,
    hits: u64,
    misses: u64,
}

impl<K, V> HashCache<K, V>
where
    K: std::hash::Hash + Clone,
{
    pub fn new(capacity: usize) -> Self {
        HashCache {
            capacity,
            cache: HashMap::new(),
            order: VecDeque::new(),
            hits: 0,
            misses: 0,
        }
    }

    // Get value
    pub fn get(&mut self, key: &K) -> Option<&V> {
        if let Some(entry) = self.cache.get_mut(key) {
            entry.hits += 1;
            self.hits += 1;
            return Some(&entry.value);
        }

        self.misses += 1;
        None
    }

    // Put value
    pub fn put(&mut self, key: K, value: V) {
        if self.cache.len() >= self.capacity {
            // Evict LRU
            if let Some(lru_key) = self.order.pop_front() {
                self.cache.remove(&lru_key);
            }
        }

        let entry = CacheEntry {
            key: format!("{:?}", key),
            value,
            hits: 0,
            created_at: now_ms(),
        };

        self.cache.insert(key.clone(), entry);
        self.order.push_back(key);
    }

    // Check contains
    pub fn contains(&self, key: &K) -> bool {
        self.cache.contains_key(key)
    }

    // Remove
    pub fn remove(&mut self, key: &K) -> bool {
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
        }
        self.cache.remove(key).is_some()
    }

    // Clear cache
    pub fn clear(&mut self) {
        self.cache.clear();
        self.order.clear();
        self.hits = 0;
        self.misses = 0;
    }

    // Stats
    pub fn stats(&self) -> (usize, u64, u64) {
        let len = self.cache.len();
        let hit_rate = if self.hits + self.misses > 0 {
            self.hits * 100 / (self.hits + self.misses)
        } else {
            0
        };
        (len, self.hits, hit_rate)
    }

    // Len
    pub fn len(&self) -> usize {
        self.cache.len()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache() {
        let mut cache = HashCache::new(2);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        assert!(cache.contains(&"key1"));
    }
}