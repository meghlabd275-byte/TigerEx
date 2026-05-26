//! Spot Trading - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotOrder { pub id: String, pub symbol: String, pub side: Side, pub amount: f64, pub price: f64, pub status: Status }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Side { Buy, Sell }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Status { Open, Filled, Cancelled }

pub struct SpotTrading { orders: HashMap<String, SpotOrder> }

impl SpotTrading { pub fn new() -> Self { Self { orders: HashMap::new() } }
    pub fn create_order(&mut self, sym: &str, side: Side, amt: f64, px: f64) -> String {
        let id = format!("SPOT_{}", self.orders.len());
        self.orders.insert(id.clone(), SpotOrder { id: id.clone(), symbol: sym.to_string(), side, amount: amt, price: px, status: Status::Open });
        id
    }
    pub fn fill(&mut self, id: &str) -> Result<(), String> {
        let o = self.orders.get_mut(id).ok_or("Order not found")?;
        o.status = Status::Filled;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut t = SpotTrading::new(); let id = t.create_order("BTC/USDT", Side::Buy, 1.0, 50000.0); assert!(!id.is_empty()); } }
