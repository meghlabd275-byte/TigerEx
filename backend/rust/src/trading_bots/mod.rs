//! Trading Bots - Rust Implementation
//! 
//! Grid, DCA, Martingale, Signal bots

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Bot config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub bot_type: BotType,
    pub symbol: String,
    pub amount: f64,
    pub grid_count: Option<u32>,
    pub grid_range: Option<(f64, f64)>,
    pub status: BotStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BotType { Grid, DCA, Martingale, Signal, Arbitrage }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BotStatus { Created, Running, Stopped, Completed }

/// Grid bot
pub struct GridBot {
    pub id: String,
    pub symbol: String,
    pub lower: f64,
    pub upper: f64,
    pub grids: u32,
    pub total_invested: f64,
    pub grid_profit: f64,
}

impl GridBot {
    pub fn new(id: &str, symbol: &str, lower: f64, upper: f64, grids: u32) -> Self {
        Self {
            id: id.to_string(),
            symbol: symbol.to_string(),
            lower,
            upper,
            grids,
            total_invested: 0.0,
            grid_profit: 0.0,
        }
    }
    
    pub fn get_grid_levels(&self) -> Vec<f64> {
        let step = (self.upper - self.lower) / (self.grids as f64);
        (0..=self.grids).map(|i| self.lower + (step * i as f64)).collect()
    }
    
    pub fn calculate_profit(&self, buy_price: f64, sell_price: f64) -> f64 {
        (sell_price - buy_price) * (self.total_invested / buy_price)
    }
}

/// DCA bot
pub struct DCABot {
    pub id: String,
    pub symbol: String,
    pub invest_per_interval: f64,
    pub interval_seconds: u64,
    pub total_invested: f64,
    pub avg_price: f64,
}

impl DCABot {
    pub fn new(id: &str, symbol: &str, invest: f64, interval: u64) -> Self {
        Self {
            id: id.to_string(),
            symbol: symbol.to_string(),
            invest_per_interval: invest,
            interval_seconds: interval,
            total_invested: 0.0,
            avg_price: 0.0,
        }
    }
    
    pub fn execute_buy(&mut self, price: f64) {
        self.total_invested += self.invest_per_interval;
        self.avg_price = ((self.avg_price * (self.total_invested - self.invest_per_interval)) 
                       + (price * self.invest_per_interval)) / self.total_invested;
    }
}

/// Martingale bot
pub struct MartingaleBot {
    pub id: String,
    pub symbol: String,
    pub base_amount: f64,
    pub multiplier: f64,
    pub current_lot: u32,
    pub total_loss: f64,
}

impl MartingaleBot {
    pub fn new(id: &str, symbol: &str, amount: f64, mult: f64) -> Self {
        Self {
            id: id.to_string(),
            symbol: symbol.to_string(),
            base_amount: amount,
            multiplier: mult,
            current_lot: 1,
            total_loss: 0.0,
        }
    }
    
    pub fn next_amount(&self) -> f64 {
        self.base_amount * self.multiplier.powi(self.current_lot as i32)
    }
    
    pub fn on_win(&mut self) { self.current_lot = 1; }
    pub fn on_loss(&mut self) { self.current_lot += 1; self.total_loss += self.next_amount(); }
}

/// Bot factory
pub struct BotFactory {
    bots: HashMap<String, serde_json::Value>,
}

impl BotFactory {
    pub fn new() -> Self { Self { bots: HashMap::new() } }
    
    pub fn create(&mut self, config: BotConfig) -> String {
        let id = format!("bot_{}", self.bots.len() + 1);
        // Store bot based on type
        self.bots.insert(id.clone(), serde_json::json!({"type": config.bot_type}));
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_grid() {
        let bot = GridBot::new("1", "BTC/USDT", 45000.0, 55000.0, 10);
        assert!(bot.get_grid_levels().len() == 11);
    }
}