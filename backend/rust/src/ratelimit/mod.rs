// Rate Limiter - Advanced Rate Limiting
// Rust for distributed rate limiting

use std::collections::HashMap;

// Rate limit rule
#[derive(Debug, Clone)]
pub struct RateLimitRule {
    pub key: String,
    pub limit: u32,
    pub window_ms: i64,
    pub burst: u32,
}

// Token bucket state
#[derive(Debug, Clone)]
pub struct TokenBucketState {
    pub tokens: f64,
    pub last_refill: i64,
}

// Rate limiter
pub struct RateLimiter {
    rules: HashMap<String, RateLimitRule>,
    buckets: HashMap<String, TokenBucketState>,
}

impl RateLimiter {
    pub fn new() -> Self {
        let rules = vec![
            RateLimitRule {
                key: "api".to_string(),
                limit: 1200,
                window_ms: 60000,
                burst: 100,
            },
            RateLimitRule {
                key: "order".to_string(),
                limit: 120,
                window_ms: 60000,
                burst: 20,
            },
            RateLimitRule {
                key: "withdraw".to_string(),
                limit: 5,
                window_ms: 86400000,
                burst: 1,
            },
        ];

        let mut r = RateLimiter {
            rules: HashMap::new(),
            buckets: HashMap::new(),
        };

        for rule in rules {
            r.buckets.insert(rule.key.clone(), TokenBucketState {
                tokens: rule.burst as f64,
                last_refill: now_ms(),
            });
            r.rules.insert(rule.key.clone(), rule);
        }

        r
    }

    // Check limit
    pub fn check(&mut self, key: &str) -> Result<u32, String> {
        let rule = self.rules.get(key)
            .ok_or("rule not found")?;

        let bucket = self.buckets.get_mut(key).unwrap();

        // Refill tokens
        let now = now_ms();
        let elapsed = now - bucket.last_refill;

        let refill = (elapsed as f64 / rule.window_ms as f64) * rule.limit as f64;
        bucket.tokens = (bucket.tokens + refill).min(rule.burst as f64);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            return Ok((bucket.tokens as u32));
        }

        let wait_ms = ((1.0 - bucket.tokens) / (rule.limit as f64 / rule.window_ms as f64)) as i64;
        Err(format!("rate limited, wait {}ms", wait_ms))
    }

    // Get remaining
    pub fn remaining(&self, key: &str) -> u32 {
        if let Some(bucket) = self.buckets.get(key) {
            return bucket.tokens as u32;
        }
        0
    }

    // Add custom rule
    pub fn add_rule(&mut self, key: &str, limit: u32, window_ms: i64, burst: u32) {
        let rule = RateLimitRule {
            key: key.to_string(),
            limit,
            window_ms,
            burst,
        };

        self.rules.insert(key.to_string(), rule.clone());
        self.buckets.insert(key.to_string(), TokenBucketState {
            tokens: burst as f64,
            last_refill: now_ms(),
        });
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
    fn test_ratelimit() {
        let mut rl = RateLimiter::new();

        let result = rl.check("api");
        assert!(result.is_ok());
    }
}