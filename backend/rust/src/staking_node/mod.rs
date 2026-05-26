//! Staking Node - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Validator { pub id: String, pub stake: f64, pub reward: f64, pub status: Status }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Status { Active, Inactive, Jailed }

pub struct StakingNode { validators: HashMap<String, Validator>, total_stake: f64 }

impl StakingNode { pub fn new() -> Self { Self { validators: HashMap::new(), total_stake: 0.0 } }
    pub fn register(&mut self, id: &str) { self.validators.insert(id.to_string(), Validator { id: id.to_string(), stake: 0.0, reward: 0.0, status: Status::Active }); }
    pub fn stake(&mut self, id: &str, amount: f64) -> Result<(), String> {
        let v = self.validators.get_mut(id).ok_or("Validator not found")?;
        v.stake += amount;
        self.total_stake += amount;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut n = StakingNode::new(); n.register("val1"); n.stake("val1", 1000.0); assert!(n.validators.get("val1").unwrap().stake == 1000.0); } }
