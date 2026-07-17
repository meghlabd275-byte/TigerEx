//! TigerEx Order Service - Rust Implementation
//! Converted from Go for order processing performance

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    Buy,
    Sell,
}

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
    TakeProfit,
    TrailingStop,
}

/// Time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TimeInForce {
    GoodTillCancel,
    ImmediateOrCancel,
    FillOrKill,
    GoodTillTime,
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderStatus {
    Pending,
    Accepted,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
    Rejected,
}

/// Order representation
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    pub price: f64,
    pub stop_price: Option<f64>,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub status: OrderStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub expires_at: Option<u64>,
    pub client_order_id: Option<String>,
}

impl Order {
    pub fn new(
        id: String,
        user_id: String,
        symbol: String,
        side: Side,
        order_type: OrderType,
        price: f64,
        quantity: f64,
    ) -> Self {
        let now = current_timestamp();
        Self {
            id,
            user_id,
            symbol,
            side,
            order_type,
            time_in_force: TimeInForce::GoodTillCancel,
            price,
            stop_price: None,
            quantity,
            filled_quantity: 0.0,
            status: OrderStatus::Pending,
            created_at: now,
            updated_at: now,
            expires_at: None,
            client_order_id: None,
        }
    }

    pub fn remaining(&self) -> f64 {
        self.quantity - self.filled_quantity
    }

    pub fn is_filled(&self) -> bool {
        self.filled_quantity >= self.quantity
    }

    pub fn can_fill(&self) -> bool {
        matches!(self.status, OrderStatus::Open | OrderStatus::PartiallyFilled)
    }

    pub fn fill(&mut self, quantity: f64) {
        self.filled_quantity += quantity;
        self.updated_at = current_timestamp();
        
        if self.filled_quantity >= self.quantity {
            self.status = OrderStatus::Filled;
        } else {
            self.status = OrderStatus::PartiallyFilled;
        }
    }

    pub fn cancel(&mut self) {
        if self.can_fill() {
            self.status = OrderStatus::Cancelled;
            self.updated_at = current_timestamp();
        }
    }
    
    pub fn to_response(&self) -> OrderResponse {
        OrderResponse {
            order_id: self.id.clone(),
            symbol: self.symbol.clone(),
            side: format!("{:?}", self.side).to_lowercase(),
            order_type: format!("{:?}", self.order_type).to_lowercase(),
            price: self.price,
            quantity: self.quantity,
            filled_quantity: self.filled_quantity,
            status: format!("{:?}", self.status).to_lowercase(),
            created_at: self.created_at,
        }
    }
}

/// Create order request
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CreateOrderRequest {
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub quantity: f64,
    pub stop_price: Option<f64>,
    pub time_in_force: Option<String>,
    pub client_order_id: Option<String>,
}

/// Order response
#[derive(Debug, Clone, serde::Serialize)]
pub struct OrderResponse {
    pub order_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub status: String,
    pub created_at: u64,
}

/// Order service - manages orders
pub struct OrderService {
    orders: RwLock<HashMap<String, Order>>,
    user_orders: RwLock<HashMap<String, Vec<String>>>,
}

impl OrderService {
    pub fn new() -> Self {
        Self {
            orders: RwLock::new(HashMap::new()),
            user_orders: RwLock::new(HashMap::new()),
        }
    }

    /// Create order
    pub fn create_order(&self, request: CreateOrderRequest) -> Result<Order, String> {
        let side = match request.side.to_lowercase().as_str() {
            "buy" => Side::Buy,
            "sell" => Side::Sell,
            _ => return Err("Invalid side: must be buy or sell".to_string()),
        };

        let order_type = match request.order_type.to_lowercase().as_str() {
            "market" => OrderType::Market,
            "limit" => OrderType::Limit,
            "stop_loss" => OrderType::StopLoss,
            "stop_limit" => OrderType::StopLimit,
            "take_profit" => OrderType::TakeProfit,
            _ => return Err("Invalid order type".to_string()),
        };

        if request.price <= 0.0 && order_type != OrderType::Market {
            return Err("Price must be positive for non-market orders".to_string());
        }

        if request.quantity <= 0.0 {
            return Err("Quantity must be positive".to_string());
        }

        let order_id = generate_order_id();

        let mut order = Order::new(
            order_id.clone(),
            request.user_id.clone(),
            request.symbol.clone(),
            side,
            order_type,
            request.price,
            request.quantity,
        );
        order.client_order_id = request.client_order_id;

        let mut orders = self.orders.write().unwrap();
        orders.insert(order_id.clone(), order.clone());

        let mut user_orders = self.user_orders.write().unwrap();
        user_orders
            .entry(request.user_id.clone())
            .or_insert_with(Vec::new)
            .push(order_id.clone());

        Ok(order)
    }

    pub fn get_order(&self, order_id: &str) -> Option<Order> {
        let orders = self.orders.read().unwrap();
        orders.get(order_id).cloned()
    }

    pub fn get_user_orders(&self, user_id: &str) -> Vec<Order> {
        let user_orders = self.user_orders.read().unwrap();
        let orders = self.orders.read().unwrap();
        
        user_orders
            .get(user_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| orders.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_open_orders(&self, user_id: &str) -> Vec<Order> {
        self.get_user_orders(user_id)
            .into_iter()
            .filter(|o| o.can_fill())
            .collect()
    }

    pub fn cancel_order(&self, order_id: &str, user_id: &str) -> Result<Order, String> {
        let mut orders = self.orders.write().unwrap();
        
        if let Some(order) = orders.get_mut(order_id) {
            if order.user_id != user_id {
                return Err("Order not found".to_string());
            }
            
            if !order.can_fill() {
                return Err("Order cannot be cancelled".to_string());
            }
            
            order.cancel();
            Ok(order.clone())
        } else {
            Err("Order not found".to_string())
        }
    }

    pub fn fill_order(&self, order_id: &str, quantity: f64) -> Result<Order, String> {
        let mut orders = self.orders.write().unwrap();
        
        if let Some(order) = orders.get_mut(order_id) {
            if !order.can_fill() {
                return Err("Order cannot be filled".to_string());
            }
            
            if quantity > order.remaining() {
                return Err("Quantity exceeds remaining".to_string());
            }
            
            order.fill(quantity);
            Ok(order.clone())
        } else {
            Err("Order not found".to_string())
        }
    }
}

impl Default for OrderService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_order_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("ord_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_order() {
        let service = OrderService::new();
        
        let request = CreateOrderRequest {
            user_id: "user1".to_string(),
            symbol: "BTC/USDT".to_string(),
            side: "buy".to_string(),
            order_type: "limit".to_string(),
            price: 50000.0,
            quantity: 1.0,
            stop_price: None,
            time_in_force: None,
            client_order_id: None,
        };
        
        let order = service.create_order(request).unwrap();
        assert_eq!(order.side, Side::Buy);
    }
}