//! Prime Brokerage - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimeAccount {
    pub id: String,
    pub broker: String,
    pub commissions: f64,
    pub volume: f64,
}

pub struct PrimeBrokerage {
    accounts: HashMap<String, PrimeAccount>,
}

impl PrimeBrokerage {
    pub fn new() -> Self { Self { accounts: HashMap::new() } }
    pub fn open(&mut self, broker: &str) -> String {
        let id = format!("PRIME_{}", self.accounts.len());
        self.accounts.insert(id.clone(), PrimeAccount { id: id.clone(), broker: broker.to_string(), commissions: 0.0, volume: 0.0 });
        id
    }
    pub fn trade(&mut self, id: &str, amount: f64) -> Result<(), String> {
        let acc = self.accounts.get_mut(id).ok_or("Account not found")?;
        acc.volume += amount;
        acc.commissions += amount * 0.0001;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut p = PrimeBrokerage::new(); let id = p.open("Morgan"); assert!(!id.is_empty()); } }
