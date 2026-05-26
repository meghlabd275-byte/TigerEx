//! DCA Strategy - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DCAStrategy {
    pub id: String,
    pub user_id: String,
    pub pair: String,
    pub amount: f64,
    pub interval: i64,
    pub executions: u32,
}

pub struct DCAService {
    strategies: Vec<DCAStrategy>,
}

impl DCAService {
    pub fn new() -> Self { Self { strategies: vec![] } }
    pub fn create(&mut self, uid: &str, pair: &str, amount: f64, interval: i64) -> String {
        let id = format!("DCA_{}", self.strategies.len());
        self.strategies.push(DCAStrategy { id: id.clone(), user_id: uid.to_string(), pair: pair.to_string(), amount, interval, executions: 0 });
        id
    }
    pub fn execute(&mut self, id: &str) {
        if let Some(s) = self.strategies.iter_mut().find(|x| x.id == id) { s.executions += 1; }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = DCAService::new(); let id = s.create("user1", "BTC/USDC", 100.0, 86400); assert!(!id.is_empty()); } }
