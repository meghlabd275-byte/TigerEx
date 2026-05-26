// KV Store - Distributed Key-Value Store
// Rus for distributed caching and coordination

use std::collections::HashMap;

// Value with metadata
#[derive(Debug, Clone)]
pub struct KVValue {
    pub value: Vec<u8>,
    pub version: u64,
    pub expires_at: i64,
    pub created_at: i64,
}

// Put options
#[derive(Debug, Clone)]
pub struct PutOptions {
    pub ttl_ms: i64,
    pub only_if_not_exists: bool,
    pub cas: u64, // compare-and-swap
}

// Get options
#[derive(Debug, Clone)]
pub struct GetOptions {
    pub consistent: bool,
    pub use_cache: bool,
}

// KV Store
pub struct KVStore {
    data: HashMap<String, KVValue>,
    watcher: HashMap<String, Vec<String>>,
}

impl KVStore {
    pub fn new() -> Self {
        KVStore {
            data: HashMap::new(),
            watcher: HashMap::new(),
        }
    }

    // Put value
    pub fn put(&mut self, key: &str, value: Vec<u8>, opts: PutOptions) -> Result<u64, String> {
        // Check if exists
        if opts.only_if_not_exists {
            if self.data.contains_key(key) {
                return Err("key already exists".to_string());
            }
        }

        // CAS check
        if opts.cas > 0 {
            if let Some(existing) = self.data.get(key) {
                if existing.version != opts.cas {
                    return Err("CAS failed".to_string());
                }
            }
        }

        let version = self.data.get(key).map(|v| v.version + 1).unwrap_or(1);

        let kv_value = KVValue {
            value,
            version,
            expires_at: if opts.ttl_ms > 0 { now_ms() + opts.ttl_ms } else { 0 },
            created_at: now_ms(),
        };

        self.data.insert(key.to_string(), kv_value);

        // Notify watchers
        self.notify_watchers(key);

        Ok(version)
    }

    // Get value
    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        if let Some(kv) = self.data.get(key) {
            // Check TTL
            if kv.expires_at > 0 && now_ms() > kv.expires_at {
                return None;
            }
            return Some(kv.value.clone());
        }
        None
    }

    // Delete value
    pub fn delete(&mut self, key: &str) -> bool {
        self.data.remove(key).is_some()
    }

    // Check exists
    pub fn exists(&self, key: &str) -> bool {
        self.data.contains_key(key)
    }

    // Get version
    pub fn version(&self, key: &str) -> Option<u64> {
        self.data.get(key).map(|v| v.version)
    }

    // Watch key
    pub fn watch(&mut self, key: &str>, callback: String) {
        let watchers = self.watcher.entry(key.to_string()).or_insert_with(Vec::new);
        watchers.push(callback);
    }

    // Notify watchers
    fn notify_watchers(&self, key: &str) {
        if let Some(watchers) = self.watcher.get(key) {
            for _ in watchers {
                // In real impl: call callbacks
            }
        }
    }

    // Get keys with prefix
    pub fn keys(&self, prefix: &str) -> Vec<String> {
        self.data
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect()
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
    fn test_kv() {
        let mut store = KVStore::new();

        let opts = PutOptions { ttl_ms: 0, only_if_not_exists: false, cas: 0 };
        store.put("key1", b"value1", opts).unwrap();

        let val = store.get("key1");
        assert!(val.is_some());
    }
}