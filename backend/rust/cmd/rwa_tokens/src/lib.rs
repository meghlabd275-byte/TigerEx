//! Real-world asset tokens (gold, silver, tokenised treasuries).
//!
//! The previous implementation hardcoded metal prices (gold at $2,000/oz,
//! silver at $25/oz) and a 1.2 collateral ratio, so the notional value of a
//! minted token bore no relation to any real market and borrowing power
//! exceeded the token's value. Ids came from the asset count, so ids collided
//! once any asset was removed.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    Gold,
    Silver,
    UsTreasury,
}

impl AssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetKind::Gold => "gold",
            AssetKind::Silver => "silver",
            AssetKind::UsTreasury => "us_treasury",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RWAAsset {
    pub id: String,
    pub asset_type: String,
    /// Quantity of the underlying (ounces, or face value for treasuries).
    pub quantity: f64,
    /// Reference price per unit from the caller's oracle.
    pub unit_price: f64,
    /// Notional value: quantity times unit price.
    pub value: f64,
    /// Loan-to-value fraction, which must be within (0, 1].
    pub collateral_ratio: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RwaError {
    InvalidQuantity(f64),
    InvalidPrice(f64),
    InvalidCollateralRatio(f64),
    UnknownAsset(String),
}

impl std::fmt::Display for RwaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RwaError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
            RwaError::InvalidPrice(p) => write!(f, "unit price {p} must be finite and positive"),
            RwaError::InvalidCollateralRatio(r) => {
                write!(f, "collateral ratio {r} must be finite and within (0, 1]")
            }
            RwaError::UnknownAsset(id) => write!(f, "unknown asset: {id}"),
        }
    }
}

impl std::error::Error for RwaError {}

pub struct RWATokenService {
    assets: RwLock<HashMap<String, RWAAsset>>,
    /// LTV per asset kind.
    ratios: RwLock<HashMap<String, f64>>,
    next_id: RwLock<u64>,
}

impl RWATokenService {
    pub fn new() -> Self {
        Self {
            assets: RwLock::new(HashMap::new()),
            ratios: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Set the LTV for an asset kind. Rejects ratios above 1.0.
    pub fn set_collateral_ratio(&self, kind: AssetKind, ratio: f64) -> Result<(), RwaError> {
        if !ratio.is_finite() || ratio <= 0.0 || ratio > 1.0 {
            return Err(RwaError::InvalidCollateralRatio(ratio));
        }
        self.ratios
            .write()
            .unwrap()
            .insert(kind.as_str().to_string(), ratio);
        Ok(())
    }

    /// Mint an asset token from a real quantity and oracle price.
    pub fn mint(
        &self,
        kind: AssetKind,
        quantity: f64,
        unit_price: f64,
    ) -> Result<String, RwaError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(RwaError::InvalidQuantity(quantity));
        }
        if !unit_price.is_finite() || unit_price <= 0.0 {
            return Err(RwaError::InvalidPrice(unit_price));
        }

        let ratio = self
            .ratios
            .read()
            .unwrap()
            .get(kind.as_str())
            .copied()
            .unwrap_or(1.0);

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("{}_{}", kind.as_str(), *next_id);
        *next_id += 1;
        drop(next_id);

        self.assets.write().unwrap().insert(
            id.clone(),
            RWAAsset {
                id: id.clone(),
                asset_type: kind.as_str().to_string(),
                quantity,
                unit_price,
                value: quantity * unit_price,
                collateral_ratio: ratio,
            },
        );
        Ok(id)
    }

    pub fn asset(&self, id: &str) -> Option<RWAAsset> {
        self.assets.read().unwrap().get(id).cloned()
    }

    /// Borrowing power for an asset: value times its LTV.
    pub fn credit(&self, id: &str) -> Result<f64, RwaError> {
        let assets = self.assets.read().unwrap();
        let asset = assets
            .get(id)
            .ok_or_else(|| RwaError::UnknownAsset(id.to_string()))?;
        Ok(asset.value * asset.collateral_ratio)
    }

    /// Total notional value held.
    pub fn total_value(&self) -> f64 {
        self.assets.read().unwrap().values().map(|a| a.value).sum()
    }
}

impl Default for RWATokenService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_comes_from_the_supplied_price_not_a_constant() {
        let svc = RWATokenService::new();
        let id = svc.mint(AssetKind::Gold, 2.0, 2_400.0).unwrap();

        let asset = svc.asset(&id).unwrap();
        // The old implementation always valued gold at 2,000/oz.
        assert_eq!(asset.value, 4_800.0);
        assert_eq!(asset.unit_price, 2_400.0);
    }

    #[test]
    fn credit_never_exceeds_value() {
        let svc = RWATokenService::new();
        svc.set_collateral_ratio(AssetKind::Gold, 0.8).unwrap();
        let id = svc.mint(AssetKind::Gold, 1.0, 2_000.0).unwrap();

        // The old implementation reported 1.2x the value as credit.
        assert_eq!(svc.credit(&id).unwrap(), 1_600.0);
        assert!(svc.credit(&id).unwrap() < svc.asset(&id).unwrap().value);
    }

    #[test]
    fn ratios_above_one_are_rejected() {
        let svc = RWATokenService::new();
        assert!(svc.set_collateral_ratio(AssetKind::Gold, 1.2).is_err());
        assert!(svc.set_collateral_ratio(AssetKind::Gold, 0.0).is_err());
        assert!(svc.set_collateral_ratio(AssetKind::Gold, f64::NAN).is_err());
    }

    #[test]
    fn invalid_quantities_and_prices_are_rejected() {
        let svc = RWATokenService::new();
        assert!(svc.mint(AssetKind::Gold, -1.0, 2_000.0).is_err());
        assert!(svc.mint(AssetKind::Gold, 1.0, -2_000.0).is_err());
        assert!(svc.mint(AssetKind::Gold, f64::NAN, 2_000.0).is_err());
        assert_eq!(svc.total_value(), 0.0);
    }

    #[test]
    fn ids_are_unique_and_stable() {
        let svc = RWATokenService::new();
        let a = svc.mint(AssetKind::Gold, 1.0, 2_000.0).unwrap();
        let b = svc.mint(AssetKind::Gold, 1.0, 2_000.0).unwrap();
        // The old id was the asset count, so these collided.
        assert_ne!(a, b);
        assert!(svc.asset(&a).is_some());
        assert!(svc.asset(&b).is_some());
    }
}
