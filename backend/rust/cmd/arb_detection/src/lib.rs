//! Arbitrage opportunity detection across TigerEx's own venues.
//!
//! The previous implementation returned a hardcoded opportunity referencing
//! rival exchanges ("binance" and "coinbase"), which both fabricated data and
//! contradicted the rule that TigerEx never depends on another exchange.
//! Detection here compares quotes across venues the caller supplies.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    pub venue: String,
    pub bid: f64,
    pub ask: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArbOpportunity {
    pub pair: String,
    pub buy_venue: String,
    pub sell_venue: String,
    pub buy_price: f64,
    pub sell_price: f64,
    /// Gross edge as a fraction of the buy price, before fees.
    pub edge: f64,
    /// Estimated profit on the tradable quantity.
    pub profit_est: f64,
    pub quantity: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ArbError {
    EmptyPair,
    InvalidQuote(f64),
    DuplicateVenue(String),
    NoQuotes(String),
    InvalidFee(f64),
}

impl std::fmt::Display for ArbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArbError::EmptyPair => write!(f, "pair must not be empty"),
            ArbError::InvalidQuote(p) => write!(f, "quote price {p} must be finite and positive"),
            ArbError::DuplicateVenue(v) => write!(f, "venue {v} is already quoted for this pair"),
            ArbError::NoQuotes(p) => write!(f, "no quotes for {p}"),
            ArbError::InvalidFee(fee) => write!(f, "fee {fee} must be finite and within [0, 1)"),
        }
    }
}

impl std::error::Error for ArbError {}

pub struct ArbDetectionService {
    /// pair -> venue -> quote.
    books: RwLock<HashMap<String, HashMap<String, Quote>>>,
    opportunities: RwLock<Vec<ArbOpportunity>>,
    /// Round-trip fee assumed per leg, as a fraction.
    taker_fee: f64,
}

impl ArbDetectionService {
    pub fn new() -> Self {
        Self {
            books: RwLock::new(HashMap::new()),
            opportunities: RwLock::new(Vec::new()),
            taker_fee: 0.001,
        }
    }

    pub fn with_taker_fee(mut self, fee: f64) -> Result<Self, ArbError> {
        if !fee.is_finite() || fee < 0.0 || fee >= 1.0 {
            return Err(ArbError::InvalidFee(fee));
        }
        self.taker_fee = fee;
        Ok(self)
    }

    /// Record a venue's quote for a pair.
    pub fn update_quote(
        &self,
        pair: &str,
        venue: &str,
        bid: f64,
        ask: f64,
    ) -> Result<(), ArbError> {
        if pair.trim().is_empty() {
            return Err(ArbError::EmptyPair);
        }
        for price in [bid, ask] {
            if !price.is_finite() || price <= 0.0 {
                return Err(ArbError::InvalidQuote(price));
            }
        }

        let mut books = self.books.write().unwrap();
        let book = books.entry(pair.to_string()).or_default();
        if book.contains_key(venue) {
            return Err(ArbError::DuplicateVenue(venue.to_string()));
        }
        book.insert(
            venue.to_string(),
            Quote {
                venue: venue.to_string(),
                bid,
                ask,
            },
        );
        Ok(())
    }

    /// Scan a pair for the best cross-venue opportunity: buy at the lowest ask
    /// and sell at the highest bid elsewhere, net of fees.
    ///
    /// Returns `None` when no combination is profitable.
    pub fn scan(&self, pair: &str) -> Result<Option<ArbOpportunity>, ArbError> {
        let books = self.books.read().unwrap();
        let book = books
            .get(pair)
            .ok_or_else(|| ArbError::NoQuotes(pair.to_string()))?;

        let mut best: Option<ArbOpportunity> = None;
        for buyer in book.values() {
            for seller in book.values() {
                if buyer.venue == seller.venue {
                    continue;
                }
                // Buy at buyer.ask, sell at seller.bid.
                let gross = seller.bid - buyer.ask;
                let fees = (buyer.ask + seller.bid) * self.taker_fee;
                let net = gross - fees;
                if net <= 0.0 {
                    continue;
                }

                let edge = net / buyer.ask;
                let opportunity = ArbOpportunity {
                    pair: pair.to_string(),
                    buy_venue: buyer.venue.clone(),
                    sell_venue: seller.venue.clone(),
                    buy_price: buyer.ask,
                    sell_price: seller.bid,
                    edge,
                    profit_est: net,
                    quantity: 1.0,
                };
                if best.as_ref().map(|b| net > b.profit_est).unwrap_or(true) {
                    best = Some(opportunity);
                }
            }
        }
        Ok(best)
    }

    /// Record an opportunity that was acted on.
    pub fn alert(&self, opp: ArbOpportunity) {
        self.opportunities.write().unwrap().push(opp);
    }

    pub fn alerts(&self) -> Vec<ArbOpportunity> {
        self.opportunities.read().unwrap().clone()
    }
}

impl Default for ArbDetectionService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanning_without_quotes_reports_an_error() {
        let svc = ArbDetectionService::new();
        // The old implementation returned a hardcoded opportunity naming
        // binance and coinbase regardless of any input.
        assert!(matches!(
            svc.scan("BTC/USDT").unwrap_err(),
            ArbError::NoQuotes(_)
        ));
    }

    #[test]
    fn a_cross_venue_discrepancy_is_detected() {
        let svc = ArbDetectionService::new().with_taker_fee(0.001).unwrap();
        svc.update_quote("BTC/USDT", "TigerEx-Spot", 50_000.0, 50_010.0).unwrap();
        svc.update_quote("BTC/USDT", "TigerEx-Pool", 50_500.0, 50_510.0).unwrap();

        let opp = svc.scan("BTC/USDT").unwrap().unwrap();
        assert_eq!(opp.buy_venue, "TigerEx-Spot");
        assert_eq!(opp.sell_venue, "TigerEx-Pool");
        assert_eq!(opp.buy_price, 50_010.0);
        assert_eq!(opp.sell_price, 50_500.0);
        assert!(opp.profit_est > 0.0);
    }

    #[test]
    fn fees_can_erase_an_opportunity() {
        // A 10% round-trip fee dwarfs a 1% spread.
        let svc = ArbDetectionService::new().with_taker_fee(0.05).unwrap();
        svc.update_quote("BTC/USDT", "A", 50_000.0, 50_010.0).unwrap();
        svc.update_quote("BTC/USDT", "B", 50_500.0, 50_510.0).unwrap();

        assert!(svc.scan("BTC/USDT").unwrap().is_none());
    }

    #[test]
    fn identical_quotes_yield_no_opportunity() {
        let svc = ArbDetectionService::new();
        svc.update_quote("BTC/USDT", "A", 50_000.0, 50_000.0).unwrap();
        svc.update_quote("BTC/USDT", "B", 50_000.0, 50_000.0).unwrap();

        assert!(svc.scan("BTC/USDT").unwrap().is_none());
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = ArbDetectionService::new();
        assert!(svc.update_quote("", "A", 1.0, 1.0).is_err());
        assert!(svc.update_quote("BTC/USDT", "A", -1.0, 1.0).is_err());
        assert!(svc.update_quote("BTC/USDT", "A", 1.0, f64::NAN).is_err());

        svc.update_quote("BTC/USDT", "A", 1.0, 1.0).unwrap();
        assert!(matches!(
            svc.update_quote("BTC/USDT", "A", 2.0, 2.0).unwrap_err(),
            ArbError::DuplicateVenue(_)
        ));
    }
}
