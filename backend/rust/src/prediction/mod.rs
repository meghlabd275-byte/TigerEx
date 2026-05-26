//! Prediction Markets - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market { pub id: String, pub question: String, pub outcomes: u32, pub volume: f64, pub resolved: bool }

pub struct PredictionMarket { markets: HashMap<String, Market>, bets: HashMap<String, Vec<(String, f64)>> }

impl PredictionMarket { pub fn new() -> Self { Self { markets: HashMap::new(), bets: HashMap::new() } }
    pub fn create_market(&mut self, q: &str, outcomes: u32) -> String {
        let id = format!("MARKET_{}", self.markets.len());
        self.markets.insert(id.clone(), Market { id: id.clone(), question: q.to_string(), outcomes, volume: 0.0, resolved: false });
        id
    }
    pub fn bet(&mut self, mkt_id: &str, outcome: &str, amount: f64) -> Result<(), String> {
        self.bets.entry(mkt_id.to_string()).or_insert_with(Vec::new).push((outcome.to_string(), amount));
        if let Some(m) = self.markets.get_mut(mkt_id) { m.volume += amount; }
        Ok(())
    }
    pub fn resolve(&mut self, mkt_id: &str, winning_outcome: &str) -> Result<(), String> {
        let m = self.markets.get_mut(mkt_id).ok_or("Market not found")?;
        m.resolved = true;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut pm = PredictionMarket::new(); let id = pm.create_market("Will BTC reach 100k?", 2); assert!(!id.is_empty()); } }
