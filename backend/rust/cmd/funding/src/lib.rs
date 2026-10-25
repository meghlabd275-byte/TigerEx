//! Perpetual funding rates.
//!
//! The previous implementation returned a fabricated default of 0.0001 for any
//! symbol without a rate, never computed a rate, and left `next_update` at
//! zero. `apply_funding` multiplied the position by the raw rate with no
//! clamp, so a bad rate could charge an unbounded amount.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// One funding interval in milliseconds (8 hours).
pub const FUNDING_INTERVAL_MS: u64 = 8 * 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq)]
pub struct FundingRate {
    pub symbol: String,
    /// The rate actually charged this interval, after clamping.
    pub rate: f64,
    /// Premium component: (mark - index) / index.
    pub premium_index: f64,
    /// Unix ms of the next funding timestamp.
    pub next_update: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FundingError {
    InvalidInput(&'static str),
    UnknownSymbol(String),
}

impl std::fmt::Display for FundingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FundingError::InvalidInput(field) => write!(f, "invalid input: {field}"),
            FundingError::UnknownSymbol(s) => write!(f, "no funding rate for {s}"),
        }
    }
}

impl std::error::Error for FundingError {}

pub struct FundingService {
    rates: RwLock<HashMap<String, FundingRate>>,
    /// Net funding collected per symbol this interval.
    funding_pools: RwLock<HashMap<String, f64>>,
    /// Absolute cap on the funding rate per interval (default 1%).
    rate_cap: f64,
    /// Fixed interest-rate component (default 0.01% per interval).
    interest_rate: f64,
}

impl FundingService {
    pub fn new() -> Self {
        Self {
            rates: RwLock::new(HashMap::new()),
            funding_pools: RwLock::new(HashMap::new()),
            rate_cap: 0.01,
            interest_rate: 0.0001,
        }
    }

    pub fn with_params(mut self, rate_cap: f64, interest_rate: f64) -> Self {
        self.rate_cap = rate_cap.abs();
        self.interest_rate = interest_rate;
        self
    }

    /// Compute and store the funding rate for an interval.
    ///
    /// The rate is `interest_rate + premium_index`, clamped to `+/-rate_cap`.
    /// Premium is the mark price's deviation from the index; a mark above the
    /// index yields a positive rate (longs pay shorts).
    pub fn compute_rate(
        &self,
        symbol: &str,
        mark_price: f64,
        index_price: f64,
    ) -> Result<FundingRate, FundingError> {
        if !mark_price.is_finite() || mark_price <= 0.0 {
            return Err(FundingError::InvalidInput("mark_price"));
        }
        if !index_price.is_finite() || index_price <= 0.0 {
            return Err(FundingError::InvalidInput("index_price"));
        }

        let premium_index = (mark_price - index_price) / index_price;
        let raw = self.interest_rate + premium_index;
        let rate = raw.clamp(-self.rate_cap, self.rate_cap);

        let now = current_timestamp_ms();
        let funding = FundingRate {
            symbol: symbol.to_string(),
            rate,
            premium_index,
            next_update: next_funding_time(now),
            timestamp_ms: now,
        };

        self.rates
            .write()
            .unwrap()
            .insert(symbol.to_string(), funding.clone());
        Ok(funding)
    }

    /// Current funding rate for a symbol.
    pub fn get_rate(&self, symbol: &str) -> Result<f64, FundingError> {
        self.rates
            .read()
            .unwrap()
            .get(symbol)
            .map(|r| r.rate)
            .ok_or_else(|| FundingError::UnknownSymbol(symbol.to_string()))
    }

    /// Funding payment for a position.
    ///
    /// A positive `notional` means long (pays when the rate is positive); a
    /// negative notional means short. Returns the signed cash flow for the
    /// holder: negative when they pay.
    pub fn funding_payment(&self, symbol: &str, notional: f64) -> Result<f64, FundingError> {
        if !notional.is_finite() {
            return Err(FundingError::InvalidInput("notional"));
        }
        let rate = self.get_rate(symbol)?;
        Ok(-notional * rate)
    }

    /// Apply funding for a position and accumulate it into the symbol's pool.
    pub fn apply_funding(
        &self,
        symbol: &str,
        notional: f64,
    ) -> Result<f64, FundingError> {
        let payment = self.funding_payment(symbol, notional)?;
        let mut pools = self.funding_pools.write().unwrap();
        *pools.entry(symbol.to_string()).or_insert(0.0) += payment;
        Ok(payment)
    }

    /// Net funding collected for a symbol across applied payments.
    pub fn funding_pool(&self, symbol: &str) -> f64 {
        self.funding_pools
            .read()
            .unwrap()
            .get(symbol)
            .copied()
            .unwrap_or(0.0)
    }
}

impl Default for FundingService {
    fn default() -> Self {
        Self::new()
    }
}

fn next_funding_time(now_ms: u64) -> u64 {
    let interval = FUNDING_INTERVAL_MS;
    ((now_ms / interval) + 1) * interval
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
    fn rate_tracks_mark_index_premium() {
        let svc = FundingService::new();
        let funding = svc.compute_rate("BTC/USDT", 50_500.0, 50_000.0).unwrap();

        assert!((funding.premium_index - 0.01).abs() < 1e-12);
        // 0.01% interest + 1% premium = 1.01%, clamped to the 1% cap.
        assert!((funding.rate - 0.01).abs() < 1e-12);
        assert!(funding.next_update > current_timestamp_ms());
    }

    #[test]
    fn rate_is_clamped_in_both_directions() {
        let svc = FundingService::new();
        let high = svc.compute_rate("BTC", 100_000.0, 50_000.0).unwrap();
        let low = svc.compute_rate("BTC", 25_000.0, 50_000.0).unwrap();

        assert!((high.rate - 0.01).abs() < 1e-12);
        assert!((low.rate + 0.01).abs() < 1e-12);
    }

    #[test]
    fn unknown_symbol_does_not_invent_a_rate() {
        let svc = FundingService::new();
        // The old implementation returned a fabricated 0.0001 here.
        assert_eq!(
            svc.get_rate("BTC").unwrap_err(),
            FundingError::UnknownSymbol("BTC".to_string())
        );
    }

    #[test]
    fn invalid_prices_are_rejected() {
        let svc = FundingService::new();
        assert!(svc.compute_rate("BTC", f64::NAN, 50_000.0).is_err());
        assert!(svc.compute_rate("BTC", 50_000.0, 0.0).is_err());
        assert!(svc.compute_rate("BTC", -1.0, 50_000.0).is_err());
    }

    #[test]
    fn longs_pay_when_rate_is_positive() {
        let svc = FundingService::new();
        svc.compute_rate("BTC", 51_000.0, 50_000.0).unwrap();

        let long_payment = svc.apply_funding("BTC", 10_000.0).unwrap();
        let short_payment = svc.apply_funding("BTC", -10_000.0).unwrap();

        assert!(long_payment < 0.0, "longs should pay a positive rate");
        assert!(short_payment > 0.0, "shorts should receive it");
        assert!((long_payment + short_payment).abs() < 1e-9, "funding nets to zero");
        assert!((svc.funding_pool("BTC") - 0.0).abs() < 1e-9);
    }
}
