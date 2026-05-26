//! TigerEx Trading Engine - Core execution logic
//! Converts from Go internal trading engine

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Order with full details
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub filled: f64,
    pub status: OrderStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

impl Order {
    pub fn new(
        user_id: &str,
        symbol: &str,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: f64,
    ) -> Self {
        Self {
            id: generate_id(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            order_type,
            price,
            quantity,
            filled: 0.0,
            status: OrderStatus::Pending,
            created_at: current_timestamp(),
        }
    }
}

/// Trade execution record
#[derive(Debug, Clone)]
pub struct Execution {
    pub order_id: String,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub timestamp: u64,
}

/// Trading engine
pub struct TradingEngine {
    orders: RwLock<HashMap<String, Order>>,
    executions: RwLock<Vec<Execution>>,
    order_books: RwLock<HashMap<String, OrderBook>>,
    max_slippage: f64,
}

#[derive(Debug, Clone, Default)]
pub struct OrderBook {
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
}

#[derive(Debug, Clone)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
}

impl TradingEngine {
    pub fn new() -> Self {
        Self {
            orders: RwLock::new(HashMap::new()),
            executions: RwLock::new(Vec::new()),
            order_books: RwLock::new(HashMap::new()),
            max_slippage: 0.001, // 0.1%
        }
    }

    /// Submit order
    pub fn submit_order(&self, order: Order) -> Result<String, String> {
        let order_id = order.id.clone();
        
        // Validate
        if order.quantity <= 0.0 {
            return Err("Invalid quantity".to_string());
        }
        
        if order.order_type == OrderType::Limit && order.price <= 0.0 {
            return Err("Invalid price".to_string());
        }

        // Store
        let mut orders = self.orders.write().unwrap();
        orders.insert(order_id.clone(), order);

        Ok(order_id)
    }

    /// Execute order against current price
    pub fn execute(&self, order_id: &str, current_price: f64) -> Result<Execution, String> {
        let mut orders = self.orders.write().unwrap();
        
        let order = orders
            .get_mut(order_id)
            .ok_or("Order not found")?;

        if order.status == OrderStatus::Filled {
            return Err("Order already filled".to_string());
        }

        // Calculate execution price
        let exec_price = match order.order_type {
            OrderType::Market => current_price,
            OrderType::Limit => order.price,
            _ => current_price,
        };

        // Check slippage for market orders
        if order.order_type == OrderType::Market {
            let slippage = (exec_price - current_price).abs() / current_price;
            if slippage > self.max_slippage {
                return Err("Slippage too high".to_string());
            }
        }

        // Execute
        let fill_qty = order.quantity;
        order.filled = fill_qty;
        order.status = OrderStatus::Filled;

        // Calculate fee
        let fee = exec_price * fill_qty * 0.001;

        let execution = Execution {
            order_id: order_id.to_string(),
            price: exec_price,
            quantity: fill_qty,
            fee,
            timestamp: current_timestamp(),
        };

        // Store execution
        let mut executions = self.executions.write().unwrap();
        executions.push(execution.clone());

        Ok(execution)
    }

    /// Cancel order
    pub fn cancel(&self, order_id: &str) -> Result<(), String> {
        let mut orders = self.orders.write().unwrap();
        
        if let Some(order) = orders.get_mut(order_id) {
            if order.status == OrderStatus::Filled {
                return Err("Cannot cancel filled order".to_string());
            }
            order.status = OrderStatus::Cancelled;
            Ok(())
        } else {
            Err("Order not found".to_string())
        }
    }

    /// Get open orders
    pub fn get_open_orders(&self, user_id: &str) -> Vec<Order> {
        let orders = self.orders.read().unwrap();
        orders
            .values()
            .filter(|o| o.user_id == user_id && (o.status == OrderStatus::Open || o.status == OrderStatus::Pending))
            .cloned()
            .collect()
    }

    /// Get execution history
    pub fn get_executions(&self, limit: usize) -> Vec<Execution> {
        let executions = self.executions.read().unwrap();
        executions.iter().rev().take(limit).cloned().collect()
    }
}

impl Default for TradingEngine {
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

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("eng_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_execute() {
        let engine = TradingEngine::new();
        
        let order = Order::new(
            "user1",
            "BTC/USDT",
            OrderSide::Buy,
            OrderType::Limit,
            50000.0,
            1.0,
        );
        
        let order_id = engine.submit_order(order).unwrap();
        let result = engine.execute(&order_id, 50000.0).unwrap();
        
        assert_eq!(result.quantity, 1.0);
    }
}