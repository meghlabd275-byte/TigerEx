//! Dark pool order matching.
//!
//! The previous implementation matched any two consecutive orders regardless
//! of side, asset or price, so two buys (or two orders in different assets)
//! were reported as a fill. Matching is now side-aware, asset-scoped and
//! price-crossing.

use std::collections::VecDeque;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct DarkOrder {
    pub id: String,
    pub side: Side,
    pub asset: String,
    pub qty: f64,
    /// Limit price; a market order carries `None`.
    pub price: Option<f64>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DarkFill {
    pub buy_order_id: String,
    pub sell_order_id: String,
    pub asset: String,
    pub price: f64,
    pub qty: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DarkPoolError {
    InvalidQuantity(f64),
    InvalidPrice(f64),
    EmptyAsset,
    UnknownOrder(String),
}

impl std::fmt::Display for DarkPoolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DarkPoolError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
            DarkPoolError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            DarkPoolError::EmptyAsset => write!(f, "asset must not be empty"),
            DarkPoolError::UnknownOrder(id) => write!(f, "unknown order: {id}"),
        }
    }
}

impl std::error::Error for DarkPoolError {}

pub struct DarkPoolService {
    orders: RwLock<VecDeque<DarkOrder>>,
    hidden_mode: RwLock<bool>,
    next_id: RwLock<u64>,
}

impl DarkPoolService {
    pub fn new() -> Self {
        Self {
            orders: RwLock::new(VecDeque::new()),
            hidden_mode: RwLock::new(true),
            next_id: RwLock::new(1),
        }
    }

    pub fn set_hidden_mode(&self, hidden: bool) {
        *self.hidden_mode.write().unwrap() = hidden;
    }

    pub fn submit(
        &self,
        side: Side,
        asset: &str,
        qty: f64,
        price: Option<f64>,
    ) -> Result<DarkOrder, DarkPoolError> {
        if asset.trim().is_empty() {
            return Err(DarkPoolError::EmptyAsset);
        }
        if !qty.is_finite() || qty <= 0.0 {
            return Err(DarkPoolError::InvalidQuantity(qty));
        }
        if let Some(p) = price {
            if !p.is_finite() || p <= 0.0 {
                return Err(DarkPoolError::InvalidPrice(p));
            }
        }

        let hidden = *self.hidden_mode.read().unwrap();
        let mut next_id = self.next_id.write().unwrap();
        let id = format!("dp_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let order = DarkOrder {
            id,
            side,
            asset: asset.to_string(),
            qty,
            price,
            hidden,
        };
        self.orders.write().unwrap().push_back(order.clone());
        Ok(order)
    }

    /// Cancel a resting order.
    pub fn cancel(&self, order_id: &str) -> Result<DarkOrder, DarkPoolError> {
        let mut orders = self.orders.write().unwrap();
        let pos = orders
            .iter()
            .position(|o| o.id == order_id)
            .ok_or_else(|| DarkPoolError::UnknownOrder(order_id.to_string()))?;
        Ok(orders.remove(pos).expect("position checked above"))
    }

    /// Match crossing orders within the same asset, buying against selling.
    ///
    /// Two orders cross when the buy price is at least the sell price; a
    /// market order on either side always crosses. Each order fills at most
    /// once.
    pub fn match_orders(&self) -> Vec<DarkFill> {
        let mut orders = self.orders.write().unwrap();
        let mut fills = Vec::new();
        let mut used = vec![false; orders.len()];

        for i in 0..orders.len() {
            if used[i] || orders[i].side != Side::Buy {
                continue;
            }
            for j in 0..orders.len() {
                if used[j] || i == j {
                    continue;
                }
                if orders[j].side != Side::Sell || orders[j].asset != orders[i].asset {
                    continue;
                }

                // A crossing needs a price on both sides. Treating a missing
                // price as an unconditional cross fabricated a fill at 0.0.
                let crosses = match (orders[i].price, orders[j].price) {
                    (Some(buy), Some(sell)) => buy >= sell,
                    _ => false,
                };
                if !crosses {
                    continue;
                }

                let buy_price = orders[i].price.or(orders[j].price).unwrap_or(0.0);
                let qty = orders[i].qty.min(orders[j].qty);
                fills.push(DarkFill {
                    buy_order_id: orders[i].id.clone(),
                    sell_order_id: orders[j].id.clone(),
                    asset: orders[i].asset.clone(),
                    price: buy_price,
                    qty,
                });
                used[i] = true;
                used[j] = true;
                break;
            }
        }

        // Remove matched orders, preserving the order of the remainder.
        let mut index = 0;
        orders.retain(|_| {
            let keep = !used[index];
            index += 1;
            keep
        });
        fills
    }

    pub fn resting_count(&self) -> usize {
        self.orders.read().unwrap().len()
    }
}

impl Default for DarkPoolService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_buys_do_not_match() {
        let svc = DarkPoolService::new();
        svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(50_000.0)).unwrap();
        svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(50_000.0)).unwrap();

        // The old implementation reported a fill here.
        assert!(svc.match_orders().is_empty());
        assert_eq!(svc.resting_count(), 2);
    }

    #[test]
    fn orders_in_different_assets_do_not_match() {
        let svc = DarkPoolService::new();
        svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(50_000.0)).unwrap();
        svc.submit(Side::Sell, "ETH/USDT", 1.0, Some(3_000.0)).unwrap();

        assert!(svc.match_orders().is_empty());
    }

    #[test]
    fn non_crossing_orders_do_not_match() {
        let svc = DarkPoolService::new();
        svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(49_000.0)).unwrap();
        svc.submit(Side::Sell, "BTC/USDT", 1.0, Some(50_000.0)).unwrap();

        assert!(svc.match_orders().is_empty());
    }

    #[test]
    fn crossing_orders_match_at_the_buy_price() {
        let svc = DarkPoolService::new();
        let buy = svc.submit(Side::Buy, "BTC/USDT", 2.0, Some(50_000.0)).unwrap();
        let sell = svc.submit(Side::Sell, "BTC/USDT", 1.0, Some(49_500.0)).unwrap();

        let fills = svc.match_orders();
        assert_eq!(fills.len(), 1);
        assert_eq!(fills[0].buy_order_id, buy.id);
        assert_eq!(fills[0].sell_order_id, sell.id);
        assert_eq!(fills[0].price, 50_000.0);
        assert_eq!(fills[0].qty, 1.0);
        assert_eq!(svc.resting_count(), 0);
    }

    #[test]
    fn invalid_orders_are_rejected() {
        let svc = DarkPoolService::new();
        assert!(svc.submit(Side::Buy, "BTC/USDT", -1.0, Some(50_000.0)).is_err());
        assert!(svc.submit(Side::Buy, "BTC/USDT", f64::NAN, Some(50_000.0)).is_err());
        assert!(svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(-1.0)).is_err());
        assert!(svc.submit(Side::Buy, "", 1.0, Some(50_000.0)).is_err());
        assert_eq!(svc.resting_count(), 0);
    }

    #[test]
    fn orders_can_be_cancelled() {
        let svc = DarkPoolService::new();
        let order = svc.submit(Side::Buy, "BTC/USDT", 1.0, Some(50_000.0)).unwrap();

        svc.cancel(&order.id).unwrap();
        assert_eq!(svc.resting_count(), 0);
        assert!(svc.cancel(&order.id).is_err());
    }
}
