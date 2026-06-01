// Order Manager - Full order lifecycle in Rust
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

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
        Order {
            id: format!("order_{}_{}", symbol, now),
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
pub fn validate_order(order: &Order, user_balances: &HashMap<String, f64>, min_notional: f64) -> ValidationResult {
    let mut res = ValidationResult { valid: true, errors: Vec::new() };
    
    // Check quantity
    if order.quantity <= 0.0 {
        res.valid = false;
        res.errors.push("quantity must be positive".to_string());
    }
    
    // Check price
    if order.price <= 0.0 && order.order_type != OrderType::Market {
        res.valid = false;
        res.errors.push("price must be positive".to_string());
    }
    
    // Check notional
    let notional = order.price * order.quantity;
    if notional < min_notional {
        res.valid = false;
        res.errors.push(format!("notional {} below minimum {}", notional, min_notional));
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
    pending: RwLock<Vec<String>>,
    
    // Limits
    max_orders_per_user: usize,
    rate_limit_per_sec: usize,
}

impl OrderManager {
    pub fn new() -> Self {
        OrderManager {
            orders: RwLock::new(HashMap::new()),
            user_orders: RwLock::new(HashMap::new()),
            pending: RwLock::new(Vec::new()),
            max_orders_per_user: 200,
            rate_limit_per_sec: 50,
        }
    }
    
    /// Create new order with full validation
    pub fn create(&self, order: Order, balances: &HashMap<String, f64>, min_notional: f64) -> Result<Order, Vec<String>> {
        // Validate
        let validation = validate_order(&order, balances, min_notional);
        if !validation.valid {
            return Err(validation.errors);
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
        {
            let mut orders = self.orders.write().unwrap();
            orders.insert(id.clone(), order);
        }
        {
            let mut user_orders = self.user_orders.write().unwrap();
            user_orders.entry(order.user_id.clone())
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
    
    /// Fill order (execution engine callback)
    pub fn fill(&self, order_id: &str, fill_qty: f64, price: f64) -> Result<Order, String> {
        let mut orders = self.orders.write().unwrap();
        
        let order = orders.get_mut(order_id)
            .ok_or_else(|| "order not found".to_string())?;
        
        if !order.is_active() {
            return Err("order not active".to_string());
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

fn extractBaseAsset(symbol: &str) -> String {
    // BTCUSDT -> BTC
    symbol.strip_suffix(&symbol[symbol.len()-4..]).unwrap_or(symbol).to_string()
}

fn extractQuoteAsset(symbol: &str) -> String {
    // BTCUSDT -> USDT
    symbol[&symbol.len()-4..].to_string()
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
}