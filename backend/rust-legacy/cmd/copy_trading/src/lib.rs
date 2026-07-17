//! Copy Trading - Rust
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
#[derive(Debug, Clone)]
pub struct Leader { pub user_id: String, pub returns: f64, pub followers: u32 }
#[derive(Debug, Clone)]
pub struct Follower { pub user_id: String, pub leader_id: String, pub allocation: f64 }
pub struct CopyTradingService {
    leaders: RwLock<HashMap<String, Leader>>,
    followers: RwLock<HashMap<String, Vec<Follower>>>,
}
impl CopyTradingService {
    pub fn new() -> Self { Self { leaders: RwLock::new(HashMap::new()), followers: RwLock::new(HashMap::new()) } }
    pub fn add_leader(&self, user_id: &str) { self.leaders.write().unwrap().insert(user_id.to_string(), Leader { user_id: user_id.to_string(), returns: 0.0, followers: 0 }); }
    pub fn follow(&self, user_id: &str, leader_id: &str, allocation: f64) -> Result<(), String> {
        if !self.leaders.read().unwrap().contains_key(leader_id) { return Err("Leader not found".to_string()); }
        self.followers.write().unwrap().entry(user_id.to_string()).or_insert_with(Vec::new).push(Follower { user_id: user_id.to_string(), leader_id: leader_id.to_string(), allocation });
        Ok(())
    }
    pub fn unfollow(&self, user_id: &str, leader_id: &str) -> Result<(), String> {
        let mut followers = self.followers.write().unwrap();
        if let Some(f) = followers.get_mut(user_id) { f.retain(|x| x.leader_id != leader_id); Ok(()) } else { Err("Not following".to_string()) }
    }
}
impl Default for CopyTradingService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_copy() { let s = CopyTradingService::new(); } }