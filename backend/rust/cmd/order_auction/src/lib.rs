//! Uniform-price batch auctions.
//!
//! The previous implementation never stored submitted orders (`submit` only
//! returned an id), `execute_batch` always returned 0, and `active` was
//! toggled but never consulted. Auctions therefore never executed.
//!
//! Orders are now collected while an auction is running, then cleared at a
//! single uniform price: the price that maximises matched volume, with ties
//! broken toward the smallest imbalance.

use std::collections::HashSet;
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuctionOrder {
    pub id: String,
    pub user_id: String,
    pub side: Side,
    pub price: f64,
    pub qty: f64,
}

/// A single fill produced by clearing.
#[derive(Debug, Clone, PartialEq)]
pub struct Fill {
    pub order_id: String,
    pub user_id: String,
    pub side: Side,
    pub price: f64,
    pub qty: f64,
}

/// The result of clearing one batch.
#[derive(Debug, Clone, PartialEq)]
pub struct AuctionResult {
    pub clearing_price: f64,
    pub matched_volume: f64,
    pub fills: Vec<Fill>,
    /// Orders that received no fill.
    pub unfilled: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AuctionError {
    InvalidOrder(&'static str),
    AuctionClosed,
    NoOrders,
}

impl std::fmt::Display for AuctionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuctionError::InvalidOrder(field) => write!(f, "invalid order field: {field}"),
            AuctionError::AuctionClosed => write!(f, "the auction is not accepting orders"),
            AuctionError::NoOrders => write!(f, "no orders to clear"),
        }
    }
}

impl std::error::Error for AuctionError {}

pub struct OrderAuctionService {
    /// Batches queued by earlier `end_auction` calls.
    batches: RwLock<Vec<Vec<AuctionOrder>>>,
    /// Orders in the currently open batch.
    pending: RwLock<Vec<AuctionOrder>>,
    active: RwLock<bool>,
    next_id: RwLock<u64>,
}

impl OrderAuctionService {
    pub fn new() -> Self {
        Self {
            batches: RwLock::new(Vec::new()),
            pending: RwLock::new(Vec::new()),
            active: RwLock::new(false),
            next_id: RwLock::new(1),
        }
    }

    pub fn start_auction(&self) {
        *self.active.write().unwrap() = true;
        self.pending.write().unwrap().clear();
    }

    /// Close the current auction, queueing its orders for clearing.
    pub fn end_auction(&self) {
        *self.active.write().unwrap() = false;
        let mut pending = self.pending.write().unwrap();
        if !pending.is_empty() {
            self.batches.write().unwrap().push(std::mem::take(&mut *pending));
        }
    }

    pub fn is_active(&self) -> bool {
        *self.active.read().unwrap()
    }

    /// Submit an order into the open auction.
    pub fn submit(
        &self,
        user_id: &str,
        side: Side,
        price: f64,
        qty: f64,
    ) -> Result<String, AuctionError> {
        if !self.is_active() {
            return Err(AuctionError::AuctionClosed);
        }
        if user_id.trim().is_empty() {
            return Err(AuctionError::InvalidOrder("user_id"));
        }
        if !price.is_finite() || price <= 0.0 {
            return Err(AuctionError::InvalidOrder("price"));
        }
        if !qty.is_finite() || qty <= 0.0 {
            return Err(AuctionError::InvalidOrder("qty"));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("auct_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.pending.write().unwrap().push(AuctionOrder {
            id: id.clone(),
            user_id: user_id.to_string(),
            side,
            price,
            qty,
        });
        Ok(id)
    }

    /// Number of orders waiting in the open auction.
    pub fn pending_count(&self) -> usize {
        self.pending.read().unwrap().len()
    }

    /// Clear every queued batch, returning the results in order.
    pub fn execute_batch(&self) -> Vec<AuctionResult> {
        let batches = {
            let mut batches = self.batches.write().unwrap();
            std::mem::take(&mut *batches)
        };

        batches
            .into_iter()
            .filter_map(|orders| clear_batch(&orders).ok())
            .collect()
    }

    /// Clear a single batch of orders without going through the queue.
    pub fn clear(&self, orders: &[AuctionOrder]) -> Result<AuctionResult, AuctionError> {
        clear_batch(orders)
    }
}

impl Default for OrderAuctionService {
    fn default() -> Self {
        Self::new()
    }
}

/// Clear orders at the uniform price maximising matched volume.
fn clear_batch(orders: &[AuctionOrder]) -> Result<AuctionResult, AuctionError> {
    if orders.is_empty() {
        return Err(AuctionError::NoOrders);
    }

    // Candidate prices are the distinct limit prices.
    let mut candidates: Vec<f64> = orders.iter().map(|o| o.price).collect();
    candidates.sort_by(|a, b| a.partial_cmp(b).expect("validated finite prices"));
    candidates.dedup();

    let mut best: Option<(f64, f64, f64)> = None; // (price, volume, imbalance)
    for &price in &candidates {
        let demand: f64 = orders
            .iter()
            .filter(|o| o.side == Side::Buy && o.price >= price)
            .map(|o| o.qty)
            .sum();
        let supply: f64 = orders
            .iter()
            .filter(|o| o.side == Side::Sell && o.price <= price)
            .map(|o| o.qty)
            .sum();

        let volume = demand.min(supply);
        let imbalance = (demand - supply).abs();

        best = match best {
            None => Some((price, volume, imbalance)),
            Some((_, best_volume, best_imbalance)) => {
                // Maximise volume; on a tie prefer the smaller imbalance.
                if volume > best_volume
                    || (volume == best_volume && imbalance < best_imbalance)
                {
                    Some((price, volume, imbalance))
                } else {
                    best
                }
            }
        };
    }

    let (clearing_price, matched_volume, _) = best.expect("candidates is non-empty");

    // Allocate fills pro-rata across eligible orders on the constrained side.
    let mut fills = Vec::new();
    let mut unfilled = Vec::new();

    let eligible_buys: Vec<&AuctionOrder> = orders
        .iter()
        .filter(|o| o.side == Side::Buy && o.price >= clearing_price)
        .collect();
    let eligible_sells: Vec<&AuctionOrder> = orders
        .iter()
        .filter(|o| o.side == Side::Sell && o.price <= clearing_price)
        .collect();

    let buy_total: f64 = eligible_buys.iter().map(|o| o.qty).sum();
    let sell_total: f64 = eligible_sells.iter().map(|o| o.qty).sum();

    allocate(&eligible_buys, buy_total, matched_volume, clearing_price, &mut fills);
    allocate(&eligible_sells, sell_total, matched_volume, clearing_price, &mut fills);

    // An order is unfilled when it received no allocation, which also covers
    // price-eligible orders that got nothing because the batch did not cross.
    let filled: HashSet<&str> =
        fills.iter().map(|f| f.order_id.as_str()).collect();
    for order in orders {
        if !filled.contains(order.id.as_str()) {
            unfilled.push(order.id.clone());
        }
    }

    Ok(AuctionResult {
        clearing_price,
        matched_volume,
        fills,
        unfilled,
    })
}

fn allocate(
    orders: &[&AuctionOrder],
    total: f64,
    matched_volume: f64,
    price: f64,
    fills: &mut Vec<Fill>,
) {
    if total <= 0.0 || matched_volume <= 0.0 {
        return;
    }
    let ratio = matched_volume / total;

    let mut remaining = matched_volume;
    for (index, order) in orders.iter().enumerate() {
        let qty = if index == orders.len() - 1 {
            // Give the remainder to the last order so fills sum exactly.
            remaining.min(order.qty)
        } else {
            (order.qty * ratio).min(order.qty)
        };
        remaining -= qty;

        if qty > 0.0 {
            fills.push(Fill {
                order_id: order.id.clone(),
                user_id: order.user_id.clone(),
                side: order.side,
                price,
                qty,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(id: &str, side: Side, price: f64, qty: f64) -> AuctionOrder {
        AuctionOrder {
            id: id.to_string(),
            user_id: format!("user_{id}"),
            side,
            price,
            qty,
        }
    }

    #[test]
    fn submit_requires_an_open_auction() {
        let svc = OrderAuctionService::new();
        // The old implementation returned an id even with no auction running.
        assert_eq!(
            svc.submit("u1", Side::Buy, 100.0, 1.0).unwrap_err(),
            AuctionError::AuctionClosed
        );

        svc.start_auction();
        assert!(svc.submit("u1", Side::Buy, 100.0, 1.0).is_ok());
        assert_eq!(svc.pending_count(), 1);
    }

    #[test]
    fn invalid_orders_are_rejected() {
        let svc = OrderAuctionService::new();
        svc.start_auction();

        assert!(svc.submit("u1", Side::Buy, 0.0, 1.0).is_err());
        assert!(svc.submit("u1", Side::Buy, 100.0, -1.0).is_err());
        assert!(svc.submit("u1", Side::Buy, f64::NAN, 1.0).is_err());
        assert!(svc.submit("  ", Side::Buy, 100.0, 1.0).is_err());
    }

    #[test]
    fn crossing_orders_clear_at_a_uniform_price() {
        let svc = OrderAuctionService::new();
        let orders = vec![
            order("b1", Side::Buy, 105.0, 2.0),
            order("b2", Side::Buy, 100.0, 3.0),
            order("s1", Side::Sell, 98.0, 2.0),
            order("s2", Side::Sell, 102.0, 3.0),
        ];

        let result = svc.clear(&orders).unwrap();
        assert!(result.matched_volume > 0.0);
        // Every fill uses the same price.
        assert!(result.fills.iter().all(|f| f.price == result.clearing_price));
        // Fills net out across sides.
        let bought: f64 = result
            .fills
            .iter()
            .filter(|f| f.side == Side::Buy)
            .map(|f| f.qty)
            .sum();
        let sold: f64 = result
            .fills
            .iter()
            .filter(|f| f.side == Side::Sell)
            .map(|f| f.qty)
            .sum();
        assert!((bought - sold).abs() < 1e-9);
        assert!((bought - result.matched_volume).abs() < 1e-9);
    }

    #[test]
    fn clearing_picks_the_maximum_volume_price() {
        let svc = OrderAuctionService::new();
        // Demand of 5 at 100, supply of 5 at 100, so 100 clears everything.
        let orders = vec![
            order("b1", Side::Buy, 100.0, 5.0),
            order("s1", Side::Sell, 100.0, 5.0),
        ];

        let result = svc.clear(&orders).unwrap();
        assert_eq!(result.clearing_price, 100.0);
        assert_eq!(result.matched_volume, 5.0);
        assert!(result.unfilled.is_empty());
    }

    #[test]
    fn non_crossing_orders_produce_no_volume() {
        let svc = OrderAuctionService::new();
        let orders = vec![
            order("b1", Side::Buy, 90.0, 5.0),
            order("s1", Side::Sell, 110.0, 5.0),
        ];

        let result = svc.clear(&orders).unwrap();
        assert_eq!(result.matched_volume, 0.0);
        assert!(result.fills.is_empty());
        assert_eq!(result.unfilled.len(), 2);
    }

    #[test]
    fn end_auction_queues_orders_for_execution() {
        let svc = OrderAuctionService::new();
        svc.start_auction();
        svc.submit("b1", Side::Buy, 100.0, 1.0).unwrap();
        svc.submit("s1", Side::Sell, 100.0, 1.0).unwrap();
        svc.end_auction();

        assert!(!svc.is_active());
        assert_eq!(svc.pending_count(), 0);

        // The old implementation always returned 0 results here.
        let results = svc.execute_batch();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matched_volume, 1.0);

        // The queue is drained, so a second call is empty.
        assert!(svc.execute_batch().is_empty());
    }
}
