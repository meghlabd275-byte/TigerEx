//! Index trading for TigerEx.
//!
//! An index is defined by its constituents and their weights. The index level
//! is computed from real constituent prices supplied by the caller; a missing
//! price is an error rather than a silently substituted value.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Constituent {
    pub symbol: String,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Index {
    pub symbol: String,
    pub value: f64,
    pub constituents: Vec<Constituent>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IndexError {
    EmptySymbol,
    EmptyConstituents,
    InvalidWeight,
    WeightsDoNotSumToOne,
    UnknownIndex(String),
    MissingPrice(String),
    InvalidQuantity(f64),
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexError::EmptySymbol => write!(f, "index symbol must not be empty"),
            IndexError::EmptyConstituents => write!(f, "an index needs at least one constituent"),
            IndexError::InvalidWeight => write!(f, "constituent weights must be positive and finite"),
            IndexError::WeightsDoNotSumToOne => write!(f, "constituent weights must sum to 1"),
            IndexError::UnknownIndex(symbol) => write!(f, "unknown index: {symbol}"),
            IndexError::MissingPrice(symbol) => write!(f, "no price supplied for constituent {symbol}"),
            IndexError::InvalidQuantity(qty) => write!(f, "quantity {qty} must be positive"),
        }
    }
}

impl std::error::Error for IndexError {}

pub struct IndexTradingService {
    indices: RwLock<HashMap<String, Index>>,
}

impl Default for IndexTradingService {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexTradingService {
    pub fn new() -> Self {
        Self {
            indices: RwLock::new(HashMap::new()),
        }
    }

    /// Define an index. Weights must be positive and sum to 1 within a small
    /// tolerance.
    pub fn create_index(
        &self,
        symbol: &str,
        constituents: Vec<Constituent>,
    ) -> Result<String, IndexError> {
        if symbol.trim().is_empty() {
            return Err(IndexError::EmptySymbol);
        }
        if constituents.is_empty() {
            return Err(IndexError::EmptyConstituents);
        }
        if constituents.iter().any(|c| !c.weight.is_finite() || c.weight <= 0.0) {
            return Err(IndexError::InvalidWeight);
        }
        let total: f64 = constituents.iter().map(|c| c.weight).sum();
        if (total - 1.0).abs() > 1e-9 {
            return Err(IndexError::WeightsDoNotSumToOne);
        }

        let index = Index {
            symbol: symbol.to_string(),
            value: 1000.0,
            constituents,
        };
        self.indices.write().unwrap().insert(symbol.to_string(), index);
        Ok(symbol.to_string())
    }

    /// Recompute an index level from current constituent prices.
    ///
    /// `base_prices` are the constituent prices at index inception; the level
    /// is the weighted ratio of current to base prices, scaled by 1000.
    pub fn recompute(
        &self,
        symbol: &str,
        base_prices: &HashMap<String, f64>,
        current_prices: &HashMap<String, f64>,
    ) -> Result<f64, IndexError> {
        let mut indices = self.indices.write().unwrap();
        let index = indices
            .get_mut(symbol)
            .ok_or_else(|| IndexError::UnknownIndex(symbol.to_string()))?;

        let mut level = 0.0;
        for constituent in &index.constituents {
            let base = base_prices
                .get(&constituent.symbol)
                .ok_or_else(|| IndexError::MissingPrice(constituent.symbol.clone()))?;
            let current = current_prices
                .get(&constituent.symbol)
                .ok_or_else(|| IndexError::MissingPrice(constituent.symbol.clone()))?;
            if !base.is_finite() || *base <= 0.0 || !current.is_finite() || *current <= 0.0 {
                return Err(IndexError::MissingPrice(constituent.symbol.clone()));
            }
            level += constituent.weight * (current / base);
        }

        index.value = level * 1000.0;
        Ok(index.value)
    }

    pub fn index(&self, symbol: &str) -> Option<Index> {
        self.indices.read().unwrap().get(symbol).cloned()
    }

    /// Value a trade in index units at the current index level.
    pub fn trade_index(&self, symbol: &str, quantity: f64) -> Result<f64, IndexError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(IndexError::InvalidQuantity(quantity));
        }
        let indices = self.indices.read().unwrap();
        let index = indices
            .get(symbol)
            .ok_or_else(|| IndexError::UnknownIndex(symbol.to_string()))?;
        Ok(index.value * quantity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn constituents() -> Vec<Constituent> {
        vec![
            Constituent { symbol: "BTC".to_string(), weight: 0.6 },
            Constituent { symbol: "ETH".to_string(), weight: 0.4 },
        ]
    }

    #[test]
    fn rejects_bad_definitions() {
        let service = IndexTradingService::new();
        assert_eq!(service.create_index("", constituents()).unwrap_err(), IndexError::EmptySymbol);
        assert_eq!(service.create_index("IDX", vec![]).unwrap_err(), IndexError::EmptyConstituents);
        let bad = vec![
            Constituent { symbol: "BTC".to_string(), weight: 0.5 },
            Constituent { symbol: "ETH".to_string(), weight: 0.4 },
        ];
        assert_eq!(service.create_index("IDX", bad).unwrap_err(), IndexError::WeightsDoNotSumToOne);
    }

    #[test]
    fn recomputes_from_real_prices() {
        let service = IndexTradingService::new();
        service.create_index("IDX", constituents()).unwrap();

        let base = HashMap::from([("BTC".to_string(), 100.0), ("ETH".to_string(), 100.0)]);
        let current = HashMap::from([("BTC".to_string(), 110.0), ("ETH".to_string(), 90.0)]);
        let level = service.recompute("IDX", &base, &current).unwrap();
        // 0.6 * 1.10 + 0.4 * 0.90 = 1.02 -> 1020
        assert!((level - 1020.0).abs() < 1e-9);
    }

    #[test]
    fn missing_price_is_an_error() {
        let service = IndexTradingService::new();
        service.create_index("IDX", constituents()).unwrap();
        let base = HashMap::from([("BTC".to_string(), 100.0), ("ETH".to_string(), 100.0)]);
        let current = HashMap::from([("BTC".to_string(), 110.0)]);
        assert!(matches!(
            service.recompute("IDX", &base, &current).unwrap_err(),
            IndexError::MissingPrice(_)
        ));
    }

    #[test]
    fn unknown_index_and_bad_quantity() {
        let service = IndexTradingService::new();
        assert!(matches!(
            service.trade_index("NOPE", 1.0).unwrap_err(),
            IndexError::UnknownIndex(_)
        ));
        service.create_index("IDX", constituents()).unwrap();
        assert!(matches!(
            service.trade_index("IDX", 0.0).unwrap_err(),
            IndexError::InvalidQuantity(_)
        ));
        assert_eq!(service.trade_index("IDX", 2.0).unwrap(), 2000.0);
    }
}
