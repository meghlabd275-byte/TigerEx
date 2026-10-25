//! Cross-margin account risk.
//!
//! The previous implementation had no input validation (a negative borrow
//! reduced debt, a negative deposit reduced collateral), computed the borrow
//! limit from the wrong ratio, never updated `margin_ratio`, and had no
//! health factor or liquidation check.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct MarginAccount {
    pub user_id: String,
    /// Collateral value in USD.
    pub collateral: f64,
    /// Outstanding debt in USD.
    pub debt: f64,
    /// Ratio of debt to collateral.
    pub margin_ratio: f64,
}

impl MarginAccount {
    pub fn equity(&self) -> f64 {
        self.collateral - self.debt
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarginError {
    InvalidAmount(f64),
    AccountNotFound(String),
    AccountExists(String),
    InsufficientCollateral,
    ExceedsBorrowLimit,
    NotLiquidatable,
}

impl std::fmt::Display for MarginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MarginError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            MarginError::AccountNotFound(u) => write!(f, "no margin account for {u}"),
            MarginError::AccountExists(u) => write!(f, "margin account for {u} already exists"),
            MarginError::InsufficientCollateral => write!(f, "insufficient free collateral"),
            MarginError::ExceedsBorrowLimit => write!(f, "borrow would exceed the LTV limit"),
            MarginError::NotLiquidatable => write!(f, "account is above the liquidation threshold"),
        }
    }
}

impl std::error::Error for MarginError {}

/// Risk parameters for a margin account.
#[derive(Debug, Clone, Copy)]
pub struct RiskParams {
    /// Maximum debt-to-collateral ratio when opening new debt.
    pub max_ltv: f64,
    /// Debt-to-collateral ratio at which the account becomes liquidatable.
    pub liquidation_threshold: f64,
    /// Hourly interest rate charged on debt.
    pub hourly_interest_rate: f64,
}

impl Default for RiskParams {
    fn default() -> Self {
        Self {
            max_ltv: 0.8,
            liquidation_threshold: 0.9,
            hourly_interest_rate: 0.00005, // ~4.4% APY
        }
    }
}

pub struct MarginService {
    accounts: RwLock<HashMap<String, MarginAccount>>,
    params: RiskParams,
}

impl MarginService {
    pub fn new() -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            params: RiskParams::default(),
        }
    }

    pub fn with_params(params: RiskParams) -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            params,
        }
    }

    fn validate(amount: f64) -> Result<(), MarginError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(MarginError::InvalidAmount(amount));
        }
        Ok(())
    }

    pub fn open_account(&self, user_id: &str) -> Result<(), MarginError> {
        let mut accounts = self.accounts.write().unwrap();
        if accounts.contains_key(user_id) {
            return Err(MarginError::AccountExists(user_id.to_string()));
        }
        accounts.insert(
            user_id.to_string(),
            MarginAccount {
                user_id: user_id.to_string(),
                collateral: 0.0,
                debt: 0.0,
                margin_ratio: 0.0,
            },
        );
        Ok(())
    }

    /// Deposit collateral.
    pub fn deposit(&self, user_id: &str, amount: f64) -> Result<MarginAccount, MarginError> {
        Self::validate(amount)?;
        self.mutate(user_id, |a| {
            a.collateral += amount;
            Ok(())
        })
    }

    /// Withdraw collateral, rejecting any withdrawal that would leave the
    /// account below its liquidation threshold.
    pub fn withdraw(&self, user_id: &str, amount: f64) -> Result<MarginAccount, MarginError> {
        Self::validate(amount)?;
        self.mutate(user_id, |a| {
            if a.collateral - amount < a.debt / self.params.liquidation_threshold {
                return Err(MarginError::InsufficientCollateral);
            }
            a.collateral -= amount;
            Ok(())
        })
    }

    /// Borrow against collateral, enforcing the LTV limit.
    pub fn borrow(&self, user_id: &str, amount: f64) -> Result<MarginAccount, MarginError> {
        Self::validate(amount)?;
        self.mutate(user_id, |a| {
            if a.debt + amount > a.collateral * self.params.max_ltv {
                return Err(MarginError::ExceedsBorrowLimit);
            }
            a.debt += amount;
            Ok(())
        })
    }

    /// Repay debt. Repayment is capped at the outstanding debt.
    pub fn repay(&self, user_id: &str, amount: f64) -> Result<MarginAccount, MarginError> {
        Self::validate(amount)?;
        self.mutate(user_id, |a| {
            a.debt = (a.debt - amount).max(0.0);
            Ok(())
        })
    }

    /// Accrue interest on the outstanding debt for `hours`.
    pub fn accrue_interest(&self, user_id: &str, hours: u32) -> Result<MarginAccount, MarginError> {
        self.mutate(user_id, |a| {
            a.debt *= (1.0 + self.params.hourly_interest_rate).powi(hours as i32);
            Ok(())
        })
    }

    /// Health factor: below 1.0 means the account can be liquidated.
    pub fn health_factor(&self, user_id: &str) -> Result<f64, MarginError> {
        let accounts = self.accounts.read().unwrap();
        let account = accounts
            .get(user_id)
            .ok_or_else(|| MarginError::AccountNotFound(user_id.to_string()))?;

        if account.debt == 0.0 {
            return Ok(f64::INFINITY);
        }
        Ok((account.collateral * self.params.liquidation_threshold) / account.debt)
    }

    pub fn is_liquidatable(&self, user_id: &str) -> Result<bool, MarginError> {
        Ok(self.health_factor(user_id)? < 1.0)
    }

    /// Liquidate an underwater account, returning the collateral seized to
    /// cover the debt.
    pub fn liquidate(&self, user_id: &str) -> Result<f64, MarginError> {
        if !self.is_liquidatable(user_id)? {
            return Err(MarginError::NotLiquidatable);
        }
        let mut seized = 0.0;
        self.mutate(user_id, |a| {
            seized = a.debt.min(a.collateral);
            a.collateral -= seized;
            a.debt -= seized;
            Ok(())
        })?;
        Ok(seized)
    }

    pub fn get_account(&self, user_id: &str) -> Result<MarginAccount, MarginError> {
        self.accounts
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .ok_or_else(|| MarginError::AccountNotFound(user_id.to_string()))
    }

    /// Apply a mutation, refresh the derived margin ratio, and return the
    /// updated account.
    fn mutate<F>(&self, user_id: &str, f: F) -> Result<MarginAccount, MarginError>
    where
        F: FnOnce(&mut MarginAccount) -> Result<(), MarginError>,
    {
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts
            .get_mut(user_id)
            .ok_or_else(|| MarginError::AccountNotFound(user_id.to_string()))?;

        f(account)?;
        account.margin_ratio = if account.collateral > 0.0 {
            account.debt / account.collateral
        } else if account.debt > 0.0 {
            f64::INFINITY
        } else {
            0.0
        };
        Ok(account.clone())
    }
}

impl Default for MarginService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> MarginService {
        let svc = MarginService::new();
        svc.open_account("u1").unwrap();
        svc
    }

    #[test]
    fn negative_and_non_finite_amounts_are_rejected() {
        let svc = service();
        // The old implementation accepted these and moved balances the wrong way.
        assert!(svc.deposit("u1", -100.0).is_err());
        assert!(svc.borrow("u1", -100.0).is_err());
        assert!(svc.deposit("u1", f64::NAN).is_err());
    }

    #[test]
    fn borrow_is_limited_by_ltv() {
        let svc = service();
        svc.deposit("u1", 1_000.0).unwrap();

        // 80% LTV on 1,000 collateral allows exactly 800.
        svc.borrow("u1", 800.0).unwrap();
        assert_eq!(
            svc.borrow("u1", 1.0).unwrap_err(),
            MarginError::ExceedsBorrowLimit
        );
    }

    #[test]
    fn margin_ratio_is_maintained() {
        let svc = service();
        svc.deposit("u1", 1_000.0).unwrap();
        svc.borrow("u1", 500.0).unwrap();

        assert!((svc.get_account("u1").unwrap().margin_ratio - 0.5).abs() < 1e-12);
    }

    #[test]
    fn interest_accrues_on_debt_only() {
        let svc = service();
        svc.deposit("u1", 10_000.0).unwrap();
        svc.borrow("u1", 1_000.0).unwrap();

        let before = svc.get_account("u1").unwrap();
        let after = svc.accrue_interest("u1", 24).unwrap();

        assert!(after.debt > before.debt);
        assert_eq!(after.collateral, before.collateral);
    }

    #[test]
    fn underwater_account_is_liquidatable() {
        let svc = service();
        svc.deposit("u1", 1_000.0).unwrap();
        svc.borrow("u1", 800.0).unwrap();

        assert!(!svc.is_liquidatable("u1").unwrap());
        assert_eq!(
            svc.liquidate("u1").unwrap_err(),
            MarginError::NotLiquidatable
        );

        // Collateral falls to 850: 850 * 0.9 = 765 < 800 debt.
        svc.deposit("u1", 0.0).ok();
        let mut accounts = svc.accounts.write().unwrap();
        accounts.get_mut("u1").unwrap().collateral = 850.0;
        drop(accounts);

        assert!(svc.is_liquidatable("u1").unwrap());
        let seized = svc.liquidate("u1").unwrap();
        assert!((seized - 800.0).abs() < 1e-9);
        assert_eq!(svc.get_account("u1").unwrap().debt, 0.0);
    }

    #[test]
    fn withdrawal_cannot_drop_below_the_liquidation_threshold() {
        let svc = service();
        svc.deposit("u1", 1_000.0).unwrap();
        svc.borrow("u1", 800.0).unwrap();

        // Needs collateral >= 800 / 0.9 = 888.9.
        assert_eq!(
            svc.withdraw("u1", 200.0).unwrap_err(),
            MarginError::InsufficientCollateral
        );
        svc.withdraw("u1", 100.0).unwrap();
    }

    #[test]
    fn repay_is_capped_at_the_debt() {
        let svc = service();
        svc.deposit("u1", 1_000.0).unwrap();
        svc.borrow("u1", 500.0).unwrap();

        let account = svc.repay("u1", 10_000.0).unwrap();
        assert_eq!(account.debt, 0.0);
    }
}
