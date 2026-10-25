//! Insurance fund.
//!
//! The previous implementation accepted any amount: `add(-x)` drained the fund
//! and `cover(-x)` credited it, so a caller passing a negative number could
//! mint or destroy balance. There was also no drawdown accounting, no target
//! and no ADL trigger.

use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum InsuranceError {
    InvalidAmount(f64),
    InsufficientBalance { requested: f64, available: f64 },
}

impl std::fmt::Display for InsuranceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InsuranceError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            InsuranceError::InsufficientBalance { requested, available } => {
                write!(f, "requested {requested} exceeds available {available}")
            }
        }
    }
}

impl std::error::Error for InsuranceError {}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FundSnapshot {
    pub balance: f64,
    pub reserves: f64,
    /// Total covered to date.
    pub covered_total: f64,
    /// Whether the fund has fallen below its ADL trigger.
    pub adl_required: bool,
}

pub struct InsuranceFund {
    balance: RwLock<f64>,
    reserves: RwLock<f64>,
    covered_total: RwLock<f64>,
    /// Balance below which auto-deleveraging is triggered.
    adl_threshold: f64,
}

impl InsuranceFund {
    pub fn new() -> Self {
        Self {
            balance: RwLock::new(0.0),
            reserves: RwLock::new(0.0),
            covered_total: RwLock::new(0.0),
            adl_threshold: 0.0,
        }
    }

    pub fn with_adl_threshold(mut self, threshold: f64) -> Self {
        self.adl_threshold = threshold.max(0.0);
        self
    }

    /// Credit the fund. Rejects non-finite and non-positive amounts.
    pub fn add(&self, amount: f64) -> Result<(), InsuranceError> {
        Self::validate(amount)?;
        *self.balance.write().unwrap() += amount;
        Ok(())
    }

    /// Move funds from the balance into reserves.
    pub fn reserve(&self, amount: f64) -> Result<(), InsuranceError> {
        Self::validate(amount)?;
        let mut balance = self.balance.write().unwrap();
        if *balance < amount {
            return Err(InsuranceError::InsufficientBalance {
                requested: amount,
                available: *balance,
            });
        }
        *balance -= amount;
        *self.reserves.write().unwrap() += amount;
        Ok(())
    }

    /// Draw down the fund to cover a shortfall.
    ///
    /// Fails when the balance cannot cover the amount, so a caller cannot go
    /// negative or accidentally credit the fund with a negative request.
    pub fn cover(&self, amount: f64) -> Result<(), InsuranceError> {
        Self::validate(amount)?;
        let mut balance = self.balance.write().unwrap();
        if *balance < amount {
            return Err(InsuranceError::InsufficientBalance {
                requested: amount,
                available: *balance,
            });
        }
        *balance -= amount;
        *self.covered_total.write().unwrap() += amount;
        Ok(())
    }

    /// Whether the fund is below its ADL trigger.
    pub fn adl_required(&self) -> bool {
        self.adl_threshold > 0.0 && self.balance() < self.adl_threshold
    }

    pub fn balance(&self) -> f64 {
        *self.balance.read().unwrap()
    }

    pub fn reserves(&self) -> f64 {
        *self.reserves.read().unwrap()
    }

    pub fn covered_total(&self) -> f64 {
        *self.covered_total.read().unwrap()
    }

    pub fn snapshot(&self) -> FundSnapshot {
        FundSnapshot {
            balance: self.balance(),
            reserves: self.reserves(),
            covered_total: self.covered_total(),
            adl_required: self.adl_required(),
        }
    }

    fn validate(amount: f64) -> Result<(), InsuranceError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(InsuranceError::InvalidAmount(amount));
        }
        Ok(())
    }
}

impl Default for InsuranceFund {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_amounts_cannot_move_balance() {
        let fund = InsuranceFund::new();
        fund.add(1_000.0).unwrap();

        // The old implementation drained the fund with a negative add...
        assert!(fund.add(-500.0).is_err());
        assert_eq!(fund.balance(), 1_000.0);

        // ...and credited it with a negative cover.
        assert!(fund.cover(-500.0).is_err());
        assert_eq!(fund.balance(), 1_000.0);
    }

    #[test]
    fn cover_draws_down_and_records_the_total() {
        let fund = InsuranceFund::new();
        fund.add(1_000.0).unwrap();

        fund.cover(400.0).unwrap();
        assert_eq!(fund.balance(), 600.0);
        assert_eq!(fund.covered_total(), 400.0);
    }

    #[test]
    fn cover_beyond_the_balance_fails_without_going_negative() {
        let fund = InsuranceFund::new();
        fund.add(100.0).unwrap();

        assert_eq!(
            fund.cover(150.0).unwrap_err(),
            InsuranceError::InsufficientBalance {
                requested: 150.0,
                available: 100.0
            }
        );
        assert_eq!(fund.balance(), 100.0);
    }

    #[test]
    fn reserves_are_separate_from_balance() {
        let fund = InsuranceFund::new();
        fund.add(1_000.0).unwrap();
        fund.reserve(250.0).unwrap();

        assert_eq!(fund.balance(), 750.0);
        assert_eq!(fund.reserves(), 250.0);
        assert!(fund.reserve(1_000.0).is_err());
    }

    #[test]
    fn adl_triggers_below_the_threshold() {
        let fund = InsuranceFund::new().with_adl_threshold(500.0);
        fund.add(1_000.0).unwrap();
        assert!(!fund.adl_required());

        fund.cover(600.0).unwrap();
        assert!(fund.adl_required());
        assert!(fund.snapshot().adl_required);
    }
}
