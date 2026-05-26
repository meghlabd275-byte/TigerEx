//! Security - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub id: String,
    pub user_id: String,
    pub event_type: EventType,
    pub ip: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType { Login, Withdrawal, PasswordChange, KYCUpdate }

pub struct SecurityService {
    events: Vec<SecurityEvent>,
    blocked_ips: HashMap<String, i64>,
    rate_limits: HashMap<String, (u32, i64)>,
}

impl SecurityService {
    pub fn new() -> Self { Self { events: Vec::new(), blocked_ips: HashMap::new(), rate_limits: HashMap::new() } }
    pub fn log_event(&mut self, uid: &str, et: EventType, ip: &str) {
        self.events.push(SecurityEvent { id: format!("SEC_{}", self.events.len()), user_id: uid.to_string(), event_type: et, ip: ip.to_string(), timestamp: now_ms() });
    }
    pub fn block_ip(&mut self, ip: &str) { self.blocked_ips.insert(ip.to_string(), now_ms()); }
    pub fn is_blocked(&self, ip: &str) -> bool { self.blocked_ips.contains_key(ip) }
    pub fn check_rate_limit(&mut self, key: &str, limit: u32) -> bool {
        let now = now_ms();
        let (cnt, ts) = self.rate_limits.entry(key.to_string()).or_insert((0, now));
        if now - *ts > 60000 { *cnt = 0; *ts = now; }
        *cnt += 1;
        *cnt <= limit
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = SecurityService::new(); s.log_event("user1", EventType::Login, "192.168.1.1"); assert!(s.events.len() == 1); } }
