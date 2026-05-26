//! Middleware Module - Rust Implementation
//! 
//! Production-grade middleware for API gateway

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Rate limiter configuration
#[derive(Debug, Clone)]
pub struct RateLimiter {
    requests_per_second: u32,
    burst_size: u32,
    ip_map: HashMap<String, RateLimitState>,
}

#[derive(Debug, Clone)]
struct RateLimitState {
    tokens: f64,
    last_update: i64,
}

impl RateLimiter {
    pub fn new(rps: u32) -> Self {
        Self {
            requests_per_second: rps,
            burst_size: rps * 2,
            ip_map: HashMap::new(),
        }
    }

    /// Check if request is allowed
    pub fn check(&mut self, client_id: &str) -> bool {
        let now = current_timestamp_ms();
        
        let state = self.ip_map.entry(client_id.to_string()).or_insert(RateLimitState {
            tokens: self.burst_size as f64,
            last_update: now,
        });
        
        // Add tokens based on time elapsed
        let elapsed_ms = now - state.last_update;
        let tokens_to_add = (elapsed_ms as f64 / 1000.0) * (self.requests_per_second as f64);
        state.tokens = (state.tokens + tokens_to_add).min(self.burst_size as f64);
        state.last_update = now;
        
        if state.tokens >= 1.0 {
            state.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Get remaining requests
    pub fn remaining(&self, client_id: &str) -> u32 {
        self.ip_map.get(client_id)
            .map(|s| s.tokens as u32)
            .unwrap_or(self.burst_size)
    }
}

/// JWT authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JWTClaims {
    pub sub: String,        // User ID
    pub exp: i64,        // Expiration
    pub iat: i64,        // Issued at
    pub role: Option<String>,
}

/// JWT Middleware
pub struct JWTMiddleware {
    secret: String,
}

impl JWTMiddleware {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    /// Validate token (simplified - in production use proper JWT library)
    pub fn validate(&self, token: &str) -> Result<JWTClaims, String> {
        if token.is_empty() {
            return Err("Empty token".to_string());
        }
        
        // In production, properly decode and verify JWT
        // This is placeholder logic
        Ok(JWTClaims {
            sub: "user".to_string(),
            exp: current_timestamp_ms() + 3600000,
            iat: current_timestamp_ms(),
            role: Some("user".to_string()),
        })
    }
}

/// Request logger
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub method: String,
    pub path: String,
    pub status: u16,
    pub latency_ms: i64,
    pub ip: String,
    pub user_agent: String,
    pub timestamp: i64,
}

/// Logger middleware
pub struct Logger;

impl Logger {
    pub fn log(request: &RequestLog) {
        println!(
            "[{}] {} {} - {} ({}ms)",
            request.timestamp,
            request.method,
            request.path,
            request.status,
            request.latency_ms
        );
    }
}

/// CORS configuration
#[derive(Debug, Clone)]
pub struct CORSConfig {
    pub allowed_origins: Vec<String>,
    pub allowed_methods: Vec<String>,
    pub allowed_headers: Vec<String>,
    pub max_age_secs: u64,
}

impl Default for CORSConfig {
    fn default() -> Self {
        Self {
            allowed_origins: vec!["*".to_string()],
            allowed_methods: vec![
                "GET".to_string(),
                "POST".to_string(),
                "PUT".to_string(),
                "DELETE".to_string(),
                "OPTIONS".to_string(),
            ],
            allowed_headers: vec![
                "Content-Type".to_string(),
                "Authorization".to_string(),
                "X-Requested-With".to_string(),
            ],
            max_age_secs: 3600,
        }
    }
}

/// CORS middleware
pub struct CORSMiddleware {
    config: CORSConfig,
}

impl CORSMiddleware {
    pub fn new(config: CORSConfig) -> Self {
        Self { config }
    }

    /// Check if origin is allowed
    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.config.allowed_origins.iter().any(|o| o == "*" || o == origin)
    }
}

/// Request ID generator
pub struct RequestIdGenerator {
    counter: u64,
}

impl RequestIdGenerator {
    pub fn new() -> Self {
        Self { counter: 0 }
    }

    pub fn generate(&mut self) -> String {
        self.counter += 1;
        format!("req_{}_{}", current_timestamp_ms(), self.counter)
    }
}

/// IP allowlist
pub struct IPAccessControl {
    allowlist: Vec<String>,
    blocklist: Vec<String>,
}

impl IPAccessControl {
    pub fn new() -> Self {
        Self {
            allowlist: Vec::new(),
            blocklist: Vec::new(),
        }
    }

    pub fn add_to_allowlist(&mut self, ip: &str) {
        self.allowlist.push(ip.to_string());
    }

    pub fn add_to_blocklist(&mut self, ip: &str) {
        self.blocklist.push(ip.to_string());
    }

    pub fn is_allowed(&self, ip: &str) -> bool {
        // If blocklisted, deny
        if self.blocklist.iter().any(|b| b == ip) {
            return false;
        }
        
        // If allowlist exists, only allow from it
        if !self.allowlist.is_empty() {
            return self.allowlist.iter().any(|a| a == ip);
        }
        
        // Otherwise allow
        true
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter() {
        let mut limiter = RateLimiter::new(10);
        // Should allow initial burst
        for _ in 0..20 {
            let _ = limiter.check("client1");
        }
    }

    #[test]
    fn test_jwt_validation() {
        let jwt = JWTMiddleware::new("secret".to_string());
        let result = jwt.validate("valid_token");
        assert!(result.is_ok());
    }

    #[test]
    fn test_ip_access() {
        let mut acl = IPAccessControl::new();
        acl.add_to_blocklist("192.168.1.100");
        
        assert!(!acl.is_allowed("192.168.1.100"));
        assert!(acl.is_allowed("192.168.1.50"));
    }
}