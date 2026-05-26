//! Earn & Yield - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarnProduct {
    pub id: String,
    pub token: String,
    pub apy: f64,
    pub min_deposit: f64,
    pub lock_period: i64,
}

pub struct EarnYieldService {
    products: HashMap<String, EarnProduct>,
    positions: HashMap<String, (String, f64, i64)>,
}

impl EarnYieldService {
    pub fn new() -> Self {
        Self { products: HashMap::new(), positions: HashMap::new() }
    }
    pub fn create_product(&mut self, tok: &str, apy: f64, min_dep: f64, lock: i64) -> String {
        let id = format!("EARN_{}", self.products.len());
        self.products.insert(id.clone(), EarnProduct {
            id: id.clone(),
            token: tok.to_string(),
            apy,
            min_deposit: min_dep,
            lock_period: lock,
        });
        id
    }
    pub fn deposit(&mut self, user: &str, prod_id: &str, amount: f64) -> Result<String, String> {
        if !self.products.contains_key(prod_id) { return Err("Product not found".into()); }
        let pos_id = format!("POS_{}", self.positions.len());
        self.positions.insert(pos_id.clone(), (user.to_string(), amount, now_ms()));
        Ok(pos_id)
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = EarnYieldService::new(); let id = s.create_product("USDC", 0.05, 100.0, 86400); assert!(!id.is_empty()); } }
