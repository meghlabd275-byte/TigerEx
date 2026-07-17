//! Social Trading - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Strategy { pub id: String, pub user_id: String, pub name: String, pub copiers: u32 }
pub struct SocialTradingService { strategies: RwLock<HashMap<String, Strategy>> }
impl SocialTradingService {
    pub fn new() -> Self { Self { strategies: RwLock::new(HashMap::new()) } }
    pub fn create_strategy(&self, user_id: &str, name: &str) -> String { let id = format!("strat_{}", name); self.strategies.write().unwrap().insert(id.clone(), Strategy { id: id.clone(), user_id: user_id.to_string(), name: name.to_string(), copiers: 0 }); id }
    pub fn copy_strategy(&self, strategy_id: &str) -> Result<(), String> { if let Some(s) = self.strategies.write().unwrap().get_mut(strategy_id) { s.copiers += 1; Ok(()) } else { Err("Strategy not found".to_string()) } }
    pub fn get_strategies(&self) -> Vec<Strategy> { self.strategies.read().unwrap().values().cloned().collect() }
}
impl Default for SocialTradingService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_social() { let s = SocialTradingService::new(); } }