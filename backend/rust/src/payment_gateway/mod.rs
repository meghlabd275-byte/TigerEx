//! Payment Gateway - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub amount: f64,
    pub currency: String,
    pub provider: Provider,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Provider { Stripe, PayPal, Plaid }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Pending, Approved, Declined }

pub struct PaymentGateway {
    txs: HashMap<String, Transaction>,
}

impl PaymentGateway {
    pub fn new() -> Self { Self { txs: HashMap::new() } }
    pub fn charge(&mut self, amount: f64, curr: &str, provider: Provider) -> String {
        let id = format!("TX_{}", self.txs.len());
        self.txs.insert(id.clone(), Transaction { id: id.clone(), amount, currency: curr.to_string(), provider, status: Status::Pending });
        id
    }
    pub fn approve(&mut self, id: &str) -> Result<(), String> {
        let t = self.txs.get_mut(id).ok_or("Transaction not found")?;
        t.status = Status::Approved;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut p = PaymentGateway::new(); let id = p.charge(100.0, "USD", Provider::Stripe); assert!(!id.is_empty()); } }
