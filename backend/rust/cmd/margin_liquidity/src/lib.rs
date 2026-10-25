//! Margin liquidity pools with a utilisation-based interest rate.
//!
//! The previous implementation accepted negative and NaN amounts (a negative
//! supply reduced the pool, a negative borrow increased its headroom) and
//! reported a constant 5% rate regardless of utilisation.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct LiquidityPool {
    pub asset: String,
    pub supplied: f64,
    pub borrowed: f64,
    /// Current annualised borrow rate as a fraction.
    pub rate: f64,
    /// Base rate at zero utilisation.
    pub base_rate: f64,
    /// Slope added as utilisation rises to one.
    pub slope: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LiquidityError {
    InvalidAmount(f64),
    PoolNotFound(String),
    InsufficientLiquidity { available: f64 },
    InvalidRate(f64),
}

impl std::fmt::Display for LiquidityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LiquidityError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            LiquidityError::PoolNotFound(a) => write!(f, "no pool for {a}"),
            LiquidityError::InsufficientLiquidity { available } => {
                write!(f, "pool only has {available} available")
            }
            LiquidityError::InvalidRate(r) => write!(f, "rate {r} must be finite and non-negative"),
        }
    }
}

impl std::error::Error for LiquidityError {}

pub struct MarginLiquidityService {
    pools: RwLock<HashMap<String, LiquidityPool>>,
}

impl MarginLiquidityService {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
        }
    }

    /// Create a pool with an explicit rate model.
    pub fn create_pool(
        &self,
        asset: &str,
        base_rate: f64,
        slope: f64,
    ) -> Result<(), LiquidityError> {
        if !base_rate.is_finite() || base_rate < 0.0 {
            return Err(LiquidityError::InvalidRate(base_rate));
        }
        if !slope.is_finite() || slope < 0.0 {
            return Err(LiquidityError::InvalidRate(slope));
        }
        self.pools.write().unwrap().insert(
            asset.to_string(),
            LiquidityPool {
                asset: asset.to_string(),
                supplied: 0.0,
                borrowed: 0.0,
                rate: base_rate,
                base_rate,
                slope,
            },
        );
        Ok(())
    }

    /// Utilisation in [0, 1]. An empty pool is fully idle.
    fn utilisation(pool: &LiquidityPool) -> f64 {
        if pool.supplied <= 0.0 {
            0.0
        } else {
            (pool.borrowed / pool.supplied).clamp(0.0, 1.0)
        }
    }

    /// Supply liquidity. The rate is recomputed from the new utilisation.
    pub fn supply(&self, asset: &str, amount: f64) -> Result<(), LiquidityError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(LiquidityError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools
            .get_mut(asset)
            .ok_or_else(|| LiquidityError::PoolNotFound(asset.to_string()))?;
        pool.supplied += amount;
        pool.rate = pool.base_rate + pool.slope * Self::utilisation(pool);
        Ok(())
    }

    /// Borrow liquidity. Refuses to lend more than the pool holds idle.
    pub fn borrow(&self, asset: &str, amount: f64) -> Result<(), LiquidityError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(LiquidityError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools
            .get_mut(asset)
            .ok_or_else(|| LiquidityError::PoolNotFound(asset.to_string()))?;

        let available = pool.supplied - pool.borrowed;
        if available < amount {
            return Err(LiquidityError::InsufficientLiquidity { available });
        }
        pool.borrowed += amount;
        pool.rate = pool.base_rate + pool.slope * Self::utilisation(pool);
        Ok(())
    }

    /// Repay borrowed liquidity.
    pub fn repay(&self, asset: &str, amount: f64) -> Result<(), LiquidityError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(LiquidityError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools
            .get_mut(asset)
            .ok_or_else(|| LiquidityError::PoolNotFound(asset.to_string()))?;
        pool.borrowed = (pool.borrowed - amount).max(0.0);
        pool.rate = pool.base_rate + pool.slope * Self::utilisation(pool);
        Ok(())
    }

    pub fn pool(&self, asset: &str) -> Option<LiquidityPool> {
        self.pools.read().unwrap().get(asset).cloned()
    }

    /// Available (idle) liquidity in a pool.
    pub fn available(&self, asset: &str) -> f64 {
        self.pools
            .read()
            .unwrap()
            .get(asset)
            .map(|p| (p.supplied - p.borrowed).max(0.0))
            .unwrap_or(0.0)
    }
}

impl Default for MarginLiquidityService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> MarginLiquidityService {
        let svc = MarginLiquidityService::new();
        svc.create_pool("USDT", 0.02, 0.30).unwrap();
        svc
    }

    #[test]
    fn the_rate_rises_with_utilisation() {
        let svc = pool();
        svc.supply("USDT", 1_000.0).unwrap();
        // Idle pool: base rate only.
        assert_eq!(svc.pool("USDT").unwrap().rate, 0.02);

        svc.borrow("USDT", 500.0).unwrap();
        // 50% utilisation -> 0.02 + 0.30 * 0.5.
        assert!((svc.pool("USDT").unwrap().rate - 0.17).abs() < 1e-12);
    }

    #[test]
    fn negative_and_non_finite_amounts_are_rejected() {
        let svc = pool();
        // The old implementation accepted all of these.
        assert!(svc.supply("USDT", -1.0).is_err());
        assert!(svc.supply("USDT", f64::NAN).is_err());
        assert!(svc.borrow("USDT", -1.0).is_err());
        assert!(svc.borrow("USDT", f64::NAN).is_err());
        assert_eq!(svc.pool("USDT").unwrap().supplied, 0.0);
    }

    #[test]
    fn borrowing_beyond_idle_liquidity_is_rejected() {
        let svc = pool();
        svc.supply("USDT", 100.0).unwrap();

        assert!(matches!(
            svc.borrow("USDT", 150.0).unwrap_err(),
            LiquidityError::InsufficientLiquidity { .. }
        ));
        assert_eq!(svc.available("USDT"), 100.0);
    }

    #[test]
    fn repayment_restores_availability() {
        let svc = pool();
        svc.supply("USDT", 100.0).unwrap();
        svc.borrow("USDT", 100.0).unwrap();
        assert_eq!(svc.available("USDT"), 0.0);

        svc.repay("USDT", 40.0).unwrap();
        assert_eq!(svc.available("USDT"), 40.0);
        assert_eq!(svc.pool("USDT").unwrap().borrowed, 60.0);
    }

    #[test]
    fn unknown_pools_are_rejected() {
        let svc = pool();
        assert!(svc.supply("NOPE", 1.0).is_err());
        assert!(svc.borrow("NOPE", 1.0).is_err());
    }
}
