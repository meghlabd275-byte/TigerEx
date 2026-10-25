//! Flash loans.
//!
//! The previous implementation was a stub: `borrow` returned a formatted
//! string without tracking anything, `repay` always succeeded without checking
//! the repayment, and `arbitrage` returned a constant 0.01 regardless of any
//! market. A flash loan must be repaid within the same transaction, with a fee,
//! or the borrow must be rejected.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Loan {
    pub id: String,
    pub borrower: String,
    pub asset: String,
    pub principal: f64,
    pub fee: f64,
    /// Total owed: principal plus fee.
    pub amount_due: f64,
    pub repaid: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlashLoanError {
    InvalidAmount(f64),
    EmptyBorrower,
    UnknownLoan(String),
    AlreadyRepaid(String),
    InsufficientRepayment { required: f64, provided: f64 },
    PoolExhausted { available: f64 },
    InvalidFeeBps(u32),
}

impl std::fmt::Display for FlashLoanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FlashLoanError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            FlashLoanError::EmptyBorrower => write!(f, "borrower must not be empty"),
            FlashLoanError::UnknownLoan(id) => write!(f, "unknown loan: {id}"),
            FlashLoanError::AlreadyRepaid(id) => write!(f, "loan {id} was already repaid"),
            FlashLoanError::InsufficientRepayment { required, provided } => write!(
                f,
                "repayment {provided} is below the {required} owed"
            ),
            FlashLoanError::PoolExhausted { available } => {
                write!(f, "pool only holds {available}")
            }
            FlashLoanError::InvalidFeeBps(bps) => {
                write!(f, "fee {bps} bps must be within 0..=10000")
            }
        }
    }
}

impl std::error::Error for FlashLoanError {}

pub struct FlashLoanService {
    loans: RwLock<HashMap<String, Loan>>,
    /// asset -> liquidity available in the pool.
    pools: RwLock<HashMap<String, f64>>,
    /// Fee charged per loan, in basis points.
    fee_bps: u32,
    next_id: RwLock<u64>,
}

impl FlashLoanService {
    pub fn new() -> Self {
        Self {
            loans: RwLock::new(HashMap::new()),
            pools: RwLock::new(HashMap::new()),
            fee_bps: 9, // 0.09%
            next_id: RwLock::new(1),
        }
    }

    pub fn with_fee_bps(mut self, fee_bps: u32) -> Result<Self, FlashLoanError> {
        if fee_bps > 10_000 {
            return Err(FlashLoanError::InvalidFeeBps(fee_bps));
        }
        self.fee_bps = fee_bps;
        Ok(self)
    }

    /// Fund a pool so it can lend.
    pub fn fund_pool(&self, asset: &str, amount: f64) -> Result<(), FlashLoanError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(FlashLoanError::InvalidAmount(amount));
        }
        *self
            .pools
            .write()
            .unwrap()
            .entry(asset.to_string())
            .or_insert(0.0) += amount;
        Ok(())
    }

    pub fn pool_liquidity(&self, asset: &str) -> f64 {
        self.pools
            .read()
            .unwrap()
            .get(asset)
            .copied()
            .unwrap_or(0.0)
    }

    /// Borrow from a pool. The principal leaves the pool and is owed back with
    /// the fee.
    pub fn borrow(
        &self,
        borrower: &str,
        asset: &str,
        amount: f64,
    ) -> Result<Loan, FlashLoanError> {
        if borrower.trim().is_empty() {
            return Err(FlashLoanError::EmptyBorrower);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(FlashLoanError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let available = pools.get(asset).copied().unwrap_or(0.0);
        if available < amount {
            return Err(FlashLoanError::PoolExhausted { available });
        }
        *pools.get_mut(asset).expect("pool checked above") -= amount;
        drop(pools);

        let fee = amount * (self.fee_bps as f64 / 10_000.0);
        let loan = Loan {
            id: {
                let mut next_id = self.next_id.write().unwrap();
                let id = format!("fl_{}", *next_id);
                *next_id += 1;
                id
            },
            borrower: borrower.to_string(),
            asset: asset.to_string(),
            principal: amount,
            fee,
            amount_due: amount + fee,
            repaid: false,
        };

        self.loans
            .write()
            .unwrap()
            .insert(loan.id.clone(), loan.clone());
        Ok(loan)
    }

    /// Repay a loan. The repayment must cover the principal plus fee, and the
    /// loan can only be repaid once.
    pub fn repay(&self, loan_id: &str, amount: f64) -> Result<Loan, FlashLoanError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(FlashLoanError::InvalidAmount(amount));
        }

        let mut loans = self.loans.write().unwrap();
        let loan = loans
            .get_mut(loan_id)
            .ok_or_else(|| FlashLoanError::UnknownLoan(loan_id.to_string()))?;

        if loan.repaid {
            return Err(FlashLoanError::AlreadyRepaid(loan_id.to_string()));
        }
        if amount < loan.amount_due {
            return Err(FlashLoanError::InsufficientRepayment {
                required: loan.amount_due,
                provided: amount,
            });
        }

        loan.repaid = true;
        let loan = loan.clone();
        drop(loans);

        // Principal returns to the pool; the fee is retained as protocol
        // revenue, so the pool grows by the fee over time.
        *self
            .pools
            .write()
            .unwrap()
            .entry(loan.asset.clone())
            .or_insert(0.0) += loan.amount_due;
        Ok(loan)
    }

    pub fn loan(&self, loan_id: &str) -> Option<Loan> {
        self.loans.read().unwrap().get(loan_id).cloned()
    }
}

impl Default for FlashLoanService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn funded() -> FlashLoanService {
        let svc = FlashLoanService::new();
        svc.fund_pool("USDT", 1_000_000.0).unwrap();
        svc
    }

    #[test]
    fn borrow_removes_principal_from_the_pool() {
        let svc = funded();
        let loan = svc.borrow("alice", "USDT", 100_000.0).unwrap();

        assert_eq!(loan.principal, 100_000.0);
        assert!(loan.fee > 0.0);
        assert_eq!(loan.amount_due, loan.principal + loan.fee);
        assert_eq!(svc.pool_liquidity("USDT"), 900_000.0);
    }

    #[test]
    fn borrow_beyond_pool_liquidity_is_rejected() {
        let svc = funded();
        // The old implementation returned an id for any amount.
        assert!(matches!(
            svc.borrow("alice", "USDT", 2_000_000.0).unwrap_err(),
            FlashLoanError::PoolExhausted { .. }
        ));
        assert!(svc.borrow("alice", "USDT", -1.0).is_err());
        assert!(svc.borrow("alice", "USDT", f64::NAN).is_err());
        assert!(svc.borrow("  ", "USDT", 1.0).is_err());
    }

    #[test]
    fn repayment_below_the_amount_due_is_rejected() {
        let svc = funded();
        let loan = svc.borrow("alice", "USDT", 100_000.0).unwrap();

        // The old repay accepted anything, including nothing.
        assert!(matches!(
            svc.repay(&loan.id, 100_000.0).unwrap_err(),
            FlashLoanError::InsufficientRepayment { .. }
        ));
        assert!(!svc.loan(&loan.id).unwrap().repaid);
    }

    #[test]
    fn a_loan_can_only_be_repaid_once() {
        let svc = funded();
        let loan = svc.borrow("alice", "USDT", 100_000.0).unwrap();

        svc.repay(&loan.id, loan.amount_due).unwrap();
        assert!(matches!(
            svc.repay(&loan.id, loan.amount_due).unwrap_err(),
            FlashLoanError::AlreadyRepaid(_)
        ));
        // The pool ends up with the fee as revenue.
        assert_eq!(svc.pool_liquidity("USDT"), 1_000_000.0 + loan.fee);
    }

    #[test]
    fn unknown_loans_are_rejected() {
        let svc = funded();
        assert!(svc.repay("fl_missing", 1.0).is_err());
    }
}
