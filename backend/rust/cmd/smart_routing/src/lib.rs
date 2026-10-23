//! Smart order routing for TigerEx.
//!
//! Routing runs only over TigerEx's own venues. Quotes are supplied by the
//! venue adapters; a venue with no quote is skipped, and routing fails closed
//! when no venue can fill. Prices are never invented.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct RFQQuote {
    pub venue: String,
    pub price: f64,
    pub quantity: f64,
    pub fee_rate: f64,
    pub gasless: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub legs: Vec<RFQQuote>,
    pub total_quantity: f64,
    pub average_price: f64,
    pub total_fee: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoutingError {
    EmptyVenue,
    EmptyAsset,
    InvalidQuote(String),
    NoQuotes(String),
    InvalidQuantity(f64),
    InsufficientLiquidity { requested: f64, available: f64 },
}

impl std::fmt::Display for RoutingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoutingError::EmptyVenue => write!(f, "venue name must not be empty"),
            RoutingError::EmptyAsset => write!(f, "asset must not be empty"),
            RoutingError::InvalidQuote(venue) => write!(f, "venue {venue} produced an invalid quote"),
            RoutingError::NoQuotes(asset) => write!(f, "no venue has a quote for {asset}"),
            RoutingError::InvalidQuantity(qty) => write!(f, "quantity {qty} must be positive and finite"),
            RoutingError::InsufficientLiquidity { requested, available } => write!(
                f,
                "insufficient liquidity: requested {requested}, available {available}"
            ),
        }
    }
}

impl std::error::Error for RoutingError {}

pub struct SmartRoutingService {
    /// Registered TigerEx venues.
    venues: RwLock<Vec<String>>,
    /// Quotes keyed by venue then asset, each sorted by price ascending.
    quotes: RwLock<HashMap<String, HashMap<String, Vec<RFQQuote>>>>,
}

impl Default for SmartRoutingService {
    fn default() -> Self {
        Self::new()
    }
}

impl SmartRoutingService {
    pub fn new() -> Self {
        Self {
            venues: RwLock::new(Vec::new()),
            quotes: RwLock::new(HashMap::new()),
        }
    }

    /// Register a TigerEx venue (for example "tigerex-spot").
    pub fn register_venue(&self, venue: &str) -> Result<(), RoutingError> {
        if venue.trim().is_empty() {
            return Err(RoutingError::EmptyVenue);
        }
        let mut venues = self.venues.write().unwrap();
        if !venues.iter().any(|v| v == venue) {
            venues.push(venue.to_string());
        }
        Ok(())
    }

    pub fn venues(&self) -> Vec<String> {
        self.venues.read().unwrap().clone()
    }

    /// Publish quotes for a venue. Prices and quantities must be positive.
    pub fn set_quotes(&self, venue: &str, asset: &str, quotes: Vec<RFQQuote>) -> Result<(), RoutingError> {
        if venue.trim().is_empty() {
            return Err(RoutingError::EmptyVenue);
        }
        if asset.trim().is_empty() {
            return Err(RoutingError::EmptyAsset);
        }
        if quotes.iter().any(|q| {
            !q.price.is_finite()
                || q.price <= 0.0
                || !q.quantity.is_finite()
                || q.quantity <= 0.0
                || !q.fee_rate.is_finite()
                || q.fee_rate < 0.0
        }) {
            return Err(RoutingError::InvalidQuote(venue.to_string()));
        }

        let mut sorted = quotes;
        sorted.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());

        self.quotes
            .write()
            .unwrap()
            .entry(venue.to_string())
            .or_default()
            .insert(asset.to_string(), sorted);
        Ok(())
    }

    /// Best single quote for an asset across all registered venues.
    pub fn best_quote(&self, asset: &str, quantity: f64) -> Result<RFQQuote, RoutingError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(RoutingError::InvalidQuantity(quantity));
        }
        let venues = self.venues.read().unwrap();
        let quotes = self.quotes.read().unwrap();

        let mut best: Option<RFQQuote> = None;
        for venue in venues.iter() {
            if let Some(book) = quotes.get(venue) {
                if let Some(levels) = book.get(asset) {
                    if let Some(level) = levels.iter().find(|q| q.quantity >= quantity) {
                        if best.as_ref().map(|b| level.price < b.price).unwrap_or(true) {
                            best = Some(level.clone());
                        }
                    }
                }
            }
        }

        best.ok_or_else(|| RoutingError::NoQuotes(asset.to_string()))
    }

    /// Route an order across venues, consuming the cheapest levels first.
    pub fn route(&self, asset: &str, quantity: f64) -> Result<Route, RoutingError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(RoutingError::InvalidQuantity(quantity));
        }
        if asset.trim().is_empty() {
            return Err(RoutingError::EmptyAsset);
        }

        let venues = self.venues.read().unwrap();
        let quotes = self.quotes.read().unwrap();

        // Flatten all levels from all venues and sort by price.
        let mut levels: Vec<RFQQuote> = Vec::new();
        for venue in venues.iter() {
            if let Some(book) = quotes.get(venue) {
                if let Some(asset_levels) = book.get(asset) {
                    levels.extend(asset_levels.iter().cloned());
                }
            }
        }
        if levels.is_empty() {
            return Err(RoutingError::NoQuotes(asset.to_string()));
        }
        levels.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());

        let mut remaining = quantity;
        let mut legs = Vec::new();
        let mut notional = 0.0;
        let mut fees = 0.0;

        for level in levels {
            if remaining <= 0.0 {
                break;
            }
            let take = remaining.min(level.quantity);
            notional += take * level.price;
            fees += take * level.price * level.fee_rate;
            remaining -= take;

            legs.push(RFQQuote {
                venue: level.venue.clone(),
                price: level.price,
                quantity: take,
                fee_rate: level.fee_rate,
                gasless: level.gasless,
            });
        }

        if remaining > 1e-12 {
            let available = quantity - remaining;
            return Err(RoutingError::InsufficientLiquidity {
                requested: quantity,
                available,
            });
        }

        Ok(Route {
            total_quantity: quantity,
            average_price: notional / quantity,
            total_fee: fees,
            legs,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote(venue: &str, price: f64, quantity: f64) -> RFQQuote {
        RFQQuote {
            venue: venue.to_string(),
            price,
            quantity,
            fee_rate: 0.001,
            gasless: false,
        }
    }

    fn service() -> SmartRoutingService {
        let service = SmartRoutingService::new();
        service.register_venue("tigerex-spot").unwrap();
        service.register_venue("tigerex-futures").unwrap();
        service
    }

    #[test]
    fn rejects_empty_venue_and_asset() {
        let service = SmartRoutingService::new();
        assert_eq!(service.register_venue("  ").unwrap_err(), RoutingError::EmptyVenue);
        assert_eq!(
            service.set_quotes("tigerex-spot", "", vec![]).unwrap_err(),
            RoutingError::EmptyAsset
        );
    }

    #[test]
    fn rejects_invalid_quotes() {
        let service = service();
        assert!(matches!(
            service
                .set_quotes("tigerex-spot", "BTCUSDT", vec![quote("tigerex-spot", 0.0, 1.0)])
                .unwrap_err(),
            RoutingError::InvalidQuote(_)
        ));
    }

    #[test]
    fn fails_closed_without_quotes() {
        let service = service();
        assert!(matches!(
            service.best_quote("BTCUSDT", 1.0).unwrap_err(),
            RoutingError::NoQuotes(_)
        ));
        assert!(matches!(
            service.route("BTCUSDT", 1.0).unwrap_err(),
            RoutingError::NoQuotes(_)
        ));
    }

    #[test]
    fn picks_cheapest_venue() {
        let service = service();
        service.set_quotes("tigerex-spot", "BTCUSDT", vec![quote("tigerex-spot", 100.0, 5.0)]).unwrap();
        service
            .set_quotes("tigerex-futures", "BTCUSDT", vec![quote("tigerex-futures", 99.0, 5.0)])
            .unwrap();

        let best = service.best_quote("BTCUSDT", 1.0).unwrap();
        assert_eq!(best.venue, "tigerex-futures");
        assert!((best.price - 99.0).abs() < 1e-9);
    }

    #[test]
    fn routes_across_venues_and_prices_correctly() {
        let service = service();
        service.set_quotes("tigerex-spot", "BTCUSDT", vec![quote("tigerex-spot", 100.0, 2.0)]).unwrap();
        service
            .set_quotes("tigerex-futures", "BTCUSDT", vec![quote("tigerex-futures", 101.0, 3.0)])
            .unwrap();

        let route = service.route("BTCUSDT", 4.0).unwrap();
        // 2 @ 100 + 2 @ 101 = 402 / 4 = 100.5
        assert!((route.average_price - 100.5).abs() < 1e-9);
        assert_eq!(route.legs.len(), 2);
        assert!((route.total_fee - (200.0 * 0.001 + 202.0 * 0.001)).abs() < 1e-9);
    }

    #[test]
    fn fails_closed_on_insufficient_liquidity() {
        let service = service();
        service.set_quotes("tigerex-spot", "BTCUSDT", vec![quote("tigerex-spot", 100.0, 1.0)]).unwrap();
        assert!(matches!(
            service.route("BTCUSDT", 5.0).unwrap_err(),
            RoutingError::InsufficientLiquidity { .. }
        ));
    }
}
