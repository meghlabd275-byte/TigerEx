//! Oracle price aggregator.
//!
//! The previous implementation stored whatever price it was handed and
//! returned it verbatim: negative, zero, NaN and arbitrarily stale values were
//! all accepted, and there was no cross-source agreement check. Oracle prices
//! drive liquidations, so those gaps are unsafe.
//!
//! Prices are now aggregated as the median of fresh, validated sources, with a
//! deviation guard that excludes a source disagreeing too far from the median.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Where a price came from. Each symbol keeps one value per source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PriceSource {
    Chainlink,
    Pyth,
    /// TigerEx's own matched trades.
    OwnTrades,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Price {
    pub symbol: String,
    pub price: f64,
    pub source: PriceSource,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OracleError {
    InvalidPrice(f64),
    UnknownSymbol(String),
    NoFreshSources(String),
    /// The source disagrees with the median by more than the allowed basis
    /// points.
    DeviationExceeded { source: PriceSource, deviation_bps: f64 },
}

impl std::fmt::Display for OracleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OracleError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            OracleError::UnknownSymbol(s) => write!(f, "no prices for symbol {s}"),
            OracleError::NoFreshSources(s) => write!(f, "no fresh price sources for {s}"),
            OracleError::DeviationExceeded { source, deviation_bps } => write!(
                f,
                "source {source:?} deviates {deviation_bps:.1} bps from the median"
            ),
        }
    }
}

impl std::error::Error for OracleError {}

/// Aggregated price for a symbol.
#[derive(Debug, Clone, PartialEq)]
pub struct AggregatedPrice {
    pub symbol: String,
    pub price: f64,
    /// Sources that contributed to the median.
    pub sources: usize,
    pub timestamp_ms: u64,
}

pub struct OracleService {
    prices: RwLock<HashMap<String, HashMap<PriceSource, Price>>>,
    /// Maximum age of a price before it is considered stale.
    max_age_ms: u64,
    /// Minimum fresh sources required to publish a price.
    min_sources: usize,
    /// Maximum allowed deviation from the median, in basis points.
    max_deviation_bps: f64,
}

impl OracleService {
    pub fn new() -> Self {
        Self {
            prices: RwLock::new(HashMap::new()),
            max_age_ms: 60_000,
            min_sources: 2,
            max_deviation_bps: 500.0, // 5%
        }
    }

    pub fn with_limits(mut self, max_age_ms: u64, min_sources: usize, max_deviation_bps: f64) -> Self {
        self.max_age_ms = max_age_ms;
        self.min_sources = min_sources.max(1);
        self.max_deviation_bps = max_deviation_bps;
        self
    }

    /// Submit a price from a source.
    ///
    /// Rejects non-finite and non-positive prices outright. A valid price that
    /// deviates from the current median by more than the configured limit is
    /// rejected so a single bad feed cannot move the aggregate.
    pub fn submit(
        &self,
        source: PriceSource,
        symbol: &str,
        price: f64,
    ) -> Result<(), OracleError> {
        if !price.is_finite() || price <= 0.0 {
            return Err(OracleError::InvalidPrice(price));
        }

        // Check against the existing aggregate before inserting.
        if let Ok(current) = self.median(symbol) {
            let deviation_bps = ((price - current) / current).abs() * 10_000.0;
            if deviation_bps > self.max_deviation_bps {
                return Err(OracleError::DeviationExceeded {
                    source,
                    deviation_bps,
                });
            }
        }

        let mut prices = self.prices.write().unwrap();
        prices
            .entry(symbol.to_string())
            .or_default()
            .insert(
                source,
                Price {
                    symbol: symbol.to_string(),
                    price,
                    source,
                    timestamp_ms: current_timestamp_ms(),
                },
            );
        Ok(())
    }

    /// Median of the fresh, validated source prices for a symbol.
    pub fn median(&self, symbol: &str) -> Result<f64, OracleError> {
        let now = current_timestamp_ms();
        let prices = self.prices.read().unwrap();

        let entries = prices
            .get(symbol)
            .ok_or_else(|| OracleError::UnknownSymbol(symbol.to_string()))?;

        let mut fresh: Vec<f64> = entries
            .values()
            .filter(|p| now.saturating_sub(p.timestamp_ms) < self.max_age_ms)
            .map(|p| p.price)
            .collect();

        if fresh.len() < self.min_sources {
            return Err(OracleError::NoFreshSources(symbol.to_string()));
        }

        fresh.sort_by(|a, b| a.partial_cmp(b).expect("validated finite prices"));
        let mid = fresh.len() / 2;
        Ok(if fresh.len() % 2 == 0 {
            (fresh[mid - 1] + fresh[mid]) / 2.0
        } else {
            fresh[mid]
        })
    }

    /// Aggregated price with metadata.
    pub fn get_price(&self, symbol: &str) -> Result<AggregatedPrice, OracleError> {
        let price = self.median(symbol)?;
        let now = current_timestamp_ms();
        let prices = self.prices.read().unwrap();
        let sources = prices
            .get(symbol)
            .map(|entries| {
                entries
                    .values()
                    .filter(|p| now.saturating_sub(p.timestamp_ms) < self.max_age_ms)
                    .count()
            })
            .unwrap_or(0);

        Ok(AggregatedPrice {
            symbol: symbol.to_string(),
            price,
            sources,
            timestamp_ms: now,
        })
    }

    /// Raw price from one source, if present and fresh.
    pub fn source_price(&self, symbol: &str, source: PriceSource) -> Option<f64> {
        let now = current_timestamp_ms();
        self.prices
            .read()
            .unwrap()
            .get(symbol)
            .and_then(|entries| entries.get(&source))
            .filter(|p| now.saturating_sub(p.timestamp_ms) < self.max_age_ms)
            .map(|p| p.price)
    }
}

impl Default for OracleService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_finite_and_non_positive_prices() {
        let oracle = OracleService::new();
        // The old implementation stored these verbatim.
        assert!(matches!(
            oracle.submit(PriceSource::Pyth, "BTC", f64::NAN).unwrap_err(),
            OracleError::InvalidPrice(p) if p.is_nan()
        ));
        assert!(oracle.submit(PriceSource::Pyth, "BTC", -1.0).is_err());
        assert!(oracle.submit(PriceSource::Pyth, "BTC", 0.0).is_err());
        assert!(oracle.median("BTC").is_err());
    }

    #[test]
    fn median_of_three_sources() {
        let oracle = OracleService::new();
        oracle.submit(PriceSource::Chainlink, "BTC", 50_000.0).unwrap();
        oracle.submit(PriceSource::Pyth, "BTC", 50_100.0).unwrap();
        oracle.submit(PriceSource::OwnTrades, "BTC", 49_900.0).unwrap();

        assert_eq!(oracle.median("BTC").unwrap(), 50_000.0);
        assert_eq!(oracle.get_price("BTC").unwrap().sources, 3);
    }

    #[test]
    fn a_single_source_is_not_enough_to_publish() {
        let oracle = OracleService::new();
        oracle.submit(PriceSource::Pyth, "BTC", 50_000.0).unwrap();
        assert_eq!(
            oracle.median("BTC").unwrap_err(),
            OracleError::NoFreshSources("BTC".to_string())
        );
    }

    #[test]
    fn deviating_source_is_rejected() {
        let oracle = OracleService::new();
        oracle.submit(PriceSource::Chainlink, "BTC", 50_000.0).unwrap();
        oracle.submit(PriceSource::Pyth, "BTC", 50_050.0).unwrap();

        // 20% away from the 50,025 median, far beyond the 5% guard.
        let err = oracle
            .submit(PriceSource::OwnTrades, "BTC", 60_000.0)
            .unwrap_err();
        assert!(matches!(err, OracleError::DeviationExceeded { .. }));
        assert!(oracle.source_price("BTC", PriceSource::OwnTrades).is_none());
    }

    #[test]
    fn stale_prices_are_excluded() {
        let oracle = OracleService::new().with_limits(0, 2, 10_000.0);
        oracle.submit(PriceSource::Chainlink, "BTC", 50_000.0).unwrap();
        oracle.submit(PriceSource::Pyth, "BTC", 50_000.0).unwrap();

        // A zero-age window makes every price immediately stale.
        assert_eq!(
            oracle.median("BTC").unwrap_err(),
            OracleError::NoFreshSources("BTC".to_string())
        );
    }

    #[test]
    fn unknown_symbol_reports_clearly() {
        let oracle = OracleService::new();
        assert_eq!(
            oracle.median("DOGE").unwrap_err(),
            OracleError::UnknownSymbol("DOGE".to_string())
        );
    }
}
