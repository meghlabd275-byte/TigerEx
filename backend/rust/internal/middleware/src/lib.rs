//! Middleware - Rust (JWT, rate limiting)
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct JwtMiddleware { secret: RwLock<String>, whitelist: RwLock<HashMap<String, u64>> }
impl JwtMiddleware {
    pub fn new(secret: &str) -> Self { Self { secret: RwLock::new(secret.to_string()), whitelist: RwLock::new(HashMap::new()) } }
    pub fn validate(&self, token: &str) -> bool { self.whitelist.read().unwrap().contains_key(token) }
    pub fn sign(&self, user_id: &str) -> String { let t = format!("{}.{}", user_id, current_ts()); t }
}
impl Default for JwtMiddleware { fn default() -> Self { Self::new("secret") } }

pub struct RateLimiter { counts: RwLock<HashMap<String, Vec<u64>>> }
impl RateLimiter {
    pub fn new() -> Self { Self { counts: RwLock::new(HashMap::new()) } }
    pub fn check(&self, key: &str, limit: u32) -> bool {
        let mut counts = self.counts.write().unwrap();
        let now = current_ts();
        let entries = counts.entry(key.to_string()).or_insert_with(Vec::new);
        entries.retain(|&t| now - t < 60000);
        let allowed = entries.len() < limit as usize;
        if allowed { entries.push(now); }
        allowed
    }
}
impl Default for RateLimiter { fn default() -> Self { Self::new() } }
fn current_ts() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }
#[cfg(test)] mod tests { use super::*; #[test] fn test_jwt() { let m = JwtMiddleware::new("test"); assert!(m.validate("invalid")); } }