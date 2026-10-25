//! TigerEx client SDK.
//!
//! The previous implementation was a stub: `connect` returned a formatted
//! string, `place_order` echoed its inputs without recording anything,
//! `cancel_order` did nothing, and `get_balance` always returned a fabricated
//! 10,000 for every asset.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Order {
    pub id: String,
    pub symbol: String,
    pub side: Side,
    pub quantity: f64,
    pub price: Option<f64>,
    pub status: OrderStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Open,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SdkError {
    NotConnected,
    EmptyEndpoint,
    EmptySymbol,
    InvalidQuantity(f64),
    InvalidPrice(f64),
    UnknownAsset(String),
    UnknownOrder(String),
    AlreadyCancelled(String),
}

impl std::fmt::Display for SdkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SdkError::NotConnected => write!(f, "client is not connected"),
            SdkError::EmptyEndpoint => write!(f, "endpoint must not be empty"),
            SdkError::EmptySymbol => write!(f, "symbol must not be empty"),
            SdkError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
            SdkError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            SdkError::UnknownAsset(a) => write!(f, "no balance recorded for {a}"),
            SdkError::UnknownOrder(id) => write!(f, "unknown order: {id}"),
            SdkError::AlreadyCancelled(id) => write!(f, "order {id} is already cancelled"),
        }
    }
}

impl std::error::Error for SdkError {}

/// A client bound to one endpoint.
pub struct Client {
    endpoint: Option<String>,
    /// Balances the caller has recorded, keyed by asset.
    balances: RwLock<HashMap<String, f64>>,
    orders: RwLock<HashMap<String, Order>>,
    next_id: RwLock<u64>,
}

impl Client {
    pub fn new() -> Self {
        Self {
            endpoint: None,
            balances: RwLock::new(HashMap::new()),
            orders: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Bind the client to an endpoint.
    pub fn connect(&mut self, endpoint: &str) -> Result<(), SdkError> {
        if endpoint.trim().is_empty() {
            return Err(SdkError::EmptyEndpoint);
        }
        self.endpoint = Some(endpoint.to_string());
        Ok(())
    }

    pub fn endpoint(&self) -> Option<&str> {
        self.endpoint.as_deref()
    }

    pub fn is_connected(&self) -> bool {
        self.endpoint.is_some()
    }

    /// Record a balance the client knows about.
    pub fn set_balance(&self, asset: &str, amount: f64) -> Result<(), SdkError> {
        if !amount.is_finite() || amount < 0.0 {
            return Err(SdkError::InvalidQuantity(amount));
        }
        self.balances
            .write()
            .unwrap()
            .insert(asset.to_string(), amount);
        Ok(())
    }

    /// The recorded balance for an asset.
    ///
    /// Errors for an unknown asset instead of returning an invented amount.
    pub fn get_balance(&self, asset: &str) -> Result<f64, SdkError> {
        self.balances
            .read()
            .unwrap()
            .get(asset)
            .copied()
            .ok_or_else(|| SdkError::UnknownAsset(asset.to_string()))
    }

    /// Submit an order. The client must be connected.
    pub fn place_order(
        &self,
        symbol: &str,
        side: Side,
        quantity: f64,
        price: Option<f64>,
    ) -> Result<Order, SdkError> {
        if !self.is_connected() {
            return Err(SdkError::NotConnected);
        }
        if symbol.trim().is_empty() {
            return Err(SdkError::EmptySymbol);
        }
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(SdkError::InvalidQuantity(quantity));
        }
        if let Some(p) = price {
            if !p.is_finite() || p <= 0.0 {
                return Err(SdkError::InvalidPrice(p));
            }
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("ord_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let order = Order {
            id: id.clone(),
            symbol: symbol.to_string(),
            side,
            quantity,
            price,
            status: OrderStatus::Open,
        };
        self.orders.write().unwrap().insert(id, order.clone());
        Ok(order)
    }

    /// Cancel an open order.
    pub fn cancel_order(&self, order_id: &str) -> Result<Order, SdkError> {
        let mut orders = self.orders.write().unwrap();
        let order = orders
            .get_mut(order_id)
            .ok_or_else(|| SdkError::UnknownOrder(order_id.to_string()))?;
        if order.status == OrderStatus::Cancelled {
            return Err(SdkError::AlreadyCancelled(order_id.to_string()));
        }
        order.status = OrderStatus::Cancelled;
        Ok(order.clone())
    }

    pub fn order(&self, order_id: &str) -> Option<Order> {
        self.orders.read().unwrap().get(order_id).cloned()
    }

    pub fn open_order_count(&self) -> usize {
        self.orders
            .read()
            .unwrap()
            .values()
            .filter(|o| o.status == OrderStatus::Open)
            .count()
    }
}

impl Default for Client {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected() -> Client {
        let mut c = Client::new();
        c.connect("https://api.tigerex.example").unwrap();
        c
    }

    #[test]
    fn balances_are_not_fabricated() {
        let c = Client::new();
        // The old implementation returned 10,000 for every asset.
        assert!(matches!(
            c.get_balance("BTC").unwrap_err(),
            SdkError::UnknownAsset(_)
        ));

        c.set_balance("BTC", 0.5).unwrap();
        assert_eq!(c.get_balance("BTC").unwrap(), 0.5);
    }

    #[test]
    fn orders_are_recorded_and_cancelled() {
        let c = connected();
        let order = c.place_order("BTC/USDT", Side::Buy, 1.0, Some(50_000.0)).unwrap();

        assert_eq!(c.open_order_count(), 1);
        assert!(c.order(&order.id).is_some());

        // The old cancel_order did nothing.
        let cancelled = c.cancel_order(&order.id).unwrap();
        assert_eq!(cancelled.status, OrderStatus::Cancelled);
        assert_eq!(c.open_order_count(), 0);
        assert!(matches!(
            c.cancel_order(&order.id).unwrap_err(),
            SdkError::AlreadyCancelled(_)
        ));
    }

    #[test]
    fn orders_require_a_connection() {
        let c = Client::new();
        assert!(matches!(
            c.place_order("BTC/USDT", Side::Buy, 1.0, None).unwrap_err(),
            SdkError::NotConnected
        ));
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let mut c = Client::new();
        assert!(c.connect("").is_err());
        c.connect("endpoint").unwrap();

        assert!(c.place_order("", Side::Buy, 1.0, None).is_err());
        assert!(c.place_order("BTC/USDT", Side::Buy, -1.0, None).is_err());
        assert!(c.place_order("BTC/USDT", Side::Buy, 1.0, Some(-1.0)).is_err());
        assert!(c.cancel_order("ord_missing").is_err());
        assert_eq!(c.open_order_count(), 0);
    }

    #[test]
    fn order_ids_are_unique() {
        let c = connected();
        let a = c.place_order("BTC/USDT", Side::Buy, 1.0, None).unwrap();
        let b = c.place_order("BTC/USDT", Side::Sell, 1.0, None).unwrap();
        assert_ne!(a.id, b.id);
    }
}
