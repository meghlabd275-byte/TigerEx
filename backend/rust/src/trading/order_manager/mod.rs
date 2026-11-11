// Order Manager - Full order lifecycle in Rust
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ORDER_SEQ: AtomicU64 = AtomicU64::new(0);

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderType {
    Limit,
    Market,
    StopLoss,
    TakeProfit,
    StopLimit,
}

impl Default for OrderType {
    fn default() -> Self { OrderType::Limit }
}

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side { Buy, Sell }

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Pending,
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
    Expired,
}

/// Time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC, // Immediate Or Cancel
    FOK, // Fill Or Kill
    GTD, // Good Till Date
}

impl Default for TimeInForce {
    fn default() -> Self { TimeInForce::GTC }
}

// Order with full validation
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub filled: f64,
    pub status: OrderStatus,
    pub time_in_force: TimeInForce,
    pub stop_price: Option<f64>,
    pub client_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub reasons: Vec<String>,
}

impl Order {
    pub fn new(
        user_id: &str,
        symbol: &str,
        side: Side,
        otype: OrderType,
        price: f64,
        quantity: f64,
    ) -> Self {
        let now = timestamp_ms();
        let seq = ORDER_SEQ.fetch_add(1, Ordering::Relaxed);
        Order {
            id: format!("order_{}_{}_{}", symbol, now, seq),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            order_type: otype,
            price,
            quantity,
            filled: 0.0,
            status: OrderStatus::New,
            time_in_force: TimeInForce::default(),
            stop_price: None,
            client_id: None,
            created_at: now,
            updated_at: now,
            reasons: Vec::new(),
        }
    }

    pub fn remaining(&self) -> f64 { self.quantity - self.filled }
    pub fn is_full(&self) -> bool { self.filled >= self.quantity }
    pub fn is_active(&self) -> bool {
        matches!(self.status, OrderStatus::New | OrderStatus::PartiallyFilled | OrderStatus::Pending)
    }
}

// Validate order
pub fn validate_order(order: &Order, _user_balances: &HashMap<String, f64>, min_notional: f64) -> ValidationResult {
    let mut res = ValidationResult { valid: true, errors: Vec::new() };

    // Check quantity
    if !order.quantity.is_finite() || order.quantity <= 0.0 {
        res.valid = false;
        res.errors.push("quantity must be positive".to_string());
    }

    // Check price
    if !order.price.is_finite() || (order.price <= 0.0 && order.order_type != OrderType::Market) {
        res.valid = false;
        res.errors.push("price must be positive".to_string());
    }

    // Check notional. A market order carries no price until it executes, so
    // the notional check applies only when a price is present; otherwise the
    // exchange would reject every market order outright.
    if order.order_type != OrderType::Market {
        let notional = order.price * order.quantity;
        if !notional.is_finite() || notional < min_notional {
            res.valid = false;
            res.errors.push(format!("notional {} below minimum {}", notional, min_notional));
        }
    }

    // Check symbol format (e.g., BTCUSDT)
    if !is_valid_symbol(&order.symbol) {
        res.valid = false;
        res.errors.push("invalid symbol format".to_string());
    }

    res
}

pub fn validate_balance(order: &Order, balances: &HashMap<String, f64>) -> ValidationResult {
    let mut res = ValidationResult { valid: true, errors: Vec::new() };

    let asset = extractQuoteAsset(&order.symbol);
    let required = order.price * order.quantity;

    if order.side == Side::Buy {
        let balance = balances.get(&asset).copied().unwrap_or(0.0);
        if balance < required {
            res.valid = false;
            res.errors.push(format!("insufficient {} balance: have {}, need {}", asset, balance, required));
        }
    } else {
        let base = extractBaseAsset(&order.symbol);
        let balance = balances.get(&base).copied().unwrap_or(0.0);
        if balance < order.quantity {
            res.valid = false;
            res.errors.push(format!("insufficient {} balance: have {}, need {}", base, balance, order.quantity));
        }
    }

    res
}

#[derive(Debug)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

// Order Manager
pub struct OrderManager {
    orders: RwLock<HashMap<String, Order>>,
    user_orders: RwLock<HashMap<String, HashSet<String>>>,

    // Limits
    max_orders_per_user: usize,
    rate_limit_per_sec: usize,
}

impl OrderManager {
    pub fn new() -> Self {
        OrderManager {
            orders: RwLock::new(HashMap::new()),
            user_orders: RwLock::new(HashMap::new()),
            max_orders_per_user: 200,
            rate_limit_per_sec: 50,
        }
    }

    /// Create new order with full validation
    pub fn create(&self, order: Order, balances: &HashMap<String, f64>, min_notional: f64) -> Result<Order, Vec<String>> {
        // Validate the order shape and then the balance it requires.
        let validation = validate_order(&order, balances, min_notional);
        if !validation.valid {
            return Err(validation.errors);
        }
        let balance_check = validate_balance(&order, balances);
        if !balance_check.valid {
            return Err(balance_check.errors);
        }

        // Check limits
        let open_count = {
            let user_orders = self.user_orders.read().unwrap();
            user_orders.get(&order.user_id).map(|s| s.len()).unwrap_or(0)
        };

        if open_count >= self.max_orders_per_user {
            return Err(vec!["max orders reached".to_string()]);
        }

        // Store
        let id = order.id.clone();
        let user_id = order.user_id.clone();
        {
            let mut orders = self.orders.write().unwrap();
            orders.insert(id.clone(), order);
        }
        {
            let mut user_orders = self.user_orders.write().unwrap();
            user_orders.entry(user_id)
                .or_insert_with(HashSet::new)
                .insert(id.clone());
        }

        Ok(self.orders.read().unwrap().get(&id).unwrap().clone())
    }

    /// Cancel order
    pub fn cancel(&self, order_id: &str, user_id: &str) -> Result<(), String> {
        let orders = self.orders.write().unwrap();

        let order = orders.get(order_id)
            .ok_or_else(|| "order not found".to_string())?;

        if order.user_id != user_id {
            return Err("unauthorized".to_string());
        }

        if !order.is_active() {
            return Err(format!("cannot cancel order in status {:?}", order.status));
        }

        Ok(())
    }

    /// Fill order (execution engine callback). `price` is the execution price
    /// reported by the matching engine; it must be positive.
    pub fn fill(&self, order_id: &str, fill_qty: f64, price: f64) -> Result<Order, String> {
        if !price.is_finite() || price <= 0.0 {
            return Err("fill price must be positive and finite".to_string());
        }
        let mut orders = self.orders.write().unwrap();

        let order = orders.get_mut(order_id)
            .ok_or_else(|| "order not found".to_string())?;

        if !order.is_active() {
            return Err("order not active".to_string());
        }
        if !fill_qty.is_finite() || fill_qty <= 0.0 {
            return Err("fill quantity must be positive and finite".to_string());
        }
        if fill_qty > order.remaining() {
            return Err("fill exceeds remaining quantity".to_string());
        }

        // Apply fill
        order.filled += fill_qty;
        order.updated_at = timestamp_ms();

        if order.is_full() {
            order.status = OrderStatus::Filled;
        } else {
            order.status = OrderStatus::PartiallyFilled;
        }

        Ok(order.clone())
    }

    /// Get order
    pub fn get(&self, order_id: &str) -> Option<Order> {
        self.orders.read().unwrap().get(order_id).cloned()
    }

    /// Get user orders
    pub fn get_user_orders(&self, user_id: &str) -> Vec<Order> {
        let user_orders = self.user_orders.read().unwrap();

        if let Some(ids) = user_orders.get(user_id) {
            let orders = self.orders.read().unwrap();
            ids.iter()
                .filter_map(|id| orders.get(id).cloned())
                .collect()
        } else {
            Vec::new()
        }
    }
}

// Helpers
fn is_valid_symbol(s: &str) -> bool {
    s.len() >= 6 && s.len() <= 12 && s.is_ascii()
}

/// Known quote assets, longest first, so a symbol like BTCUSDC splits on the
/// real quote rather than a fixed 4-character suffix (which mis-split USDC).
const QUOTE_ASSETS: [&str; 8] = ["USDT", "USDC", "RUSD", "RYUSD", "BUSD", "TUSD", "BTC", "ETH"];

fn split_symbol(symbol: &str) -> Option<(&str, &str)> {
    for quote in QUOTE_ASSETS {
        if let Some(base) = symbol.strip_suffix(quote) {
            if !base.is_empty() {
                return Some((base, quote));
            }
        }
    }
    None
}

fn extractBaseAsset(symbol: &str) -> String {
    split_symbol(symbol).map(|(b, _)| b.to_string()).unwrap_or_default()
}

fn extractQuoteAsset(symbol: &str) -> String {
    split_symbol(symbol).map(|(_, q)| q.to_string()).unwrap_or_default()
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_create() {
        let mgr = OrderManager::new();
        let order = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Limit, 50000.0, 0.1);

        let mut balances = HashMap::new();
        balances.insert("USDT".to_string(), 10000.0);

        let result = mgr.create(order, &balances, 10.0);
        assert!(result.is_ok());
    }

    #[test]
    fn an_order_without_balance_is_refused() {
        let mgr = OrderManager::new();
        let order = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Limit, 50000.0, 0.1);
        let balances = HashMap::new();
        // 50000 * 0.1 = 5000 USDT required, none supplied.
        assert!(mgr.create(order, &balances, 10.0).is_err());
    }

    #[test]
    fn a_market_order_is_not_rejected_for_having_no_price() {
        let mgr = OrderManager::new();
        let order = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Market, 0.0, 0.1);
        let mut balances = HashMap::new();
        balances.insert("USDT".to_string(), 1_000_000.0);
        assert!(mgr.create(order, &balances, 10.0).is_ok());
    }

    #[test]
    fn a_fill_cannot_exceed_the_remaining_quantity() {
        let mgr = OrderManager::new();
        let order = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Limit, 100.0, 1.0);
        let mut balances = HashMap::new();
        balances.insert("USDT".to_string(), 1_000.0);
        let order = mgr.create(order, &balances, 10.0).unwrap();

        assert!(mgr.fill(&order.id, 1.5, 100.0).is_err());
        assert!(mgr.fill(&order.id, 0.0, 100.0).is_err());
        mgr.fill(&order.id, 0.4, 100.0).unwrap();
        mgr.fill(&order.id, 0.6, 100.0).unwrap();
        assert_eq!(mgr.get(&order.id).unwrap().status, OrderStatus::Filled);
    }

    #[test]
    fn order_ids_are_unique() {
        let a = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Limit, 1.0, 1.0);
        let b = Order::new("u1", "BTCUSDT", Side::Buy, OrderType::Limit, 1.0, 1.0);
        assert_ne!(a.id, b.id);
    }
}