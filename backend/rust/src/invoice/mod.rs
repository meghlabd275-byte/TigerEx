//! Invoice Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Draft, Sent, Paid, Overdue }

pub struct InvoiceService {
    invoices: HashMap<String, Invoice>,
}

impl InvoiceService {
    pub fn new() -> Self { Self { invoices: HashMap::new() } }
    pub fn create(&mut self, user: &str, amount: f64) -> String {
        let id = format!("INV_{}", self.invoices.len());
        self.invoices.insert(id.clone(), Invoice { id: id.clone(), user_id: user.to_string(), amount, status: Status::Draft });
        id
    }
    pub fn mark_paid(&mut self, id: &str) -> Result<(), String> {
        let inv = self.invoices.get_mut(id).ok_or("Invoice not found")?;
        inv.status = Status::Paid;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut i = InvoiceService::new(); let id = i.create("user1", 500.0); assert!(!id.is_empty()); } }
