//! Matching Engine - Rust Implementation
//! 
//! High-performance order matching

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side { Bid, Ask }

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { New, PartiallyFilled, Filled, Cancelled }

/// Book order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub side: Side,
    pub price: f64,
    pub quantity: f64,
    pub filled: f64,
    pub status: Status,
}

/// Order book
pub struct Book {
    symbol: String,
    bids: Vec<Order>,
    asks: Vec<Order>,
}

impl Book {
    pub fn new(s: &str) -> Self {
        Self { symbol: s.to_string(), bids: vec![], asks: vec![] }
    }
    
    pub fn add(&mut self, o: Order) {
        match o.side {
            Side::Bid => self.bids.push(o),
            Side::Ask => self.asks.push(o),
        }
    }
    
    pub fn match_orders(&mut self) -> Vec<Fill> {
        let mut fills = vec![];
        while let (Some(bid), Some(ask)) = (self.bids.first_mut(), self.asks.first_mut()) {
            if bid.price >= ask.price && bid.filled < bid.quantity && ask.filled < ask.quantity {
                let qty = bid.quantity - bid.filled;
                fills.push(Fill { bid: bid.id.clone(), ask: ask.id.clone(), price: ask.price, qty });
                bid.filled += qty;
                ask.filled += qty;
            } else { break; }
        }
        fills
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fill { pub bid: String, pub ask: String, pub price: f64, pub qty: f64 }

pub struct Engine { books: HashMap<String, Book> }

impl Engine {
    pub fn new() -> Self { Self { books: HashMap::new() } }
    
    pub fn book(&mut self, s: &str) -> &mut Book {
        self.books.entry(s.to_string()).or_insert_with(|| Book::new(s))
    }
    
    pub fn process(&mut self, symbol: &str, order: Order) -> Vec<Fill> {
        let b = self.book(symbol);
        b.add(order);
        b.match_orders()
    }
    
    pub fn depth(&self, symbol: &str, n: usize) -> (Vec<(f64,f64)>, Vec<(f64,f64)>) {
        let b = match self.books.get(symbol) {
            Some(x) => x,
            _ => return (vec![], vec![]),
        };
        (b.bids.iter().take(n).map(|o| (o.price, o.quantity-o.filled)).collect(),
         b.asks.iter().take(n).map(|o| (o.price, o.quantity-o.filled)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn test_add() {
        let mut e = Engine::new();
        e.book("BTC/USDT").add(Order { id: "1".into(), user_id: "u1".into(), side: Side::Bid, price: 50000.0, qty: 1.0, ..Default::default() });
        assert!(e.depth("BTC/USDT", 1).0.len() == 1);
    }
}