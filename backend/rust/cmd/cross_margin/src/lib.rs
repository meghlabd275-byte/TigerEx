//! Cross-margin portfolio exposure.
//!
//! The previous implementation hardcoded a 10% margin requirement for every
//! product, accepted any value including negative and NaN (which inflated the
//! portfolio value and, because NaN propagates, silently poisoned the total),
//! and had no way to remove a position.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct PortfolioPosition {
    pub product: String,
    pub value: f64,
    pub margin_used: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CrossMarginError {
    InvalidValue(f64),
    InvalidMarginRatio(f64),
    UnknownProduct(String),
}

impl std::fmt::Display for CrossMarginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CrossMarginError::InvalidValue(v) => write!(f, "value {v} must be finite and positive"),
            CrossMarginError::InvalidMarginRatio(r) => {
                write!(f, "margin ratio {r} must be finite and within (0, 1]")
            }
            CrossMarginError::UnknownProduct(p) => write!(f, "no position for {p}"),
        }
    }
}

impl std::error::Error for CrossMarginError {}

pub struct CrossMarginService {
    portfolios: RwLock<HashMap<String, Vec<PortfolioPosition>>>,
    /// Default margin requirement per product, as a fraction of notional.
    margin_ratios: RwLock<HashMap<String, f64>>,
    default_margin_ratio: f64,
}

impl CrossMarginService {
    pub fn new() -> Self {
        Self {
            portfolios: RwLock::new(HashMap::new()),
            margin_ratios: RwLock::new(HashMap::new()),
            default_margin_ratio: 0.10,
        }
    }

    /// Set the margin requirement for a product.
    pub fn set_margin_ratio(&self, product: &str, ratio: f64) -> Result<(), CrossMarginError> {
        if !ratio.is_finite() || ratio <= 0.0 || ratio > 1.0 {
            return Err(CrossMarginError::InvalidMarginRatio(ratio));
        }
        self.margin_ratios
            .write()
            .unwrap()
            .insert(product.to_string(), ratio);
        Ok(())
    }

    /// Add a position to a user's portfolio.
    pub fn allocate(
        &self,
        user_id: &str,
        product: &str,
        value: f64,
    ) -> Result<PortfolioPosition, CrossMarginError> {
        if !value.is_finite() || value <= 0.0 {
            return Err(CrossMarginError::InvalidValue(value));
        }

        let ratio = self
            .margin_ratios
            .read()
            .unwrap()
            .get(product)
            .copied()
            .unwrap_or(self.default_margin_ratio);

        let position = PortfolioPosition {
            product: product.to_string(),
            value,
            margin_used: value * ratio,
        };

        self.portfolios
            .write()
            .unwrap()
            .entry(user_id.to_string())
            .or_default()
            .push(position.clone());
        Ok(position)
    }

    /// Remove a product from a user's portfolio.
    pub fn remove(&self, user_id: &str, product: &str) -> Result<PortfolioPosition, CrossMarginError> {
        let mut portfolios = self.portfolios.write().unwrap();
        let portfolio = portfolios
            .get_mut(user_id)
            .ok_or_else(|| CrossMarginError::UnknownProduct(product.to_string()))?;

        let pos = portfolio
            .iter()
            .position(|p| p.product == product)
            .ok_or_else(|| CrossMarginError::UnknownProduct(product.to_string()))?;
        Ok(portfolio.remove(pos))
    }

    /// Gross exposure across a user's portfolio.
    pub fn get_total_exposure(&self, user_id: &str) -> f64 {
        self.portfolios
            .read()
            .unwrap()
            .get(user_id)
            .map(|p| p.iter().map(|x| x.value).sum())
            .unwrap_or(0.0)
    }

    /// Total margin locked across a user's portfolio.
    pub fn total_margin_used(&self, user_id: &str) -> f64 {
        self.portfolios
            .read()
            .unwrap()
            .get(user_id)
            .map(|p| p.iter().map(|x| x.margin_used).sum())
            .unwrap_or(0.0)
    }

    pub fn positions(&self, user_id: &str) -> Vec<PortfolioPosition> {
        self.portfolios
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for CrossMarginService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn margin_used_reflects_the_product_ratio() {
        let svc = CrossMarginService::new();
        svc.set_margin_ratio("BTC-PERP", 0.05).unwrap();

        let pos = svc.allocate("u1", "BTC-PERP", 10_000.0).unwrap();
        assert_eq!(pos.margin_used, 500.0);

        // Unknown products fall back to the 10% default.
        let other = svc.allocate("u1", "ETH-PERP", 10_000.0).unwrap();
        assert_eq!(other.margin_used, 1_000.0);
    }

    #[test]
    fn invalid_values_and_ratios_are_rejected() {
        let svc = CrossMarginService::new();
        // The old implementation accepted all of these.
        assert!(svc.allocate("u1", "BTC", -1.0).is_err());
        assert!(svc.allocate("u1", "BTC", f64::NAN).is_err());
        assert!(svc.set_margin_ratio("BTC", 0.0).is_err());
        assert!(svc.set_margin_ratio("BTC", 1.5).is_err());
        assert_eq!(svc.get_total_exposure("u1"), 0.0);
    }

    #[test]
    fn totals_sum_positions() {
        let svc = CrossMarginService::new();
        svc.allocate("u1", "BTC", 10_000.0).unwrap();
        svc.allocate("u1", "ETH", 5_000.0).unwrap();

        assert_eq!(svc.get_total_exposure("u1"), 15_000.0);
        assert_eq!(svc.total_margin_used("u1"), 1_500.0);
    }

    #[test]
    fn positions_can_be_removed() {
        let svc = CrossMarginService::new();
        svc.allocate("u1", "BTC", 10_000.0).unwrap();

        let removed = svc.remove("u1", "BTC").unwrap();
        assert_eq!(removed.value, 10_000.0);
        assert_eq!(svc.get_total_exposure("u1"), 0.0);
        assert!(svc.remove("u1", "BTC").is_err());
    }
}
