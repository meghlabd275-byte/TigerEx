//! Rate Limits - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimit { pub requests: u32, pub window_ms: i64 }

pub struct RateLimiter { limits: HashMap<String, (u32, i64)> }

impl RateLimiter {
    pub fn new() -> Self { Self { limits: HashMap::new() } }
    pub fn allow(&mut self, key: &str, limit: u32, window: i64) -> bool {
        let now = ms_now();
        let (cnt, ts) = self.limits.entry(key.to_string()).or_insert((0, now));
        if now - *ts > window { *cnt = 0; *ts = now; }
        if *cnt < limit { *cnt += 1; true } else { false }
    }
}

fn ms_now() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut r = RateLimiter::new(); assert!(r.allow("api", 100, 60000)); } }
