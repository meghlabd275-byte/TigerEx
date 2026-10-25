//! Collateral management.
//!
//! The previous implementation had two defects. `available` summed balances of
//! every asset 1:1, treating 1 BTC as equal to 1 USDT, and it matched users by
//! key prefix, so a user named "alice" also summed the collateral of "alice2"
//! because the composite key "alice2_BTC" starts with "alice".

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum CollateralError {
    InvalidAmount(f64),
    UnknownAsset(String),
    InsufficientCollateral,
}

impl std::fmt::Display for CollateralError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CollateralError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            CollateralError::UnknownAsset(a) => write!(f, "no price configured for asset {a}"),
            CollateralError::InsufficientCollateral => write!(f, "insufficient collateral"),
        }
    }
}

impl std::error::Error for CollateralError {}

pub struct CollateralService {
    /// user -> asset -> amount.
    positions: RwLock<HashMap<String, HashMap<String, f64>>>,
    /// asset -> USD price.
    prices: RwLock<HashMap<String, f64>>,
    /// asset -> loan-to-value haircut applied when valuing collateral.
    ltv: RwLock<HashMap<String, f64>>,
}

impl CollateralService {
    pub fn new() -> Self {
        Self {
            positions: RwLock::new(HashMap::new()),
            prices: RwLock::new(HashMap::new()),
            ltv: RwLock::new(HashMap::new()),
        }
    }

    /// Register a price and LTV haircut for an asset.
    pub fn set_price(&self, asset: &str, usd_price: f64) -> Result<(), CollateralError> {
        if !usd_price.is_finite() || usd_price <= 0.0 {
            return Err(CollateralError::InvalidAmount(usd_price));
        }
        self.prices
            .write()
            .unwrap()
            .insert(asset.to_uppercase(), usd_price);
        Ok(())
    }

    pub fn set_ltv(&self, asset: &str, ltv: f64) -> Result<(), CollateralError> {
        if !ltv.is_finite() || ltv <= 0.0 || ltv > 1.0 {
            return Err(CollateralError::InvalidAmount(ltv));
        }
        self.ltv
            .write()
            .unwrap()
            .insert(asset.to_uppercase(), ltv);
        Ok(())
    }

    /// Add collateral. Requires the asset to have a configured price.
    pub fn post(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), CollateralError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(CollateralError::InvalidAmount(amount));
        }
        let asset = asset.to_uppercase();
        if !self.prices.read().unwrap().contains_key(&asset) {
            return Err(CollateralError::UnknownAsset(asset));
        }

        let mut positions = self.positions.write().unwrap();
        *positions
            .entry(user_id.to_string())
            .or_default()
            .entry(asset)
            .or_insert(0.0) += amount;
        Ok(())
    }

    /// Remove collateral.
    pub fn withdraw(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), CollateralError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(CollateralError::InvalidAmount(amount));
        }
        let asset = asset.to_uppercase();

        let mut positions = self.positions.write().unwrap();
        let holding = positions
            .get_mut(user_id)
            .and_then(|assets| assets.get_mut(&asset))
            .ok_or(CollateralError::InsufficientCollateral)?;

        if *holding < amount {
            return Err(CollateralError::InsufficientCollateral);
        }
        *holding -= amount;
        Ok(())
    }

    /// Raw balance of one asset for one user.
    pub fn balance_of(&self, user_id: &str, asset: &str) -> f64 {
        self.positions
            .read()
            .unwrap()
            .get(user_id)
            .and_then(|assets| assets.get(&asset.to_uppercase()))
            .copied()
            .unwrap_or(0.0)
    }

    /// USD value of a user's collateral, after per-asset LTV haircuts.
    ///
    /// Assets without a configured price are excluded rather than valued 1:1.
    pub fn available(&self, user_id: &str) -> Result<f64, CollateralError> {
        let positions = self.positions.read().unwrap();
        let prices = self.prices.read().unwrap();
        let ltv = self.ltv.read().unwrap();

        let Some(assets) = positions.get(user_id) else {
            return Ok(0.0);
        };

        let mut total = 0.0;
        for (asset, amount) in assets {
            let Some(price) = prices.get(asset) else {
                return Err(CollateralError::UnknownAsset(asset.clone()));
            };
            let haircut = ltv.get(asset).copied().unwrap_or(1.0);
            total += amount * price * haircut;
        }
        Ok(total)
    }
}

impl Default for CollateralService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> CollateralService {
        let svc = CollateralService::new();
        svc.set_price("BTC", 50_000.0).unwrap();
        svc.set_price("USDT", 1.0).unwrap();
        svc.set_ltv("BTC", 0.7).unwrap();
        svc
    }

    #[test]
    fn balances_do_not_leak_across_similar_user_ids() {
        let svc = service();
        svc.post("alice", "USDT", 100.0).unwrap();
        svc.post("alice2", "USDT", 999.0).unwrap();

        // The old prefix match counted "alice2_USDT" for "alice".
        assert_eq!(svc.available("alice").unwrap(), 100.0);
        assert_eq!(svc.available("alice2").unwrap(), 999.0);
    }

    #[test]
    fn assets_are_valued_with_price_and_ltv_not_one_to_one() {
        let svc = service();
        svc.post("u1", "BTC", 1.0).unwrap();
        svc.post("u1", "USDT", 1_000.0).unwrap();

        // 1 BTC at 50,000 with a 0.7 haircut plus 1,000 USDT at par.
        assert_eq!(svc.available("u1").unwrap(), 35_000.0 + 1_000.0);
    }

    #[test]
    fn unvalued_assets_are_not_counted() {
        let svc = service();
        // No price configured for DOGE, so it cannot be posted at all.
        assert_eq!(
            svc.post("u1", "DOGE", 100.0).unwrap_err(),
            CollateralError::UnknownAsset("DOGE".to_string())
        );
    }

    #[test]
    fn invalid_amounts_and_prices_are_rejected() {
        let svc = service();
        assert!(svc.post("u1", "BTC", -1.0).is_err());
        assert!(svc.post("u1", "BTC", f64::NAN).is_err());
        assert!(svc.set_price("ETH", 0.0).is_err());
        assert!(svc.set_ltv("ETH", 1.5).is_err());
    }

    #[test]
    fn withdrawal_cannot_exceed_the_holding() {
        let svc = service();
        svc.post("u1", "USDT", 100.0).unwrap();

        assert_eq!(
            svc.withdraw("u1", "USDT", 150.0).unwrap_err(),
            CollateralError::InsufficientCollateral
        );
        svc.withdraw("u1", "USDT", 100.0).unwrap();
        assert_eq!(svc.balance_of("u1", "USDT"), 0.0);
    }
}
