//! Gamma (delta-neutral) strategies.
//!
//! The previous implementation invented vega as `gamma * 0.5` and derived ids
//! from the strategy count (so ids were reused). Vega must come from the
//! caller's option model.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct GammaStrategy {
    pub id: String,
    /// Position delta: the underlying units needed to neutralise the book.
    pub delta: f64,
    /// Position gamma.
    pub gamma: f64,
    /// Position vega.
    pub vega: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GammaError {
    NonFinite(&'static str, f64),
    UnknownStrategy(String),
}

impl std::fmt::Display for GammaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GammaError::NonFinite(field, v) => write!(f, "{field} {v} must be finite"),
            GammaError::UnknownStrategy(id) => write!(f, "unknown strategy: {id}"),
        }
    }
}

impl std::error::Error for GammaError {}

pub struct GammaTradingService {
    strategies: RwLock<HashMap<String, GammaStrategy>>,
    next_id: RwLock<u64>,
}

impl GammaTradingService {
    pub fn new() -> Self {
        Self {
            strategies: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Register a strategy with the greeks from the caller's option model.
    pub fn create_gamma_strategy(
        &self,
        delta: f64,
        gamma: f64,
        vega: f64,
    ) -> Result<String, GammaError> {
        for (name, value) in [("delta", delta), ("gamma", gamma), ("vega", vega)] {
            if !value.is_finite() {
                return Err(GammaError::NonFinite(name, value));
            }
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("g_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.strategies.write().unwrap().insert(
            id.clone(),
            GammaStrategy {
                id: id.clone(),
                delta,
                gamma,
                vega,
            },
        );
        Ok(id)
    }

    /// The hedge trade needed to flatten delta: the negative of the position
    /// delta.
    pub fn hedge_delta(&self, strategy_id: &str) -> Result<f64, GammaError> {
        let strategies = self.strategies.read().unwrap();
        let strategy = strategies
            .get(strategy_id)
            .ok_or_else(|| GammaError::UnknownStrategy(strategy_id.to_string()))?;
        Ok(-strategy.delta)
    }

    pub fn strategy(&self, id: &str) -> Option<GammaStrategy> {
        self.strategies.read().unwrap().get(id).cloned()
    }
}

impl Default for GammaTradingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vega_comes_from_the_caller_not_from_gamma() {
        let svc = GammaTradingService::new();
        let id = svc.create_gamma_strategy(100.0, 0.02, 500.0).unwrap();

        let s = svc.strategy(&id).unwrap();
        assert_eq!(s.vega, 500.0);
        // The old implementation invented vega = gamma * 0.5 = 0.01.
        assert_ne!(s.vega, s.gamma * 0.5);
    }

    #[test]
    fn hedging_flattens_delta() {
        let svc = GammaTradingService::new();
        let id = svc.create_gamma_strategy(100.0, 0.02, 500.0).unwrap();

        let hedge = svc.hedge_delta(&id).unwrap();
        assert_eq!(hedge, -100.0);
        assert_eq!(hedge + svc.strategy(&id).unwrap().delta, 0.0);
    }

    #[test]
    fn non_finite_greeks_are_rejected() {
        let svc = GammaTradingService::new();
        assert!(svc.create_gamma_strategy(f64::NAN, 0.02, 500.0).is_err());
        assert!(svc.create_gamma_strategy(100.0, f64::INFINITY, 500.0).is_err());
        assert!(svc.create_gamma_strategy(100.0, 0.02, f64::NAN).is_err());
    }

    #[test]
    fn ids_are_unique() {
        let svc = GammaTradingService::new();
        let a = svc.create_gamma_strategy(1.0, 0.01, 1.0).unwrap();
        let b = svc.create_gamma_strategy(1.0, 0.01, 1.0).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn unknown_strategies_are_rejected() {
        let svc = GammaTradingService::new();
        assert!(svc.hedge_delta("g_missing").is_err());
    }
}
