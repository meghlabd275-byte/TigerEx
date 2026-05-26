//! Trading Engine - Rust
use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Trade { pub id: String, pub buyer: String, pub seller: String, pub symbol: String, pub price: f64, pub qty: f64 }
pub struct TradingEngine {
    orders: RwLock<VecDeque<Order>>,
    matches: RwLock<Vec<Trade>>,
    orderbook: RwLock<HashMap<String, (Vec<Order>, Vec<Order>)>>,
}
#[derive(Debug, Clone)] pub struct Order { pub id: String, pub user_id: String, pub side: String, pub price: f64, pub qty: f64 }
impl TradingEngine {
    pub fn new() -> Self { Self { orders: RwLock::new(VecDeque::new()), matches: RwLock::new(Vec::new()), orderbook: RwLock::new(HashMap::new()) } }
    pub fn submit_order(&self, user_id: &str, side: &str, price: f64, qty: f64) -> String { let id = format!("ord_{}", self.orders.read().unwrap().len()); self.orders.write().unwrap().push_back(Order { id: id.clone(), user_id: user_id.to_string(), side: side.to_string(), price, qty }); id }
    pub fn match_orders(&self) -> Vec<Trade> { let mut matches = Vec::new(); let mut orders = self.orders.write().unwrap(); while let Some(buy) = orders.iter().find(|o| o.side == "buy") { if let Some(sell) = orders.iter().find(|o| o.side == "sell" && o.price <= buy.price) { matches.push(Trade { id: "t".to_string(), buyer: buy.user_id.clone(), seller: sell.user_id.clone(), symbol: "BTC".to_string(), price: buy.price, qty: buy.qty.min(sell.qty) }); } } matches }
}
impl Default for TradingEngine { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let e = TradingEngine::new(); } }