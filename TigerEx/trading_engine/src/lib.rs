// TigerEx Trading Engine
// Built with Rust for high speed with ultra-low latency

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct Order {
    pub id: u64,
    pub user_id: u64,
    pub market: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: u64,
    pub price: Option<u64>,
    pub filled: u64,
    pub status: OrderStatus,
}

#[derive(Debug, Clone, Copy)]
pub enum OrderSide { Buy, Sell }
#[derive(Debug, Clone, Copy)]
pub enum OrderType { Market, Limit, Stop }
#[derive(Debug, Clone, Copy)]
pub enum OrderStatus { Pending, Filled, Cancelled }

pub struct TradingEngine {
    orders: Arc<RwLock<HashMap<u64, Order>>>,
    counter: Arc<RwLock<u64>>,
}

impl TradingEngine {
    pub fn new() -> Self {
        Self {
            orders: Arc::new(RwLock::new(HashMap::new())),
            counter: Arc::new(RwLock::new(1000)),
        }
    }
    
    pub fn submit_order(&self, user_id: u64, market: String, side: OrderSide, 
                       order_type: OrderType, quantity: u64, price: Option<u64>) -> u64 {
        let id = {
            let mut c = self.counter.write().unwrap();
            *c += 1;
            *c
        };
        
        let order = Order {
            id, user_id, market, side, order_type, quantity, price, filled: 0, status: OrderStatus::Pending,
        };
        
        self.orders.write().unwrap().insert(id, order);
        id
    }
    
    pub fn get_order(&self, id: u64) -> Option<Order> {
        self.orders.read().unwrap().get(&id).cloned()
    }
}

fn main() {
    println!("TigerEx Trading Engine (Rust)");
    
    let engine = TradingEngine::new();
    
    let id = engine.submit_order(1, "BTC/USDT".to_string(), OrderSide::Buy, OrderType::Limit, 1000000, Some(50000000000));
    println!("Order: {}", id);
    
    if let Some(order) = engine.get_order(id) {
        println!("Order: {} - {} - {}", order.id, order.market, order.quantity);
    }
}
