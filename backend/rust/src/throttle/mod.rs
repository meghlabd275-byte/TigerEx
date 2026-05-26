//! Rate Limiter - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleLimit {
    pub requests: u32,
    pub window_sec: u32,
    pub current: u32,
}

pub struct Throttler {
    limits: HashMap<String, ThrottleLimit>,
}

impl Throttler {
    pub fn new() -> Self { Self { limits: HashMap::new() } }
    pub fn set_limit(&mut self, key: &str, requests: u32, window: u32) {
        self.limits.insert(key.to_string(), ThrottleLimit { requests, window_sec: window, current: 0 });
    }
    pub fn check(&mut self, key: &str) -> bool {
        if let Some(l) = self.limits.get_mut(key) {
            if l.current < l.requests { l.current += 1; return true; }
        }
        false
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut t = Throttler::new(); t.set_limit("ip1", 100, 60); assert!(t.check("ip1")); } }
