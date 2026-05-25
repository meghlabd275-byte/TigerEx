//! Security module for TigerEx
//! 
//! Key management, rate limiting, DDOS protection

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Key management service
pub struct KeyManager {
    master_keys: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl KeyManager {
    pub fn new() -> Self {
        Self {
            master_keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Generate new API key
    pub async fn generate_api_key(&self, user_id: &str, permissions: Vec<&str>) -> String {
        let key = format!("tkx_{}_{}", user_id, uuid::Uuid::new_v4());
        let mut keys = self.master_keys.write().await;
        keys.insert(key.clone(), permissions.join(",").as_bytes().to_vec());
        key
    }

    /// Validate API key
    pub async fn validate_api_key(&self, key: &str) -> Option<Vec<String>> {
        let keys = self.master_keys.read().await;
        keys.get(key).map(|v| {
            String::from_utf8_lossy(v).split(',')
                .map(|s| s.to_string()).collect()
        })
    }

    /// Revoke API key
    pub async fn revoke_api_key(&self, key: &str) -> bool {
        let mut keys = self.master_keys.write().await;
        keys.remove(key).is_some()
    }
}

impl Default for KeyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Rate limiter using token bucket algorithm
pub struct RateLimiter {
    tokens: Arc<RwLock<HashMap<String, TokenBucket>>>,
    max_requests: u32,
    window_secs: u64,
}

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: i64,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            tokens: Arc::new(RwLock::new(HashMap::new())),
            max_requests,
            window_secs,
        }
    }

    /// Check if request is allowed
    pub async fn check(&self, key: &str) -> bool {
        let now = chrono::Utc::now().timestamp();
        
        let mut buckets = self.tokens.write().await;
        let bucket = buckets.entry(key.to_string()).or_insert(TokenBucket {
            tokens: self.max_requests as f64,
            max_tokens: self.max_requests as f64,
            refill_rate: self.max_requests as f64 / self.window_secs as f64,
            last_refill: now,
        });

        // Refill tokens
        let elapsed = now - bucket.last_refill;
        if elapsed > 0 {
            let refill = (elapsed as f64 * bucket.refill_rate).min(bucket.max_tokens);
            bucket.tokens = (bucket.tokens + refill).min(bucket.max_tokens);
            bucket.last_refill = now;
        }

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Get remaining requests
    pub async fn remaining(&self, key: &str) -> u32 {
        let buckets = self.tokens.read().await;
        buckets.get(key).map(|b| b.tokens as u32).unwrap_or(self.max_requests)
    }
}

/// IP blacklist/whitelist
pub struct IPLimiter {
    allowed: Arc<RwLock<Vec<String>>>,
    blocked: Arc<RwLock<Vec<String>>>,
}

impl IPLimiter {
    pub fn new() -> Self {
        Self {
            allowed: Arc::new(RwLock::new(Vec::new())),
            blocked: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn allow_ip(&self, ip: &str) {
        let mut allowed = self.allowed.write().await;
        if !allowed.contains(&ip.to_string()) {
            allowed.push(ip.to_string());
        }
    }

    pub async fn block_ip(&self, ip: &str) {
        let mut blocked = self.blocked.write().await;
        if !blocked.contains(&ip.to_string()) {
            blocked.push(ip.to_string());
        }
    }

    pub async fn is_allowed(&self, ip: &str) -> bool {
        let allowed = self.allowed.read().await;
        let blocked = self.blocked.read().await;
        
        if blocked.contains(&ip.to_string()) {
            return false;
        }
        if allowed.is_empty() {
            return true;
        }
        allowed.contains(&ip.to_string())
    }
}

impl Default for IPLimiter {
    fn default() -> Self {
        Self::new()
    }
}