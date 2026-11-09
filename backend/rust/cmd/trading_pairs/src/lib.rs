//! Trading-pair registry.
//!
//! The previous implementation seeded a single hardcoded `BTC/USDT` market in
//! its constructor, so any deployment reported one market it had never been
//! told about. The registry now starts empty and every pair is registered by
//! the caller; each registration is validated so a malformed or duplicated
//! market is rejected rather than stored.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Pair {
    pub symbol: String,
    pub base: String,
    pub quote: String,
    pub min_qty: f64,
    pub min_notional: f64,
    pub maker_fee: f64,
    pub taker_fee: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PairError {
    EmptyField(&'static str),
    InvalidSymbol,
    NonFiniteAmount(&'static str),
    NonPositiveAmount(&'static str),
    FeeOutOfRange(&'static str),
    Duplicate(String),
    Unknown(String),
    LockPoisoned,
}

impl std::fmt::Display for PairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PairError::EmptyField(field) => write!(f, "{field} must not be empty"),
            PairError::InvalidSymbol => write!(f, "symbol must be BASE/QUOTE in upper case"),
            PairError::NonFiniteAmount(field) => write!(f, "{field} must be finite"),
            PairError::NonPositiveAmount(field) => write!(f, "{field} must be greater than zero"),
            PairError::FeeOutOfRange(field) => write!(f, "{field} must be a fraction in [0, 1)"),
            PairError::Duplicate(symbol) => write!(f, "pair {symbol} is already registered"),
            PairError::Unknown(symbol) => write!(f, "pair {symbol} is not registered"),
            PairError::LockPoisoned => write!(f, "pair registry lock is poisoned"),
        }
    }
}

impl std::error::Error for PairError {}

fn check_amount(field: &'static str, value: f64) -> Result<(), PairError> {
    if !value.is_finite() {
        return Err(PairError::NonFiniteAmount(field));
    }
    if value <= 0.0 {
        return Err(PairError::NonPositiveAmount(field));
    }
    Ok(())
}

fn check_fee(field: &'static str, value: f64) -> Result<(), PairError> {
    if !value.is_finite() || !(0.0..1.0).contains(&value) {
        return Err(PairError::FeeOutOfRange(field));
    }
    Ok(())
}

/// Validate a symbol of the form `BASE/QUOTE`, both non-empty and upper case.
fn valid_symbol(symbol: &str) -> bool {
    let Some((base, quote)) = symbol.split_once('/') else {
        return false;
    };
    let ok = |part: &str| {
        !part.is_empty()
            && part.len() <= 20
            && part.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
    };
    ok(base) && ok(quote)
}

impl Pair {
    /// Validate every field of a pair that is about to be registered.
    pub fn validate(&self) -> Result<(), PairError> {
        if self.symbol.trim().is_empty() {
            return Err(PairError::EmptyField("symbol"));
        }
        if !valid_symbol(&self.symbol) {
            return Err(PairError::InvalidSymbol);
        }
        if self.base.trim().is_empty() {
            return Err(PairError::EmptyField("base"));
        }
        if self.quote.trim().is_empty() {
            return Err(PairError::EmptyField("quote"));
        }
        let (symbol_base, symbol_quote) = self.symbol.split_once('/').unwrap();
        if symbol_base != self.base || symbol_quote != self.quote {
            return Err(PairError::InvalidSymbol);
        }
        check_amount("min_qty", self.min_qty)?;
        check_amount("min_notional", self.min_notional)?;
        check_fee("maker_fee", self.maker_fee)?;
        check_fee("taker_fee", self.taker_fee)?;
        Ok(())
    }
}

pub struct PairService {
    pairs: RwLock<HashMap<String, Pair>>,
}

impl PairService {
    /// Create an empty registry. No market is assumed to exist.
    pub fn new() -> Self {
        Self {
            pairs: RwLock::new(HashMap::new()),
        }
    }

    /// Register a pair, rejecting an invalid or duplicate market.
    pub fn register(&self, pair: Pair) -> Result<(), PairError> {
        pair.validate()?;
        let mut pairs = self.pairs.write().map_err(|_| PairError::LockPoisoned)?;
        if pairs.contains_key(&pair.symbol) {
            return Err(PairError::Duplicate(pair.symbol));
        }
        pairs.insert(pair.symbol.clone(), pair);
        Ok(())
    }

    /// Remove a pair, erroring when it was never registered.
    pub fn remove(&self, symbol: &str) -> Result<Pair, PairError> {
        let mut pairs = self.pairs.write().map_err(|_| PairError::LockPoisoned)?;
        pairs
            .remove(symbol)
            .ok_or_else(|| PairError::Unknown(symbol.to_string()))
    }

    pub fn get_pair(&self, symbol: &str) -> Result<Option<Pair>, PairError> {
        let pairs = self.pairs.read().map_err(|_| PairError::LockPoisoned)?;
        Ok(pairs.get(symbol).cloned())
    }

    /// Symbols in a stable, sorted order so callers and tests are deterministic.
    pub fn list_pairs(&self) -> Result<Vec<String>, PairError> {
        let pairs = self.pairs.read().map_err(|_| PairError::LockPoisoned)?;
        let mut symbols: Vec<String> = pairs.keys().cloned().collect();
        symbols.sort();
        Ok(symbols)
    }

    pub fn len(&self) -> Result<usize, PairError> {
        let pairs = self.pairs.read().map_err(|_| PairError::LockPoisoned)?;
        Ok(pairs.len())
    }

    pub fn is_empty(&self) -> Result<bool, PairError> {
        Ok(self.len()? == 0)
    }
}

impl Default for PairService {
    fn default() -> Self {
        Self::new()
    }
}

fn pair(symbol: &str, base: &str, quote: &str) -> Pair {
    Pair {
        symbol: symbol.to_string(),
        base: base.to_string(),
        quote: quote.to_string(),
        min_qty: 0.0001,
        min_notional: 5.0,
        maker_fee: 0.001,
        taker_fee: 0.001,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_registry_is_empty() {
        let s = PairService::new();
        assert!(s.is_empty().unwrap());
        assert_eq!(s.get_pair("BTC/USDT").unwrap(), None);
    }

    #[test]
    fn a_valid_pair_round_trips() {
        let s = PairService::new();
        s.register(pair("BTC/USDT", "BTC", "USDT")).unwrap();
        let stored = s.get_pair("BTC/USDT").unwrap().unwrap();
        assert_eq!(stored.base, "BTC");
        assert_eq!(s.list_pairs().unwrap(), vec!["BTC/USDT".to_string()]);
    }

    #[test]
    fn duplicates_are_refused() {
        let s = PairService::new();
        s.register(pair("BTC/USDT", "BTC", "USDT")).unwrap();
        assert_eq!(
            s.register(pair("BTC/USDT", "BTC", "USDT")),
            Err(PairError::Duplicate("BTC/USDT".to_string()))
        );
    }

    #[test]
    fn a_malformed_symbol_is_refused() {
        let s = PairService::new();
        assert_eq!(s.register(pair("btcusdt", "BTC", "USDT")), Err(PairError::InvalidSymbol));
        assert_eq!(s.register(pair("BTC/USDT", "ETH", "USDT")), Err(PairError::InvalidSymbol));
    }

    #[test]
    fn non_positive_and_non_finite_amounts_are_refused() {
        let s = PairService::new();
        let mut p = pair("BTC/USDT", "BTC", "USDT");
        p.min_qty = 0.0;
        assert_eq!(s.register(p.clone()), Err(PairError::NonPositiveAmount("min_qty")));
        p.min_qty = f64::NAN;
        assert_eq!(s.register(p.clone()), Err(PairError::NonFiniteAmount("min_qty")));
    }

    #[test]
    fn fees_outside_the_unit_interval_are_refused() {
        let s = PairService::new();
        let mut p = pair("BTC/USDT", "BTC", "USDT");
        p.maker_fee = 1.0;
        assert_eq!(s.register(p.clone()), Err(PairError::FeeOutOfRange("maker_fee")));
        p.maker_fee = -0.1;
        assert_eq!(s.register(p), Err(PairError::FeeOutOfRange("maker_fee")));
    }

    #[test]
    fn listing_is_sorted_and_removal_reports_unknowns() {
        let s = PairService::new();
        s.register(pair("ETH/USDT", "ETH", "USDT")).unwrap();
        s.register(pair("BTC/USDT", "BTC", "USDT")).unwrap();
        assert_eq!(s.list_pairs().unwrap(), vec!["BTC/USDT".to_string(), "ETH/USDT".to_string()]);
        assert!(s.remove("BTC/USDT").is_ok());
        assert_eq!(s.remove("BTC/USDT"), Err(PairError::Unknown("BTC/USDT".to_string())));
    }
}
