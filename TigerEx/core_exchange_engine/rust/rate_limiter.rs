//! TigerEx Rate Limiter - Rust Implementation
//! 
//! High-performance rate limiting using lock-free token bucket algorithm
//! Supports per-user, per-IP, and per-endpoint limiting
//! 
//! Migration from Go to Rust for deterministic rate limiting

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Rate limit scope
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RateLimitScope {
    Global,
    User,
    IP,
    Endpoint,
}

/// Rate limit action
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitAction {
    Allow,
    RateLimited,
    Throttled,
}

/// Rate limit configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub scope: RateLimitScope,
    pub requests_per_window: u64,
    pub window_ms: u64,
    pub burst_size: u64,
    pub block_duration_ms: u64,
}

impl RateLimitConfig {
    pub fn new(scope: RateLimitScope, requests_per_window: u64, window_ms: u64) -> Self {
        RateLimitConfig {
            scope,
            requests_per_window,
            window_ms,
            burst_size: requests_per_window,
            block_duration_ms: 0,
        }
    }
    
    pub fn with_burst(mut self, burst: u64) -> Self {
        self.burst_size = burst;
        self
    }
    
    pub fn with_block(mut self, duration_ms: u64) -> Self {
        self.block_duration_ms = duration_ms;
        self
    }
}

/// Token bucket state
#[derive(Debug)]
pub struct TokenBucket {
    tokens: AtomicU64,
    last_update: AtomicU64,
    capacity: u64,
    refill_rate: u64, // tokens per ms
}

impl TokenBucket {
    pub fn new(capacity: u64, refill_rate: u64) -> Self {
        let now = current_timestamp_ms();
        TokenBucket {
            tokens: AtomicU64::new(capacity),
            last_update: AtomicU64::new(now),
            capacity,
            refill_rate,
        }
    }
    
    /// Try to consume tokens, returns true if allowed
    pub fn try_consume(&self, tokens: u64) -> bool {
        loop {
            let now = current_timestamp_ms();
            let last = self.last_update.load(Ordering::Acquire);
            let current = self.tokens.load(Ordering::Acquire);
            
            // Calculate refill
            let elapsed = now.saturating_sub(last);
            let refill = (elapsed * self.refill_rate) / 1000;
            let new_tokens = (current + refill).min(self.capacity);
            
            if new_tokens < tokens {
                return false;
            }
            
            // Try to update
            if self.tokens.compare_exchange(current, new_tokens - tokens, Ordering::Release, Ordering::Acquire).is_ok() {
                self.last_update.store(now, Ordering::Release);
                return true;
            }
            // Retry on conflict
        }
    }
    
    /// Get current tokens
    pub fn available(&self) -> u64 {
        let now = current_timestamp_ms();
        let last = self.last_update.load(Ordering::Acquire);
        let current = self.tokens.load(Ordering::Acquire);
        
        let elapsed = now.saturating_sub(last);
        let refill = (elapsed * self.refill_rate) / 1000;
        (current + refill).min(self.capacity)
    }
}

/// Sliding window counter
#[derive(Debug)]
pub struct SlidingWindow {
    requests: VecDeque<u64>,
    max_requests: usize,
    window_ms: u64,
}

impl SlidingWindow {
    pub fn new(max_requests: usize, window_ms: u64) -> Self {
        SlidingWindow {
            requests: VecDeque::with_capacity(max_requests),
            max_requests,
            window_ms,
        }
    }
    
    pub fn try_acquire(&mut self) -> bool {
        let now = current_timestamp_ms();
        let window_start = now.saturating_sub(self.window_ms);
        
        // Remove old requests
        while let Some(&ts) = self.requests.front() {
            if ts > window_start {
                break;
            }
            self.requests.pop_front();
        }
        
        // Check limit
        if self.requests.len() >= self.max_requests {
            return false;
        }
        
        self.requests.push_back(now);
        true
    }
    
    pub fn current_count(&self) -> usize {
        let now = current_timestamp_ms();
        let window_start = now.saturating_sub(self.window_ms);
        
        self.requests.iter().filter(|&&ts| ts > window_start).count()
    }
}

/// User rate limit entry
#[derive(Debug)]
pub struct UserRateLimit {
    bucket: TokenBucket,
    request_count: AtomicU64,
    blocked_until: AtomicU64,
    config: RateLimitConfig,
}

impl UserRateLimit {
    pub fn new(config: &RateLimitConfig) -> Self {
        let refill_rate = config.requests_per_window * 1000 / config.window_ms.max(1);
        
        UserRateLimit {
            bucket: TokenBucket::new(config.burst_size, refill_rate),
            request_count: AtomicU64::new(0),
            blocked_until: AtomicU64::new(0),
            config: config.clone(),
        }
    }
    
    pub fn check(&self) -> RateLimitAction {
        let now = current_timestamp_ms();
        
        // Check if blocked
        let blocked = self.blocked_until.load(Ordering::Acquire);
        if blocked > now {
            return RateLimitAction::RateLimited;
        }
        
        // Try to consume
        if self.bucket.try_consume(1) {
            self.request_count.fetch_add(1, Ordering::Relaxed);
            RateLimitAction::Allow
        } else {
            // Block if configured
            if self.config.block_duration_ms > 0 {
                let blocked_until = now + self.config.block_duration_ms;
                self.blocked_until.store(blocked_until, Ordering::Release);
            }
            RateLimitAction::Throttled
        }
    }
    
    pub fn reset_block(&self) {
        self.blocked_until.store(0, Ordering::Release);
    }
}

/// Rate limiter engine
pub struct RateLimiter {
    global_limit: TokenBucket,
    user_limits: HashMap<String, UserRateLimit>,
    ip_limits: HashMap<String, UserRateLimit>,
    endpoint_limits: HashMap<String, UserRateLimit>,
    stats: RateLimiterStats,
    config: RateLimiterConfig,
}

#[derive(Debug, Clone)]
pub struct RateLimiterConfig {
    pub global_requests_per_second: u64,
    pub global_burst: u64,
    pub user_requests_per_minute: u64,
    pub ip_requests_per_minute: u64,
    pub endpoint_requests_per_second: u64,
}

impl Default for RateLimiterConfig {
    fn default() -> Self {
        RateLimiterConfig {
            global_requests_per_second: 100000,
            global_burst: 200000,
            user_requests_per_minute: 6000,
            ip_requests_per_minute: 10000,
            endpoint_requests_per_second: 1000,
        }
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::with_config(RateLimiterConfig::default())
    }
    
    pub fn with_config(config: RateLimiterConfig) -> Self {
        let global_bucket = TokenBucket::new(
            config.global_burst,
            config.global_requests_per_second,
        );
        
        RateLimiter {
            global_limit: global_bucket,
            user_limits: HashMap::new(),
            ip_limits: HashMap::new(),
            endpoint_limits: HashMap::new(),
            stats: RateLimiterStats::new(),
            config,
        }
    }
    
    /// Check rate limit for a request
    pub fn check(&mut self, user_id: Option<&str>, ip: Option<&str>, endpoint: &str) -> RateLimitAction {
        // Check global first
        if !self.global_limit.try_consume(1) {
            self.stats.global_rejected.fetch_add(1, Ordering::Relaxed);
            return RateLimitAction::RateLimited;
        }
        
        // Check user limit
        if let Some(uid) = user_id {
            let user_limit = self.user_limits.entry(uid.to_string())
                .or_insert_with(|| {
                    let config = RateLimitConfig::new(
                        RateLimitScope::User,
                        self.config.user_requests_per_minute,
                        60000,
                    );
                    UserRateLimit::new(&config)
                });
            
            let action = user_limit.check();
            if action != RateLimitAction::Allow {
                self.stats.user_rejected.fetch_add(1, Ordering::Relaxed);
                return action;
            }
        }
        
        // Check IP limit
        if let Some(client_ip) = ip {
            let ip_limit = self.ip_limits.entry(client_ip.to_string())
                .or_insert_with(|| {
                    let config = RateLimitConfig::new(
                        RateLimitScope::IP,
                        self.config.ip_requests_per_minute,
                        60000,
                    );
                    UserRateLimit::new(&config)
                });
            
            let action = ip_limit.check();
            if action != RateLimitAction::Allow {
                self.stats.ip_rejected.fetch_add(1, Ordering::Relaxed);
                return action;
            }
        }
        
        // Check endpoint limit
        let endpoint_limit = self.endpoint_limits.entry(endpoint.to_string())
            .or_insert_with(|| {
                let config = RateLimitConfig::new(
                    RateLimitScope::Endpoint,
                    self.config.endpoint_requests_per_second,
                    1000,
                );
                UserRateLimit::new(&config)
            });
        
        let action = endpoint_limit.check();
        if action != RateLimitAction::Allow {
            self.stats.endpoint_rejected.fetch_add(1, Ordering::Relaxed);
            return action;
        }
        
        self.stats.total_allowed.fetch_add(1, Ordering::Relaxed);
        RateLimitAction::Allow
    }
    
    /// Get statistics
    pub fn stats(&self) -> RateLimiterStats {
        RateLimiterStats {
            total_allowed: self.stats.total_allowed.load(Ordering::Relaxed),
            global_rejected: self.stats.global_rejected.load(Ordering::Relaxed),
            user_rejected: self.stats.user_rejected.load(Ordering::Relaxed),
            ip_rejected: self.stats.ip_rejected.load(Ordering::Relaxed),
            endpoint_rejected: self.stats.endpoint_rejected.load(Ordering::Relaxed),
        }
    }
    
    /// Get current global usage
    pub fn global_usage(&self) -> u64 {
        self.global_limit.available()
    }
    
    /// Reset user limit (for testing)
    pub fn reset_user(&mut self, user_id: &str) {
        if let Some(limit) = self.user_limits.get(user_id) {
            limit.reset_block();
        }
    }
}

/// Statistics
#[derive(Debug, Clone)]
pub struct RateLimiterStats {
    pub total_allowed: u64,
    pub global_rejected: u64,
    pub user_rejected: u64,
    pub ip_rejected: u64,
    pub endpoint_rejected: u64,
}

impl RateLimiterStats {
    pub fn new() -> Self {
        RateLimiterStats {
            total_allowed: 0,
            global_rejected: 0,
            user_rejected: 0,
            ip_rejected: 0,
            endpoint_rejected: 0,
        }
    }
    
    pub fn total_rejected(&self) -> u64 {
        self.global_rejected + self.user_rejected + self.ip_rejected + self.endpoint_rejected
    }
    
    pub fn total_requests(&self) -> u64 {
        self.total_allowed + self.total_rejected()
    }
}

// Helper for optional user_id
struct UserIdRef<'a>(Option<&'a str>);
impl UserIdRef<'_> {
    fn as_str(&self) -> Option<&str> {
        self.0
    }
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_global_rate_limiting() {
        let mut limiter = RateLimiter::new();
        
        // Should allow multiple requests
        for _ in 0..100 {
            assert_eq!(limiter.check(None, None, "/api/test"), RateLimitAction::Allow);
        }
    }
    
    #[test]
    fn test_user_rate_limiting() {
        let mut limiter = RateLimiter::new();
        
        // Should allow requests for user
        for _ in 0..10 {
            assert_eq!(limiter.check(Some("user1"), None, "/api/test"), RateLimitAction::Allow);
        }
    }
    
    #[test]
    fn test_rate_limiter_stats() {
        let mut limiter = RateLimiter::new();
        
        limiter.check(Some("user1"), Some("192.168.1.1"), "/api/test").unwrap();
        let stats = limiter.stats();
        
        assert!(stats.total_allowed > 0);
    }
}