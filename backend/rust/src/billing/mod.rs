//! Billing - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub status: InvStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvStatus { Pending, Paid, Overdue }

pub struct BillingService { invoices: HashMap<String, Invoice> }

impl BillingService {
    pub fn new() -> Self { Self { invoices: HashMap::new() } }
    pub fn create_invoice(&mut self, uid: &str, amount: f64, curr: &str) -> String {
        let id = format!("INV_{}", self.invoices.len());
        self.invoices.insert(id.clone(), Invoice { id: id.clone(), user_id: uid.to_string(), amount, currency: curr.to_string(), status: InvStatus::Pending });
        id
    }
    pub fn mark_paid(&mut self, inv_id: &str) -> Result<(), String> {
        let inv = self.invoices.get_mut(inv_id).ok_or("Invoice not found")?;
        inv.status = InvStatus::Paid;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut b = BillingService::new(); let id = b.create_invoice("user1", 100.0, "USD"); assert!(!id.is_empty()); } }
