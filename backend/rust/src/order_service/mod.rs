//! Order Service - Rust Implementation
//! 
//! Order management - CRUD operations

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: Option<f64>,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub avg_fill_price: Option<f64>,
    pub status: OrderStatus,
    pub time_in_force: TimeInForce,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide { Buy, Sell }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType { Market, Limit, StopMarket, StopLimit }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus { Pending, Open, PartiallyFilled, Filled, Cancelled, Rejected }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce { GTC, IOC, FOK }

pub struct OrderService {
    orders: HashMap<String, Order>,
    user_orders: HashMap<String, Vec<String>>,
    order_id_counter: u64,
}

impl OrderService {
    pub fn new() -> Self {
        Self {
            orders: HashMap::new(),
            user_orders: HashMap::new(),
            order_id_counter: 0,
        }
    }

    /// Create order
    pub fn create_order(&mut self, user_id: &str, symbol: &str, side: OrderSide,
                     order_type: OrderType, quantity: f64, price: Option<f64>) -> Order {
        self.order_id_counter += 1;
        
        let order = Order {
            id: format!("ORD-{}", self.order_id_counter),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            order_type,
            price,
            quantity,
            filled_quantity: 0.0,
            avg_fill_price: None,
            status: OrderStatus::Pending,
            time_in_force: TimeInForce::GTC,
            created_at: current_timestamp_ms(),
            updated_at: current_timestamp_ms(),
        };

        let order_id = order.id.clone();
        self.orders.insert(order_id.clone(), order.clone());
        
        self.user_orders.entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(order_id);

        order
    }

    /// Get order
    pub fn get_order(&self, order_id: &str) -> Option<&Order> {
        self.orders.get(order_id)
    }

    /// Get user orders
    pub fn get_user_orders(&self, user_id: &str) -> Vec<&Order> {
        let order_ids = self.user_orders.get(user_id);
        match order_ids {
            Some(ids) => ids.iter()
                .filter_map(|id| self.orders.get(id))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Cancel order
    pub fn cancel_order(&mut self, order_id: &str, user_id: &str) -> Result<Order, String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("Order not found")?;

        if order.user_id != user_id {
            return Err("Unauthorized".to_string());
        }

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Open {
            return Err("Order cannot be cancelled".to_string());
        }

        order.status = OrderStatus::Cancelled;
        order.updated_at = current_timestamp_ms();

        Ok(order.clone())
    }

    /// Fill order (for market orders)
    pub fn fill_order(&mut self, order_id: &str, fill_price: f64, fill_qty: f64) 
                     -> Result<Order, String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("Order not found")?;

        if order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled {
            return Err("Order not fillable".to_string());
        }

        let total_cost = (order.avg_fill_price.unwrap_or(fill_price) * order.filled_quantity) 
                        + (fill_price * fill_qty);
        order.filled_quantity += fill_qty;
        order.avg_fill_price = Some(total_cost / order.filled_quantity);

        if order.filled_quantity >= order.quantity {
            order.status = OrderStatus::Filled;
        } else {
            order.status = OrderStatus::PartiallyFilled;
        }

        order.updated_at = current_timestamp_ms();
        Ok(order.clone())
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_order() {
        let mut service = OrderService::new();
        let order = service.create_order(
            "user1", "BTC/USDT", OrderSide::Buy, OrderType::Market, 1.0, None
        );
        assert_eq!(order.status, OrderStatus::Pending);
    }

    #[test]
    fn test_cancel_order() {
        let mut service = OrderService::new();
        let order = service.create_order(
            "user1", "BTC/USDT", OrderSide::Buy, OrderType::Market, 1.0, None
        );
        let result = service.cancel_order(&order.id, "user1");
        assert!(result.is_ok());
    }
}