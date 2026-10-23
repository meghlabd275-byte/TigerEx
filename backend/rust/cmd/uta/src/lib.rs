//! Unified Trading Account (UTA) for TigerEx.
//!
//! A single collateral pool backs positions across products. Margin
//! requirements are computed from each position's notional and leverage, and
//! opening a position is refused when the pool cannot cover it.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct UTAPosition {
    pub id: String,
    pub product: String,
    pub asset: String,
    pub size: f64,
    pub notional: f64,
    pub leverage: u32,
    /// Margin locked for this position.
    pub margin: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UTAAccount {
    pub user_id: String,
    pub portfolio_value: f64,
    pub cross_margin_used: f64,
    pub positions: Vec<UTAPosition>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UtaError {
    EmptyUserId,
    InvalidSize(f64),
    InvalidNotional(f64),
    InvalidLeverage(u32),
    InsufficientCollateral { required: f64, available: f64 },
    UnknownPosition(String),
}

impl std::fmt::Display for UtaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UtaError::EmptyUserId => write!(f, "user_id must not be empty"),
            UtaError::InvalidSize(size) => write!(f, "size {size} must be positive and finite"),
            UtaError::InvalidNotional(notional) => {
                write!(f, "notional {notional} must be positive and finite")
            }
            UtaError::InvalidLeverage(leverage) => {
                write!(f, "leverage {leverage} is out of range")
            }
            UtaError::InsufficientCollateral { required, available } => write!(
                f,
                "insufficient collateral: required {required}, available {available}"
            ),
            UtaError::UnknownPosition(id) => write!(f, "unknown position: {id}"),
        }
    }
}

impl std::error::Error for UtaError {}

pub struct UTAService {
    accounts: RwLock<HashMap<String, UTAAccount>>,
    max_leverage: u32,
}

impl Default for UTAService {
    fn default() -> Self {
        Self::new()
    }
}

impl UTAService {
    pub fn new() -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            max_leverage: 10,
        }
    }

    /// Credit collateral to the unified pool.
    pub fn deposit(&self, user_id: &str, amount: f64) -> Result<f64, UtaError> {
        if user_id.trim().is_empty() {
            return Err(UtaError::EmptyUserId);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(UtaError::InvalidNotional(amount));
        }

        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.entry(user_id.to_string()).or_insert(UTAAccount {
            user_id: user_id.to_string(),
            portfolio_value: 0.0,
            cross_margin_used: 0.0,
            positions: Vec::new(),
        });
        account.portfolio_value += amount;
        Ok(account.portfolio_value)
    }

    pub fn open_position(
        &self,
        user_id: &str,
        product: &str,
        asset: &str,
        size: f64,
        notional: f64,
        leverage: u32,
    ) -> Result<UTAPosition, UtaError> {
        if user_id.trim().is_empty() {
            return Err(UtaError::EmptyUserId);
        }
        if !size.is_finite() || size <= 0.0 {
            return Err(UtaError::InvalidSize(size));
        }
        if !notional.is_finite() || notional <= 0.0 {
            return Err(UtaError::InvalidNotional(notional));
        }
        if leverage == 0 || leverage > self.max_leverage {
            return Err(UtaError::InvalidLeverage(leverage));
        }

        let margin = notional / leverage as f64;

        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.entry(user_id.to_string()).or_insert(UTAAccount {
            user_id: user_id.to_string(),
            portfolio_value: 0.0,
            cross_margin_used: 0.0,
            positions: Vec::new(),
        });

        let available = account.portfolio_value - account.cross_margin_used;
        if margin > available {
            return Err(UtaError::InsufficientCollateral {
                required: margin,
                available,
            });
        }

        let position = UTAPosition {
            id: format!("pos_{}", account.positions.len()),
            product: product.to_string(),
            asset: asset.to_string(),
            size,
            notional,
            leverage,
            margin,
        };

        account.cross_margin_used += margin;
        account.positions.push(position.clone());
        Ok(position)
    }

    pub fn close_position(&self, user_id: &str, position_id: &str) -> Result<(), UtaError> {
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts.get_mut(user_id).ok_or(UtaError::EmptyUserId)?;

        let index = account
            .positions
            .iter()
            .position(|p| p.id == position_id)
            .ok_or_else(|| UtaError::UnknownPosition(position_id.to_string()))?;

        let position = account.positions.remove(index);
        account.cross_margin_used -= position.margin;
        Ok(())
    }

    pub fn account(&self, user_id: &str) -> Option<UTAAccount> {
        self.accounts.read().unwrap().get(user_id).cloned()
    }

    pub fn get_portfolio_value(&self, user_id: &str) -> f64 {
        self.accounts
            .read()
            .unwrap()
            .get(user_id)
            .map(|a| a.portfolio_value)
            .unwrap_or(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_inputs() {
        let service = UTAService::new();
        assert_eq!(service.deposit("", 100.0).unwrap_err(), UtaError::EmptyUserId);
        assert!(matches!(
            service.open_position("u1", "perp", "BTC", 0.0, 1000.0, 5).unwrap_err(),
            UtaError::InvalidSize(_)
        ));
        assert!(matches!(
            service.open_position("u1", "perp", "BTC", 1.0, 1000.0, 0).unwrap_err(),
            UtaError::InvalidLeverage(0)
        ));
        assert!(matches!(
            service.open_position("u1", "perp", "BTC", 1.0, 1000.0, 50).unwrap_err(),
            UtaError::InvalidLeverage(50)
        ));
    }

    #[test]
    fn margin_is_notional_over_leverage() {
        let service = UTAService::new();
        service.deposit("u1", 1000.0).unwrap();
        let position = service
            .open_position("u1", "perp", "BTC", 1.0, 500.0, 5)
            .unwrap();
        assert!((position.margin - 100.0).abs() < 1e-9);
        assert!((service.account("u1").unwrap().cross_margin_used - 100.0).abs() < 1e-9);
    }

    #[test]
    fn refuses_positions_beyond_collateral() {
        let service = UTAService::new();
        service.deposit("u1", 100.0).unwrap();
        assert!(matches!(
            service
                .open_position("u1", "perp", "BTC", 1.0, 10_000.0, 2)
                .unwrap_err(),
            UtaError::InsufficientCollateral { .. }
        ));
    }

    #[test]
    fn closing_releases_margin() {
        let service = UTAService::new();
        service.deposit("u1", 1000.0).unwrap();
        let position = service
            .open_position("u1", "perp", "BTC", 1.0, 500.0, 5)
            .unwrap();

        service.close_position("u1", &position.id).unwrap();
        assert!((service.account("u1").unwrap().cross_margin_used).abs() < 1e-9);
        assert!(matches!(
            service.close_position("u1", "missing").unwrap_err(),
            UtaError::UnknownPosition(_)
        ));
    }
}
