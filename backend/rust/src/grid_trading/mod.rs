//! Grid Trading - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridOrder {
    pub id: String,
    pub price_grid: Vec<f64>,
    pub quantity: f64,
    pub profits: f64,
}

pub struct GridTradingBot {
    grids: Vec<GridOrder>,
}

impl GridTradingBot {
    pub fn new() -> Self { Self { grids: vec![] } }
    pub fn create(&mut self, symbol: &str, grid_size: usize, min_price: f64, max_price: f64) -> String {
        let id = format!("GRID_{}", self.grids.len());
        let step = (max_price - min_price) / grid_size as f64;
        let prices: Vec<f64> = (0..grid_size).map(|i| min_price + step * i as f64).collect();
        self.grids.push(GridOrder { id: id.clone(), price_grid: prices, quantity: 0.01, profits: 0.0 });
        id
    }
    pub fn execute(&mut self, id: &str, price: f64) -> f64 {
        if let Some(g) = self.grids.iter_mut().find(|x| x.id == id) {
            if g.price_grid.contains(&price) { g.profits += 0.001; }
        }
        0.001
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut b = GridTradingBot::new(); let id = b.create("BTC", 10, 40000.0, 50000.0); assert!(!id.is_empty()); } }
