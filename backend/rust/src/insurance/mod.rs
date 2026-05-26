//! Insurance Fund - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceFund {
    pub balance: f64,
    pub total_claims: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageClaim {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub reason: String,
    pub status: ClaimStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaimStatus { Pending, Approved, Rejected }

pub struct InsuranceService {
    pub fund: InsuranceFund,
    claims: HashMap<String, CoverageClaim>,
}

impl InsuranceService {
    pub fn new() -> Self {
        Self {
            fund: InsuranceFund { balance: 100_000_000.0, total_claims: 0 },
            claims: HashMap::new(),
        }
    }
    pub fn file_claim(&mut self, uid: &str, amount: f64, reason: &str) -> String {
        let id = format!("CLM_{}", self.claims.len());
        self.claims.insert(id.clone(), CoverageClaim {
            id: id.clone(),
            user_id: uid.to_string(),
            amount,
            reason: reason.to_string(),
            status: ClaimStatus::Pending,
        });
        id
    }
    pub fn approve_claim(&mut self, claim_id: &str) -> Result<(), String> {
        let c = self.claims.get_mut(claim_id).ok_or("Claim not found")?;
        if c.amount > self.fund.balance {
            return Err("Insufficient funds".into());
        }
        self.fund.balance -= c.amount;
        c.status = ClaimStatus::Approved;
        self.fund.total_claims += 1;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_insurance() { let mut s = InsuranceService::new(); let id = s.file_claim("user1", 1000.0, "Hack"); assert!(!id.is_empty()); } }
