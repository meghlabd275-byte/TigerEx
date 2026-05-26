//! Arbitrage Engine - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbOpportunity {
    pub id: String,
    pub buy_exchange: String,
    pub sell_exchange: String,
    pub profit_ratio: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Detected, Executed, Failed }

pub struct ArbitrageEngine {
    opportunites: Vec<ArbOpportunity>,
}

impl ArbitrageEngine {
    pub fn new() -> Self { Self { opportunites: vec![] } }
    pub fn detect(&mut self, buy: &str, sell: &str, profit: f64) -> String {
        let id = format!("ARB_{}", self.opportunites.len());
        self.opportunites.push(ArbOpportunity { id: id.clone(), buy_exchange: buy.to_string(), sell_exchange: sell.to_string(), profit_ratio: profit, status: Status::Detected });
        id
    }
    pub fn execute(&mut self, id: &str) { if let Some(a) = self.opportunites.iter_mut().find(|x| x.id == id) { a.status = Status::Executed; } }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut e = ArbitrageEngine::new(); let id = e.detect("binance", "coinbase", 0.005); assert!(!id.is_empty()); } }
