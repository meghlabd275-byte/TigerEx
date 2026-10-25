//! Volatility index calculation and volatility trades.
//!
//! The previous implementation divided by the sample count (panicking on an
//! empty input), scaled the mean price by an invented 0.01, and returned a
//! formatted string from `trade_vol` without recording anything.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct VolIndex {
    pub symbol: String,
    /// Annualised volatility as a fraction, e.g. 0.60 for 60%.
    pub value: f64,
    pub samples: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VolTrade {
    pub id: String,
    pub symbol: String,
    pub strike: f64,
    pub expiry: String,
    pub index_at_trade: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum VolError {
    NoSamples,
    InvalidPrice(f64),
    InvalidStrike(f64),
    EmptySymbol,
    EmptyExpiry,
    InvalidPeriods(f64),
    UnknownIndex(String),
}

impl std::fmt::Display for VolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VolError::NoSamples => write!(f, "at least two prices are needed"),
            VolError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            VolError::InvalidStrike(s) => write!(f, "strike {s} must be finite and positive"),
            VolError::EmptySymbol => write!(f, "symbol must not be empty"),
            VolError::EmptyExpiry => write!(f, "expiry must not be empty"),
            VolError::InvalidPeriods(p) => {
                write!(f, "periods per year {p} must be finite and positive")
            }
            VolError::UnknownIndex(s) => write!(f, "no index for {s}"),
        }
    }
}

impl std::error::Error for VolError {}

pub struct VolTradingService {
    indices: RwLock<HashMap<String, VolIndex>>,
    trades: RwLock<Vec<VolTrade>>,
    next_id: RwLock<u64>,
}

impl VolTradingService {
    pub fn new() -> Self {
        Self {
            indices: RwLock::new(HashMap::new()),
            trades: RwLock::new(Vec::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Annualised volatility from a price series.
    ///
    /// Uses the sample standard deviation of log returns, scaled by the square
    /// root of `periods_per_year`. No scale factor is invented.
    pub fn calculate_vol(
        &self,
        symbol: &str,
        prices: &[f64],
        periods_per_year: f64,
    ) -> Result<VolIndex, VolError> {
        if symbol.trim().is_empty() {
            return Err(VolError::EmptySymbol);
        }
        if prices.len() < 2 {
            // The old implementation divided by prices.len() and panicked on [].
            return Err(VolError::NoSamples);
        }
        for price in prices {
            if !price.is_finite() || *price <= 0.0 {
                return Err(VolError::InvalidPrice(*price));
            }
        }
        if !periods_per_year.is_finite() || periods_per_year <= 0.0 {
            return Err(VolError::InvalidPeriods(periods_per_year));
        }

        let returns: Vec<f64> = prices
            .windows(2)
            .map(|w| (w[1] / w[0]).ln())
            .collect();
        let n = returns.len() as f64;
        let mean = returns.iter().sum::<f64>() / n;
        let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / (n - 1.0);
        let value = variance.sqrt() * periods_per_year.sqrt();

        let index = VolIndex {
            symbol: symbol.to_string(),
            value,
            samples: prices.len(),
        };
        self.indices
            .write()
            .unwrap()
            .insert(symbol.to_string(), index.clone());
        Ok(index)
    }

    /// The most recently computed index for a symbol.
    pub fn index(&self, symbol: &str) -> Option<VolIndex> {
        self.indices.read().unwrap().get(symbol).cloned()
    }

    /// Record a volatility trade against the symbol's current index.
    pub fn trade_vol(
        &self,
        symbol: &str,
        strike: f64,
        expiry: &str,
    ) -> Result<VolTrade, VolError> {
        if symbol.trim().is_empty() {
            return Err(VolError::EmptySymbol);
        }
        if expiry.trim().is_empty() {
            return Err(VolError::EmptyExpiry);
        }
        if !strike.is_finite() || strike <= 0.0 {
            return Err(VolError::InvalidStrike(strike));
        }

        let index_at_trade = self
            .indices
            .read()
            .unwrap()
            .get(symbol)
            .map(|i| i.value)
            .ok_or_else(|| VolError::UnknownIndex(symbol.to_string()))?;

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("vol_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let trade = VolTrade {
            id,
            symbol: symbol.to_string(),
            strike,
            expiry: expiry.to_string(),
            index_at_trade,
        };
        self.trades.write().unwrap().push(trade.clone());
        Ok(trade)
    }

    pub fn trade_count(&self) -> usize {
        self.trades.read().unwrap().len()
    }
}

impl Default for VolTradingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_series_is_rejected_rather_than_panicking() {
        let svc = VolTradingService::new();
        // The old implementation divided by prices.len() and panicked.
        assert!(matches!(
            svc.calculate_vol("BTC", &[], 365.0).unwrap_err(),
            VolError::NoSamples
        ));
        assert!(svc.calculate_vol("BTC", &[50_000.0], 365.0).is_err());
    }

    #[test]
    fn a_flat_series_has_zero_volatility() {
        let svc = VolTradingService::new();
        let prices = [100.0; 5];
        let index = svc.calculate_vol("BTC", &prices, 365.0).unwrap();

        // The old implementation returned mean * 0.01 = 1.0 for a flat series.
        assert_eq!(index.value, 0.0);
        assert_eq!(index.samples, 5);
    }

    #[test]
    fn a_rising_series_has_positive_volatility() {
        let svc = VolTradingService::new();
        let prices = [100.0, 110.0, 100.0, 110.0, 100.0];
        let index = svc.calculate_vol("BTC", &prices, 365.0).unwrap();
        assert!(index.value > 0.0);
    }

    #[test]
    fn trading_volatility_records_the_trade() {
        let svc = VolTradingService::new();
        svc.calculate_vol("BTC", &[100.0, 110.0, 105.0], 365.0).unwrap();

        let trade = svc.trade_vol("BTC", 60.0, "2026-12-25").unwrap();
        // The old implementation returned a string and recorded nothing.
        assert_eq!(svc.trade_count(), 1);
        assert!(trade.index_at_trade > 0.0);
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = VolTradingService::new();
        assert!(svc.calculate_vol("", &[1.0, 2.0], 365.0).is_err());
        assert!(svc.calculate_vol("BTC", &[1.0, -2.0], 365.0).is_err());
        assert!(svc.calculate_vol("BTC", &[1.0, 2.0], 0.0).is_err());

        // Trading before an index exists is refused.
        assert!(matches!(
            svc.trade_vol("BTC", 60.0, "2026-12-25").unwrap_err(),
            VolError::UnknownIndex(_)
        ));
        svc.calculate_vol("BTC", &[1.0, 2.0], 365.0).unwrap();
        assert!(svc.trade_vol("BTC", -1.0, "2026-12-25").is_err());
        assert!(svc.trade_vol("BTC", 60.0, "").is_err());
    }
}
