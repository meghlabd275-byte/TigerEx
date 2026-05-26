//! Margin Loan - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Loan {
    pub id: String,
    pub borrower: String,
    pub collateral: f64,
    pub borrowed: f64,
    pub interest_rate: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status {
    Active,
    Repaid,
    Liquidated,
}

pub struct MarginLoanService {
    loans: HashMap<String, Loan>,
}

impl MarginLoanService {
    pub fn new() -> Self {
        Self { loans: HashMap::new() }
    }
    pub fn borrow(&mut self, borrower: &str, collateral: f64, amount: f64, rate: f64) -> String {
        let id = format!("LOAN_{}", self.loans.len());
        self.loans.insert(id.clone(), Loan {
            id: id.clone(),
            borrower: borrower.to_string(),
            collateral,
            borrowed: amount,
            interest_rate: rate,
            status: Status::Active,
        });
        id
    }
    pub fn liquidate(&mut self, id: &str) -> Result<(), String> {
        let loan = self.loans.get_mut(id).ok_or("Loan not found")?;
        loan.status = Status::Liquidated;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test() {
        let mut s = MarginLoanService::new();
        let id = s.borrow("user1", 1000.0, 500.0, 0.05);
        assert!(!id.is_empty());
    }
}
