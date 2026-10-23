//! Over-the-counter desk for TigerEx.
//!
//! Quotes are priced from a reference price supplied by the caller (normally
//! the exchange oracle) plus a desk spread. A quote is valid for a fixed
//! window and can be accepted at most once.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    pub id: String,
    pub asset: String,
    pub side: String,
    pub price: f64,
    pub quantity: f64,
    pub valid_until_ms: u64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OtcError {
    EmptyAsset,
    InvalidSide(String),
    InvalidAmount(f64),
    InvalidReferencePrice(f64),
    InvalidSpread(f64),
    UnknownQuote(String),
    QuoteNotOpen(String),
    QuoteExpired(String),
}

impl std::fmt::Display for OtcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OtcError::EmptyAsset => write!(f, "asset must not be empty"),
            OtcError::InvalidSide(side) => write!(f, "side {side} must be buy or sell"),
            OtcError::InvalidAmount(amount) => {
                write!(f, "amount {amount} must be positive and finite")
            }
            OtcError::InvalidReferencePrice(price) => {
                write!(f, "reference price {price} must be positive and finite")
            }
            OtcError::InvalidSpread(spread) => {
                write!(f, "spread {spread} must be finite and within (-1, 1)")
            }
            OtcError::UnknownQuote(id) => write!(f, "unknown quote: {id}"),
            OtcError::QuoteNotOpen(id) => write!(f, "quote {id} is not open"),
            OtcError::QuoteExpired(id) => write!(f, "quote {id} has expired"),
        }
    }
}

impl std::error::Error for OtcError {}

pub struct OTCService {
    quotes: RwLock<HashMap<String, Quote>>,
    quote_window_ms: u64,
}

impl Default for OTCService {
    fn default() -> Self {
        Self::new()
    }
}

impl OTCService {
    pub fn new() -> Self {
        Self {
            quotes: RwLock::new(HashMap::new()),
            quote_window_ms: 30_000,
        }
    }

    /// Request a quote priced from `reference_price` and a desk spread.
    ///
    /// A buy lifts the price by the spread; a sell receives the price less the
    /// spread.
    pub fn request_quote(
        &self,
        asset: &str,
        side: &str,
        amount: f64,
        reference_price: f64,
        spread: f64,
        now_ms: u64,
    ) -> Result<Quote, OtcError> {
        if asset.trim().is_empty() {
            return Err(OtcError::EmptyAsset);
        }
        if side != "buy" && side != "sell" {
            return Err(OtcError::InvalidSide(side.to_string()));
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(OtcError::InvalidAmount(amount));
        }
        if !reference_price.is_finite() || reference_price <= 0.0 {
            return Err(OtcError::InvalidReferencePrice(reference_price));
        }
        if !spread.is_finite() || !(-1.0..1.0).contains(&spread) {
            return Err(OtcError::InvalidSpread(spread));
        }

        let price = if side == "buy" {
            reference_price * (1.0 + spread)
        } else {
            reference_price * (1.0 - spread)
        };

        let mut quotes = self.quotes.write().unwrap();
        let id = format!("qt_{}", quotes.len());
        let quote = Quote {
            id: id.clone(),
            asset: asset.to_string(),
            side: side.to_string(),
            price,
            quantity: amount,
            valid_until_ms: now_ms + self.quote_window_ms,
            status: "open".to_string(),
        };
        quotes.insert(id, quote.clone());
        Ok(quote)
    }

    pub fn accept_quote(&self, quote_id: &str, now_ms: u64) -> Result<Quote, OtcError> {
        let mut quotes = self.quotes.write().unwrap();
        let quote = quotes
            .get_mut(quote_id)
            .ok_or_else(|| OtcError::UnknownQuote(quote_id.to_string()))?;

        if quote.status != "open" {
            return Err(OtcError::QuoteNotOpen(quote_id.to_string()));
        }
        if now_ms > quote.valid_until_ms {
            quote.status = "expired".to_string();
            return Err(OtcError::QuoteExpired(quote_id.to_string()));
        }

        quote.status = "accepted".to_string();
        Ok(quote.clone())
    }

    pub fn quote(&self, quote_id: &str) -> Option<Quote> {
        self.quotes.read().unwrap().get(quote_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_requests() {
        let service = OTCService::new();
        assert_eq!(
            service.request_quote("", "buy", 1.0, 100.0, 0.01, 0).unwrap_err(),
            OtcError::EmptyAsset
        );
        assert!(matches!(
            service.request_quote("BTC", "sideways", 1.0, 100.0, 0.01, 0).unwrap_err(),
            OtcError::InvalidSide(_)
        ));
        assert!(matches!(
            service.request_quote("BTC", "buy", 1.0, 0.0, 0.01, 0).unwrap_err(),
            OtcError::InvalidReferencePrice(_)
        ));
        assert!(matches!(
            service.request_quote("BTC", "buy", 1.0, 100.0, 2.0, 0).unwrap_err(),
            OtcError::InvalidSpread(_)
        ));
    }

    #[test]
    fn prices_from_reference_and_spread() {
        let service = OTCService::new();
        let buy = service
            .request_quote("BTC", "buy", 1.0, 100.0, 0.01, 0)
            .unwrap();
        assert!((buy.price - 101.0).abs() < 1e-9);

        let sell = service
            .request_quote("BTC", "sell", 1.0, 100.0, 0.01, 0)
            .unwrap();
        assert!((sell.price - 99.0).abs() < 1e-9);
    }

    #[test]
    fn accepts_once_and_rejects_expired() {
        let service = OTCService::new();
        let quote = service
            .request_quote("BTC", "buy", 1.0, 100.0, 0.01, 1_000)
            .unwrap();

        service.accept_quote(&quote.id, 1_500).unwrap();
        assert!(matches!(
            service.accept_quote(&quote.id, 1_500).unwrap_err(),
            OtcError::QuoteNotOpen(_)
        ));

        let expired = service
            .request_quote("ETH", "buy", 1.0, 100.0, 0.01, 1_000)
            .unwrap();
        assert!(matches!(
            service.accept_quote(&expired.id, 100_000).unwrap_err(),
            OtcError::QuoteExpired(_)
        ));
    }
}
