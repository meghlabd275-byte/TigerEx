//! Insurance Fund - Rust Implementation
//!
//! The insurance fund pays out coverage for losses the exchange has actually
//! provisioned for. It starts empty and is funded only through `fund`; a claim
//! is paid from that real balance, and a payout that would overdraw the fund
//! fails closed. Nothing here invents a starting balance, and a claim is
//! settled at most once.

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
    counter: u64,
}

impl InsuranceService {
    pub fn new() -> Self {
        Self {
            // The fund starts empty; it is provisioned from real fee revenue
            // through `fund`, never seeded with a fabricated balance.
            fund: InsuranceFund { balance: 0.0, total_claims: 0 },
            claims: HashMap::new(),
            counter: 0,
        }
    }

    /// Add real assets to the fund.
    pub fn fund(&mut self, amount: f64) -> Result<(), String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("funding amount must be positive and finite".to_string());
        }
        self.fund.balance += amount;
        Ok(())
    }

    pub fn file_claim(&mut self, uid: &str, amount: f64, reason: &str) -> Result<String, String> {
        if uid.trim().is_empty() {
            return Err("user id is required".to_string());
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err("claim amount must be positive and finite".to_string());
        }
        self.counter += 1;
        let id = format!("CLM_{}", self.counter);
        self.claims.insert(id.clone(), CoverageClaim {
            id: id.clone(),
            user_id: uid.to_string(),
            amount,
            reason: reason.to_string(),
            status: ClaimStatus::Pending,
        });
        Ok(id)
    }

    /// Approve and pay a pending claim. A claim can be settled at most once and
    /// only while the fund holds the amount; the balance moves only on success.
    pub fn approve_claim(&mut self, claim_id: &str) -> Result<(), String> {
        let amount = {
            let c = self.claims.get(claim_id).ok_or("Claim not found")?;
            match c.status {
                ClaimStatus::Pending => c.amount,
                ClaimStatus::Approved => return Err("Claim already approved".to_string()),
                ClaimStatus::Rejected => return Err("Claim was rejected".to_string()),
            }
        };
        if amount > self.fund.balance {
            return Err("Insufficient funds".into());
        }
        self.fund.balance -= amount;
        if let Some(c) = self.claims.get_mut(claim_id) {
            c.status = ClaimStatus::Approved;
        }
        self.fund.total_claims += 1;
        Ok(())
    }

    pub fn reject_claim(&mut self, claim_id: &str) -> Result<(), String> {
        let c = self.claims.get_mut(claim_id).ok_or("Claim not found")?;
        if c.status != ClaimStatus::Pending {
            return Err("Claim is not pending".to_string());
        }
        c.status = ClaimStatus::Rejected;
        Ok(())
    }

    pub fn get_claim(&self, claim_id: &str) -> Option<&CoverageClaim> {
        self.claims.get(claim_id)
    }
}

impl Default for InsuranceService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insurance() {
        let mut s = InsuranceService::new();
        let id = s.file_claim("user1", 1000.0, "Hack").unwrap();
        assert!(!id.is_empty());
    }

    #[test]
    fn the_fund_starts_empty() {
        let s = InsuranceService::new();
        assert_eq!(s.fund.balance, 0.0);
    }

    #[test]
    fn a_claim_beyond_the_fund_fails_closed() {
        let mut s = InsuranceService::new();
        s.fund(500.0).unwrap();
        let id = s.file_claim("u", 1000.0, "loss").unwrap();
        assert!(s.approve_claim(&id).is_err());
        assert_eq!(s.fund.balance, 500.0);
        assert_eq!(s.get_claim(&id).unwrap().status, ClaimStatus::Pending);
    }

    #[test]
    fn a_claim_cannot_be_paid_twice() {
        let mut s = InsuranceService::new();
        s.fund(1000.0).unwrap();
        let id = s.file_claim("u", 400.0, "loss").unwrap();
        s.approve_claim(&id).unwrap();
        assert_eq!(s.fund.balance, 600.0);
        assert!(s.approve_claim(&id).is_err());
        assert_eq!(s.fund.balance, 600.0);
    }

    #[test]
    fn non_positive_amounts_are_rejected() {
        let mut s = InsuranceService::new();
        assert!(s.fund(0.0).is_err());
        assert!(s.fund(-1.0).is_err());
        assert!(s.file_claim("u", 0.0, "x").is_err());
        assert!(s.file_claim("u", -100.0, "x").is_err());
        assert!(s.file_claim("u", f64::NAN, "x").is_err());
    }

    #[test]
    fn a_rejected_claim_is_not_payable() {
        let mut s = InsuranceService::new();
        s.fund(1000.0).unwrap();
        let id = s.file_claim("u", 100.0, "x").unwrap();
        s.reject_claim(&id).unwrap();
        assert!(s.approve_claim(&id).is_err());
        assert_eq!(s.fund.balance, 1000.0);
    }
}
