//! TigerEx venue clients.
//!
//! This module previously modelled rival exchanges (Binance, Coinbase, Bybit)
//! and fabricated their tick data: a ticker built from a single price invented
//! a 0.1% bid/ask spread and reported a constant volume of 1,000,000.
//!
//! TigerEx never depends on another exchange, so this module exposes clients
//! for TigerEx's own venues only. Ticks are recorded from real quotes supplied
//! by the caller; nothing is invented.

use std::collections::HashMap;

/// A price tick for one venue.
#[derive(Debug, Clone, PartialEq)]
pub struct Ticker {
    pub symbol: String,
    pub bid: f64,
    pub ask: f64,
    pub last: f64,
    /// Traded volume over the reporting window, as supplied by the venue.
    pub volume: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClientError {
    InvalidSymbol,
    InvalidPrice(f64),
    InvalidSpread,
    EmptyKey,
    UnknownSymbol(String),
    InvalidQuantity(f64),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::InvalidSymbol => write!(f, "symbol must not be empty"),
            ClientError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            ClientError::InvalidSpread => write!(f, "bid must not exceed ask"),
            ClientError::EmptyKey => write!(f, "api key must not be empty"),
            ClientError::UnknownSymbol(s) => write!(f, "no quote recorded for {s}"),
            ClientError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
        }
    }
}

impl std::error::Error for ClientError {}

/// TigerEx venues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Venue {
    Spot,
    Futures,
    Pool,
}

impl Venue {
    pub fn name(self) -> &'static str {
        match self {
            Venue::Spot => "TigerEx-Spot",
            Venue::Futures => "TigerEx-Futures",
            Venue::Pool => "TigerEx-Pool",
        }
    }
}

pub trait ExchangeClient {
    fn venue(&self) -> Venue;
    fn ticker(&self, symbol: &str) -> Result<Ticker, ClientError>;
}

/// A client for one TigerEx venue, holding the quotes recorded for it.
pub struct TigerExClient {
    venue: Venue,
    api_key: String,
    ticks: HashMap<String, Ticker>,
}

impl TigerExClient {
    pub fn new(venue: Venue, api_key: &str) -> Result<Self, ClientError> {
        if api_key.trim().is_empty() {
            return Err(ClientError::EmptyKey);
        }
        Ok(Self {
            venue,
            api_key: api_key.to_string(),
            ticks: HashMap::new(),
        })
    }

    pub fn venue(&self) -> Venue {
        self.venue
    }

    /// Record a real quote for a symbol.
    ///
    /// The bid and ask are taken as given; no spread is invented.
    pub fn record_quote(
        &mut self,
        symbol: &str,
        bid: f64,
        ask: f64,
        last: f64,
        volume: f64,
    ) -> Result<(), ClientError> {
        if symbol.trim().is_empty() {
            return Err(ClientError::InvalidSymbol);
        }
        for price in [bid, ask, last] {
            if !price.is_finite() || price <= 0.0 {
                return Err(ClientError::InvalidPrice(price));
            }
        }
        if bid > ask {
            return Err(ClientError::InvalidSpread);
        }
        if !volume.is_finite() || volume < 0.0 {
            return Err(ClientError::InvalidPrice(volume));
        }

        self.ticks.insert(
            symbol.to_string(),
            Ticker {
                symbol: symbol.to_string(),
                bid,
                ask,
                last,
                volume,
            },
        );
        Ok(())
    }

    pub fn ticker(&self, symbol: &str) -> Result<Ticker, ClientError> {
        self.ticks
            .get(symbol)
            .cloned()
            .ok_or_else(|| ClientError::UnknownSymbol(symbol.to_string()))
    }

    /// The mid price, when the venue has quoted the symbol.
    pub fn mid_price(&self, symbol: &str) -> Result<f64, ClientError> {
        let t = self.ticker(symbol)?;
        Ok((t.bid + t.ask) / 2.0)
    }

    /// Validate an order before submission.
    pub fn validate_order(
        &self,
        symbol: &str,
        quantity: f64,
        price: Option<f64>,
    ) -> Result<(), ClientError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(ClientError::InvalidQuantity(quantity));
        }
        if let Some(p) = price {
            if !p.is_finite() || p <= 0.0 {
                return Err(ClientError::InvalidPrice(p));
            }
        }
        // A symbol with no quote cannot be traded.
        self.ticker(symbol)?;
        Ok(())
    }
}

impl ExchangeClient for TigerExClient {
    fn venue(&self) -> Venue {
        self.venue
    }

    fn ticker(&self, symbol: &str) -> Result<Ticker, ClientError> {
        TigerExClient::ticker(self, symbol)
    }
}

/// Aggregates quotes across TigerEx's own venues.
pub struct VenueAggregator {
    clients: Vec<TigerExClient>,
}

impl VenueAggregator {
    pub fn new() -> Self {
        Self {
            clients: Vec::new(),
        }
    }

    pub fn add_client(&mut self, client: TigerExClient) {
        self.clients.push(client);
    }

    /// Best price across the venues that have quoted the symbol.
    ///
    /// Returns `None` when no venue has a quote, rather than inventing one.
    pub fn best_price(&self, symbol: &str) -> Option<(f64, Venue)> {
        self.clients
            .iter()
            .filter_map(|c| c.ticker(symbol).ok().map(|t| (t.last, c.venue())))
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
    }

    pub fn venues(&self) -> Vec<Venue> {
        self.clients.iter().map(|c| c.venue()).collect()
    }
}

impl Default for VenueAggregator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot() -> TigerExClient {
        let mut c = TigerExClient::new(Venue::Spot, "key").unwrap();
        c.record_quote("BTC/USDT", 49_990.0, 50_010.0, 50_000.0, 1_234.5)
            .unwrap();
        c
    }

    #[test]
    fn quotes_are_reported_as_supplied() {
        let c = spot();
        let t = c.ticker("BTC/USDT").unwrap();

        // The old client invented a 0.1% spread and a volume of 1,000,000.
        assert_eq!(t.bid, 49_990.0);
        assert_eq!(t.ask, 50_010.0);
        assert_eq!(t.volume, 1_234.5);
        assert_eq!(c.mid_price("BTC/USDT").unwrap(), 50_000.0);
    }

    #[test]
    fn invalid_quotes_are_rejected() {
        let mut c = TigerExClient::new(Venue::Spot, "key").unwrap();
        assert!(c.record_quote("", 1.0, 1.0, 1.0, 0.0).is_err());
        assert!(c.record_quote("BTC/USDT", -1.0, 1.0, 1.0, 0.0).is_err());
        assert!(c.record_quote("BTC/USDT", 1.0, f64::NAN, 1.0, 0.0).is_err());
        // A crossed book (bid above ask) is not a valid quote.
        assert!(c.record_quote("BTC/USDT", 100.0, 50.0, 75.0, 0.0).is_err());
        assert!(c.ticker("BTC/USDT").is_err());
    }

    #[test]
    fn an_empty_api_key_is_rejected() {
        assert!(TigerExClient::new(Venue::Spot, "").is_err());
    }

    #[test]
    fn orders_require_a_quote_and_a_valid_quantity() {
        let c = spot();
        c.validate_order("BTC/USDT", 1.0, Some(50_000.0)).unwrap();
        assert!(c.validate_order("BTC/USDT", -1.0, None).is_err());
        assert!(c.validate_order("BTC/USDT", 1.0, Some(-1.0)).is_err());
        assert!(c.validate_order("NOPE/USDT", 1.0, None).is_err());
    }

    #[test]
    fn the_aggregator_picks_the_best_recorded_price() {
        let mut agg = VenueAggregator::new();
        agg.add_client(spot());

        let mut pool = TigerExClient::new(Venue::Pool, "key").unwrap();
        pool.record_quote("BTC/USDT", 50_400.0, 50_420.0, 50_410.0, 300.0)
            .unwrap();
        agg.add_client(pool);

        let (price, venue) = agg.best_price("BTC/USDT").unwrap();
        assert_eq!(price, 50_410.0);
        assert_eq!(venue, Venue::Pool);
        // No quotes anywhere means no price, not an invented one.
        assert!(agg.best_price("ETH/USDT").is_none());
    }
}
