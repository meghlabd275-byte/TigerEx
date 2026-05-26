//! Launchpad - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSale { pub id: String, pub token: String, pub price: f64, pub hard_cap: f64, pub start: i64, pub end: i64, pub raised: f64 }

pub struct Launchpad { sales: HashMap<String, TokenSale> }

impl Launchpad { pub fn new() -> Self { Self { sales: HashMap::new() } }
    pub fn create_sale(&mut self, tok: &str, price: f64, cap: f64, start: i64, end: i64) -> String {
        let id = format!("SALE_{}", self.sales.len());
        self.sales.insert(id.clone(), TokenSale { id: id.clone(), token: tok.to_string(), price, hard_cap: cap, start, end, raised: 0.0 });
        id
    }
    pub fn participate(&mut self, id: &str, amount: f64) -> Result<(), String> {
        let s = self.sales.get_mut(id).ok_or("Sale not found")?;
        if s.raised + amount > s.hard_cap { return Err("Hard cap reached".into()); }
        s.raised += amount;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut l = Launchpad::new(); let id = l.create_sale("TIGER", 0.1, 1000000.0, 0, 0); assert!(!id.is_empty()); } }
