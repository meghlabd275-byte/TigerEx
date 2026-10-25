//! Yield strategy selection and allocation.
//!
//! The previous implementation panicked on an empty strategy set
//! (`max_by(...).unwrap()`), and `invest` returned a formatted string without
//! recording anything, accepting any amount.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct YieldStrategy {
    pub id: String,
    pub protocol: String,
    pub asset: String,
    /// Annualised yield as a fraction, e.g. 0.08 for 8%.
    pub apy: f64,
    /// Total value locked in the strategy.
    pub tvl: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub user_id: String,
    pub strategy_id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum YieldError {
    EmptyProtocol,
    EmptyAsset,
    InvalidApy(f64),
    InvalidTvl(f64),
    InvalidAmount(f64),
    UnknownStrategy(String),
    NoStrategies,
}

impl std::fmt::Display for YieldError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            YieldError::EmptyProtocol => write!(f, "protocol must not be empty"),
            YieldError::EmptyAsset => write!(f, "asset must not be empty"),
            YieldError::InvalidApy(a) => write!(f, "apy {a} must be finite and non-negative"),
            YieldError::InvalidTvl(t) => write!(f, "tvl {t} must be finite and non-negative"),
            YieldError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            YieldError::UnknownStrategy(id) => write!(f, "unknown strategy: {id}"),
            YieldError::NoStrategies => write!(f, "no strategies available for this asset"),
        }
    }
}

impl std::error::Error for YieldError {}

pub struct YieldOptimizerService {
    strategies: RwLock<HashMap<String, YieldStrategy>>,
    positions: RwLock<Vec<Position>>,
    next_id: RwLock<u64>,
}

impl YieldOptimizerService {
    pub fn new() -> Self {
        Self {
            strategies: RwLock::new(HashMap::new()),
            positions: RwLock::new(Vec::new()),
            next_id: RwLock::new(1),
        }
    }

    pub fn register_strategy(
        &self,
        protocol: &str,
        asset: &str,
        apy: f64,
        tvl: f64,
    ) -> Result<String, YieldError> {
        if protocol.trim().is_empty() {
            return Err(YieldError::EmptyProtocol);
        }
        if asset.trim().is_empty() {
            return Err(YieldError::EmptyAsset);
        }
        if !apy.is_finite() || apy < 0.0 {
            return Err(YieldError::InvalidApy(apy));
        }
        if !tvl.is_finite() || tvl < 0.0 {
            return Err(YieldError::InvalidTvl(tvl));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("ys_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.strategies.write().unwrap().insert(
            id.clone(),
            YieldStrategy {
                id: id.clone(),
                protocol: protocol.to_string(),
                asset: asset.to_string(),
                apy,
                tvl,
            },
        );
        Ok(id)
    }

    /// Best strategy for an asset by APY. Errors rather than panicking when
    /// none exist.
    pub fn find_best(&self, asset: &str) -> Result<YieldStrategy, YieldError> {
        self.strategies
            .read()
            .unwrap()
            .values()
            .filter(|s| s.asset == asset)
            .max_by(|a, b| a.apy.partial_cmp(&b.apy).unwrap_or(std::cmp::Ordering::Equal))
            .cloned()
            .ok_or(YieldError::NoStrategies)
    }

    /// Allocate capital to a strategy, recording the position.
    pub fn invest(
        &self,
        user_id: &str,
        strategy_id: &str,
        amount: f64,
    ) -> Result<Position, YieldError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(YieldError::InvalidAmount(amount));
        }
        if !self.strategies.read().unwrap().contains_key(strategy_id) {
            return Err(YieldError::UnknownStrategy(strategy_id.to_string()));
        }

        let position = Position {
            user_id: user_id.to_string(),
            strategy_id: strategy_id.to_string(),
            amount,
        };
        self.positions.write().unwrap().push(position.clone());
        Ok(position)
    }

    /// Total capital a user has allocated across strategies.
    pub fn total_invested(&self, user_id: &str) -> f64 {
        self.positions
            .read()
            .unwrap()
            .iter()
            .filter(|p| p.user_id == user_id)
            .map(|p| p.amount)
            .sum()
    }

    pub fn positions_for(&self, user_id: &str) -> Vec<Position> {
        self.positions
            .read()
            .unwrap()
            .iter()
            .filter(|p| p.user_id == user_id)
            .cloned()
            .collect()
    }

    pub fn strategy(&self, id: &str) -> Option<YieldStrategy> {
        self.strategies.read().unwrap().get(id).cloned()
    }
}

impl Default for YieldOptimizerService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_best_strategy_is_the_highest_apy_for_the_asset() {
        let svc = YieldOptimizerService::new();
        svc.register_strategy("A", "USDT", 0.05, 1_000_000.0).unwrap();
        let best = svc.register_strategy("B", "USDT", 0.09, 500_000.0).unwrap();
        // A different asset must not win.
        svc.register_strategy("C", "ETH", 0.20, 500_000.0).unwrap();

        assert_eq!(svc.find_best("USDT").unwrap().id, best);
    }

    #[test]
    fn finding_best_with_no_strategies_errors_instead_of_panicking() {
        let svc = YieldOptimizerService::new();
        // The old implementation called unwrap() on the max_by result.
        assert!(matches!(
            svc.find_best("USDT").unwrap_err(),
            YieldError::NoStrategies
        ));
    }

    #[test]
    fn investing_records_a_position() {
        let svc = YieldOptimizerService::new();
        let id = svc.register_strategy("A", "USDT", 0.05, 1_000_000.0).unwrap();

        svc.invest("u1", &id, 1_000.0).unwrap();
        // The old implementation returned a string and recorded nothing.
        assert_eq!(svc.total_invested("u1"), 1_000.0);
        assert_eq!(svc.positions_for("u1").len(), 1);
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = YieldOptimizerService::new();
        assert!(svc.register_strategy("", "USDT", 0.05, 1.0).is_err());
        assert!(svc.register_strategy("A", "", 0.05, 1.0).is_err());
        assert!(svc.register_strategy("A", "USDT", -0.05, 1.0).is_err());
        assert!(svc.register_strategy("A", "USDT", f64::NAN, 1.0).is_err());

        let id = svc.register_strategy("A", "USDT", 0.05, 1.0).unwrap();
        assert!(svc.invest("u1", &id, -1.0).is_err());
        assert!(svc.invest("u1", &id, f64::NAN).is_err());
        assert!(svc.invest("u1", "ys_missing", 1.0).is_err());
        assert_eq!(svc.total_invested("u1"), 0.0);
    }
}
