//! Premium Services - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription { pub user_id: String, pub tier: Tier, pub expires: i64 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Tier { Basic, Pro, VIP }

pub struct PremiumService { subs: HashMap<String, Subscription> }

impl PremiumService { pub fn new() -> Self { Self { subs: HashMap::new() } }
    pub fn subscribe(&mut self, uid: &str, tier: Tier, expires: i64) {
        self.subs.insert(uid.to_string(), Subscription { user_id: uid.to_string(), tier, expires });
    }
    pub fn is_active(&self, uid: &str) -> bool {
        self.subs.get(uid).map(|s| s.expires > now_ms()).unwrap_or(false)
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut p = PremiumService::new(); p.subscribe("user1", Tier::Pro, now_ms() + 86400000); assert!(p.is_active("user1")); } }
