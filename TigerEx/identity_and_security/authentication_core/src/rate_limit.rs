//! Rate limiting for authentication endpoints.
//!
//! A token bucket per key (client IP, API key, user id) bounds bursts while
//! allowing a steady refill rate. The bucket is exact — it refills by the
//! elapsed time since the last check rather than in whole seconds — so a burst
//! cannot slip through by arriving just after a truncated refill tick.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// A single token bucket.
#[derive(Debug)]
pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    refill_per_sec: f64,
    last_refill: Instant,
}

impl TokenBucket {
    pub fn new(capacity: u64, refill_per_sec: f64) -> Self {
        Self {
            capacity: capacity as f64,
            tokens: capacity as f64,
            refill_per_sec,
            last_refill: Instant::now(),
        }
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last_refill).as_secs_f64();
        if elapsed > 0.0 {
            self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
            self.last_refill = now;
        }
    }

    /// Attempt to consume one token. Returns `true` if allowed.
    pub fn try_consume(&mut self) -> bool {
        self.try_consume_n(1.0)
    }

    /// Attempt to consume `n` tokens at once.
    pub fn try_consume_n(&mut self, n: f64) -> bool {
        let now = Instant::now();
        self.refill(now);
        if self.tokens >= n {
            self.tokens -= n;
            true
        } else {
            false
        }
    }

    /// Seconds until `n` tokens are available (0 if already available).
    pub fn retry_after_secs(&mut self, n: f64) -> f64 {
        let now = Instant::now();
        self.refill(now);
        if self.tokens >= n {
            0.0
        } else {
            (n - self.tokens) / self.refill_per_sec
        }
    }
}

/// Per-key rate limiter with idle eviction.
pub struct RateLimiter {
    capacity: u64,
    refill_per_sec: f64,
    buckets: HashMap<String, TokenBucket>,
    /// A bucket idle for longer than this is dropped to bound memory.
    idle_ttl: Duration,
    last_seen: HashMap<String, Instant>,
}

impl RateLimiter {
    pub fn new(capacity: u64, refill_per_sec: f64) -> Self {
        Self {
            capacity,
            refill_per_sec,
            buckets: HashMap::new(),
            idle_ttl: Duration::from_secs(600),
            last_seen: HashMap::new(),
        }
    }

    /// Check and consume one token for `key`.
    pub fn check(&mut self, key: &str) -> bool {
        self.check_n(key, 1.0)
    }

    /// Check and consume `n` tokens for `key`.
    pub fn check_n(&mut self, key: &str, n: f64) -> bool {
        let now = Instant::now();
        self.last_seen.insert(key.to_string(), now);
        let capacity = self.capacity;
        let refill = self.refill_per_sec;
        let bucket = self
            .buckets
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(capacity, refill));
        bucket.try_consume_n(n)
    }

    /// Evict buckets that have not been touched within the idle TTL.
    pub fn evict_idle(&mut self) {
        let now = Instant::now();
        let ttl = self.idle_ttl;
        self.last_seen.retain(|_, seen| now.saturating_duration_since(*seen) < ttl);
        let live: std::collections::HashSet<String> = self.last_seen.keys().cloned().collect();
        self.buckets.retain(|k, _| live.contains(k));
    }

    pub fn tracked_keys(&self) -> usize {
        self.buckets.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_capacity_then_blocks() {
        let mut limiter = RateLimiter::new(3, 1.0);
        assert!(limiter.check("ip"));
        assert!(limiter.check("ip"));
        assert!(limiter.check("ip"));
        assert!(!limiter.check("ip"));
    }

    #[test]
    fn keys_are_independent() {
        let mut limiter = RateLimiter::new(1, 1.0);
        assert!(limiter.check("a"));
        assert!(limiter.check("b"));
        assert!(!limiter.check("a"));
    }

    #[test]
    fn bucket_refills_over_time() {
        let mut bucket = TokenBucket::new(1, 100.0); // refills fast
        assert!(bucket.try_consume());
        assert!(!bucket.try_consume());
        std::thread::sleep(Duration::from_millis(50));
        assert!(bucket.try_consume());
    }

    #[test]
    fn weighted_consume_requires_enough_tokens() {
        let mut bucket = TokenBucket::new(10, 0.0);
        assert!(bucket.try_consume_n(4.0));
        assert!(!bucket.try_consume_n(7.0));
        assert!(bucket.try_consume_n(6.0));
    }

    #[test]
    fn retry_after_reports_wait() {
        let mut bucket = TokenBucket::new(1, 1.0);
        assert!(bucket.try_consume());
        let wait = bucket.retry_after_secs(1.0);
        assert!(wait > 0.0 && wait <= 1.0);
    }
}
