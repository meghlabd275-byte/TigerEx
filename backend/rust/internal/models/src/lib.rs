//! Models - Rust (core data structures)
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User { pub id: String, pub email: String, pub kyc_level: u8 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account { pub user_id: String, pub balances: Vec<Balance> }
#[derive(Debug, Clone, Serialize, Deserialize)] pub struct Balance { pub asset: String, pub free: f64, pub locked: f64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order { pub id: String, pub user_id: String, pub symbol: String, pub side: String, #[serde(rename = "type")] pub order_type: String, pub price: f64, pub quantity: f64, pub filled: f64, pub status: String }
#[cfg(test)] mod tests { use super::*; #[test] fn test_order() { let o = Order { id: "1".to_string(), user_id: "u1".to_string(), symbol: "BTC".to_string(), side: "buy".to_string(), order_type: "limit".to_string(), price: 50000.0, quantity: 1.0, filled: 0.0, status: "open".to_string() }; assert_eq!(o.quantity, 1.0); } }