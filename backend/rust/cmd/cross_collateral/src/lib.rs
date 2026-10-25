//! Cross-collateral credit.
//!
//! The previous implementation applied a fixed 1.5 multiplier to every asset,
//! so a user's borrowing power was reported as 150% of the collateral they had
//! posted, and it accepted negative and NaN values.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Collateral {
    pub asset: String,
    pub value: f64,
    /// Loan-to-value fraction: the share of the asset's value that counts
    /// toward borrowing power.
    pub collateral_ratio: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CrossCollateralError {
    InvalidValue(f64),
    InvalidRatio(f64),
    UnknownAsset(String),
}

impl std::fmt::Display for CrossCollateralError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CrossCollateralError::InvalidValue(v) => write!(f, "value {v} must be finite and positive"),
            CrossCollateralError::InvalidRatio(r) => {
                write!(f, "ratio {r} must be finite and within (0, 1]")
            }
            CrossCollateralError::UnknownAsset(a) => write!(f, "no collateral for {a}"),
        }
    }
}

impl std::error::Error for CrossCollateralError {}

pub struct CrossCollateralService {
    positions: RwLock<HashMap<String, Vec<Collateral>>>,
    /// Per-asset LTV. Unlisted assets use the default.
    ratios: RwLock<HashMap<String, f64>>,
    default_ratio: f64,
}

impl CrossCollateralService {
    pub fn new() -> Self {
        Self {
            positions: RwLock::new(HashMap::new()),
            ratios: RwLock::new(HashMap::new()),
            default_ratio: 0.8,
        }
    }

    /// Set the LTV for an asset. A ratio above 1.0 is rejected: collateral
    /// must never be worth more than its market value.
    pub fn set_ratio(&self, asset: &str, ratio: f64) -> Result<(), CrossCollateralError> {
        if !ratio.is_finite() || ratio <= 0.0 || ratio > 1.0 {
            return Err(CrossCollateralError::InvalidRatio(ratio));
        }
        self.ratios.write().unwrap().insert(asset.to_string(), ratio);
        Ok(())
    }

    pub fn add_collateral(
        &self,
        user_id: &str,
        asset: &str,
        value: f64,
    ) -> Result<(), CrossCollateralError> {
        if !value.is_finite() || value <= 0.0 {
            return Err(CrossCollateralError::InvalidValue(value));
        }

        let ratio = self
            .ratios
            .read()
            .unwrap()
            .get(asset)
            .copied()
            .unwrap_or(self.default_ratio);

        self.positions
            .write()
            .unwrap()
            .entry(user_id.to_string())
            .or_default()
            .push(Collateral {
                asset: asset.to_string(),
                value,
                collateral_ratio: ratio,
            });
        Ok(())
    }

    /// Total borrowing power: the sum of value times LTV.
    pub fn get_credit(&self, user_id: &str) -> f64 {
        self.positions
            .read()
            .unwrap()
            .get(user_id)
            .map(|c| c.iter().map(|x| x.value * x.collateral_ratio).sum())
            .unwrap_or(0.0)
    }

    /// Total posted collateral value.
    pub fn total_value(&self, user_id: &str) -> f64 {
        self.positions
            .read()
            .unwrap()
            .get(user_id)
            .map(|c| c.iter().map(|x| x.value).sum())
            .unwrap_or(0.0)
    }

    pub fn positions(&self, user_id: &str) -> Vec<Collateral> {
        self.positions
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for CrossCollateralService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credit_is_below_collateral_value() {
        let svc = CrossCollateralService::new();
        svc.set_ratio("BTC", 0.7).unwrap();
        svc.add_collateral("u1", "BTC", 10_000.0).unwrap();

        // The old implementation returned 15,000 for this (value * 1.5).
        assert_eq!(svc.get_credit("u1"), 7_000.0);
        assert!(svc.get_credit("u1") < svc.total_value("u1"));
    }

    #[test]
    fn ratios_above_one_are_rejected() {
        let svc = CrossCollateralService::new();
        assert!(svc.set_ratio("BTC", 1.5).is_err());
        assert!(svc.set_ratio("BTC", 0.0).is_err());
        assert!(svc.set_ratio("BTC", f64::NAN).is_err());
    }

    #[test]
    fn invalid_values_are_rejected() {
        let svc = CrossCollateralService::new();
        assert!(svc.add_collateral("u1", "BTC", -1.0).is_err());
        assert!(svc.add_collateral("u1", "BTC", f64::NAN).is_err());
        assert_eq!(svc.get_credit("u1"), 0.0);
    }

    #[test]
    fn credit_sums_across_assets_with_their_own_ratios() {
        let svc = CrossCollateralService::new();
        svc.set_ratio("BTC", 0.7).unwrap();
        svc.set_ratio("ETH", 0.6).unwrap();

        svc.add_collateral("u1", "BTC", 10_000.0).unwrap();
        svc.add_collateral("u1", "ETH", 5_000.0).unwrap();

        assert_eq!(svc.get_credit("u1"), 7_000.0 + 3_000.0);
        assert_eq!(svc.total_value("u1"), 15_000.0);
    }

    #[test]
    fn unlisted_assets_use_the_default_ratio() {
        let svc = CrossCollateralService::new();
        svc.add_collateral("u1", "SOL", 1_000.0).unwrap();
        assert_eq!(svc.get_credit("u1"), 800.0);
    }
}
