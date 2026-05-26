//! Fiat On/Off Ramp - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatOrder { pub id: String, pub user_id: String, pub amount: f64, pub currency: String, pub direction: Direction, pub status: Status }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Direction { Buy, Sell }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Status { Pending, Processing, Completed, Failed }

pub struct FiatRamp { orders: HashMap<String, FiatOrder> }

impl FiatRamp { pub fn new() -> Self { Self { orders: HashMap::new() } }
    pub fn create(&mut self, uid: &str, amt: f64, curr: &str, dir: Direction) -> String {
        let id = format!("RAMP_{}", self.orders.len());
        self.orders.insert(id.clone(), FiatOrder { id: id.clone(), user_id: uid.to_string(), amount: amt, currency: curr.to_string(), direction: dir, status: Status::Pending });
        id
    }
    pub fn process(&mut self, id: &str) -> Result<(), String> {
        let o = self.orders.get_mut(id).ok_or("Order not found")?;
        o.status = Status::Processing;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut r = FiatRamp::new(); let id = r.create("user1", 1000.0, "USD", Direction::Buy); assert!(!id.is_empty()); } }
