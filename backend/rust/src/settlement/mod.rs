//! Settlement Engine - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settlement {
    pub id: String,
    pub party_a: String,
    pub party_b: String,
    pub amount_a: f64,
    pub amount_b: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status {
    Pending,
    Cleared,
    Finalized,
}

pub struct SettlementEngine {
    settlements: HashMap<String, Settlement>,
}

impl SettlementEngine {
    pub fn new() -> Self {
        Self { settlements: HashMap::new() }
    }
    pub fn create(&mut self, a: &str, b: &str, amt_a: f64, amt_b: f64) -> String {
        let id = format!("SETTLE_{}", self.settlements.len());
        self.settlements.insert(id.clone(), Settlement {
            id: id.clone(),
            party_a: a.to_string(),
            party_b: b.to_string(),
            amount_a: amt_a,
            amount_b: amt_b,
            status: Status::Pending,
        });
        id
    }
    pub fn clear(&mut self, id: &str) -> Result<(), String> {
        let s = self.settlements.get_mut(id).ok_or("Settlement not found")?;
        s.status = Status::Cleared;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test() {
        let mut s = SettlementEngine::new();
        let id = s.create("user1", "user2", 1000.0, 0.02);
        assert!(!id.is_empty());
    }
}
