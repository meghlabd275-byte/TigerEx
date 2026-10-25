//! On-chain liquidity aggregation for TigerEx.
//!
//! The previous implementation defaulted its enabled-venue list to a rival
//! exchange ("binance"), returned a constant "cex" route regardless of the
//! request, and reported a hardcoded 50,000 depth for any asset.
//!
//! TigerEx does not depend on any other exchange: aggregation here covers
//! TigerEx's own venues and on-chain pools only.

use std::collections::HashMap;
use std::sync::RwLock;

/// A venue TigerEx can route to: one of its own books, or an on-chain pool.
#[derive(Debug, Clone, PartialEq)]
pub struct Venue {
    pub name: String,
    pub kind: VenueKind,
    /// Available liquidity, in quote units.
    pub depth: f64,
    /// Fee as a fraction of notional.
    pub fee: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VenueKind {
    /// A TigerEx order book.
    OwnBook,
    /// An on-chain liquidity pool.
    DexPool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub venue: String,
    pub kind: VenueKind,
    /// Effective cost for the trade: fee plus any price impact.
    pub cost: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AggError {
    EmptyVenue,
    InvalidDepth(f64),
    InvalidFee(f64),
    InvalidNotional(f64),
    NoRoute { asset: String },
}

impl std::fmt::Display for AggError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AggError::EmptyVenue => write!(f, "venue name must not be empty"),
            AggError::InvalidDepth(d) => write!(f, "depth {d} must be finite and positive"),
            AggError::InvalidFee(x) => write!(f, "fee {x} must be finite and within [0, 1)"),
            AggError::InvalidNotional(n) => write!(f, "notional {n} must be finite and positive"),
            AggError::NoRoute { asset } => write!(f, "no venue can route {asset}"),
        }
    }
}

impl std::error::Error for AggError {}

pub struct CEXDEXAggService {
    /// asset -> venues quoting it.
    venues: RwLock<HashMap<String, Vec<Venue>>>,
}

impl CEXDEXAggService {
    pub fn new() -> Self {
        Self {
            venues: RwLock::new(HashMap::new()),
        }
    }

    /// Register a venue quoting an asset.
    pub fn register_venue(
        &self,
        asset: &str,
        name: &str,
        kind: VenueKind,
        depth: f64,
        fee: f64,
    ) -> Result<(), AggError> {
        if name.trim().is_empty() {
            return Err(AggError::EmptyVenue);
        }
        if !depth.is_finite() || depth <= 0.0 {
            return Err(AggError::InvalidDepth(depth));
        }
        if !fee.is_finite() || fee < 0.0 || fee >= 1.0 {
            return Err(AggError::InvalidFee(fee));
        }

        self.venues
            .write()
            .unwrap()
            .entry(asset.to_string())
            .or_default()
            .push(Venue {
                name: name.to_string(),
                kind,
                depth,
                fee,
            });
        Ok(())
    }

    /// Pick the cheapest venue for a trade of `notional`.
    ///
    /// Cost is the venue fee plus a linear price impact for the share of the
    /// venue's depth the trade consumes.
    pub fn get_best_route(&self, asset: &str, notional: f64) -> Result<Route, AggError> {
        if !notional.is_finite() || notional <= 0.0 {
            return Err(AggError::InvalidNotional(notional));
        }

        let venues = self.venues.read().unwrap();
        let candidates = venues
            .get(asset)
            .ok_or_else(|| AggError::NoRoute { asset: asset.to_string() })?;

        candidates
            .iter()
            .map(|v| {
                let impact = notional / v.depth;
                Route {
                    venue: v.name.clone(),
                    kind: v.kind,
                    cost: v.fee + impact,
                }
            })
            .min_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or_else(|| AggError::NoRoute { asset: asset.to_string() })
    }

    /// Total liquidity registered for an asset.
    pub fn aggregate(&self, asset: &str) -> f64 {
        self.venues
            .read()
            .unwrap()
            .get(asset)
            .map(|v| v.iter().map(|x| x.depth).sum())
            .unwrap_or(0.0)
    }
}

impl Default for CEXDEXAggService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_service_has_no_rival_venues_registered() {
        let svc = CEXDEXAggService::new();
        // The old implementation shipped with a rival exchange pre-enabled.
        assert!(matches!(
            svc.get_best_route("BTC/USDT", 1.0).unwrap_err(),
            AggError::NoRoute { .. }
        ));
        assert_eq!(svc.aggregate("BTC/USDT"), 0.0);
    }

    #[test]
    fn the_cheapest_venue_wins() {
        let svc = CEXDEXAggService::new();
        svc.register_venue("BTC/USDT", "TigerEx-Spot", VenueKind::OwnBook, 5_000_000.0, 0.001)
            .unwrap();
        svc.register_venue("BTC/USDT", "TigerEx-Pool", VenueKind::DexPool, 500_000.0, 0.0005)
            .unwrap();

        // Small trade: the pool's lower fee wins despite shallower depth.
        let route = svc.get_best_route("BTC/USDT", 100.0).unwrap();
        assert_eq!(route.venue, "TigerEx-Pool");

        // Large trade: the book's depth makes it cheaper.
        let route = svc.get_best_route("BTC/USDT", 4_000_000.0).unwrap();
        assert_eq!(route.venue, "TigerEx-Spot");
    }

    #[test]
    fn aggregate_sums_registered_depth() {
        let svc = CEXDEXAggService::new();
        svc.register_venue("BTC/USDT", "A", VenueKind::OwnBook, 1_000.0, 0.001).unwrap();
        svc.register_venue("BTC/USDT", "B", VenueKind::DexPool, 2_000.0, 0.001).unwrap();

        // The old implementation always returned 50,000.
        assert_eq!(svc.aggregate("BTC/USDT"), 3_000.0);
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = CEXDEXAggService::new();
        assert!(svc.register_venue("BTC/USDT", "", VenueKind::OwnBook, 1.0, 0.001).is_err());
        assert!(svc.register_venue("BTC/USDT", "A", VenueKind::OwnBook, -1.0, 0.001).is_err());
        assert!(svc.register_venue("BTC/USDT", "A", VenueKind::OwnBook, 1.0, 1.5).is_err());

        svc.register_venue("BTC/USDT", "A", VenueKind::OwnBook, 1_000.0, 0.001).unwrap();
        assert!(svc.get_best_route("BTC/USDT", -1.0).is_err());
        assert!(svc.get_best_route("BTC/USDT", f64::NAN).is_err());
    }
}
