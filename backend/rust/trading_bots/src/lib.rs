//! TigerEx Trading Bots Library
//! Grid, DCA, TWAP, and Arbitrage trading bots

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum BotError {
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),
    #[error("Order failed: {0}")]
    OrderFailed(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Trading disabled: {0}")]
    TradingDisabled(String),
}

impl Serialize for BotError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    Limit,
    Market,
}

/// Time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC, // Immediate or Cancel
    FOK, // Fill or Kill
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Pending,
}

/// Bot status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotStatus {
    Running,
    Stopped,
    Paused,
    Error,
}

/// Bot type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotType {
    Grid,
    Dca,
    Twap,
    Arbitrage,
}

/// Order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: String,
    pub price: String,
    pub status: OrderStatus,
    pub filled_quantity: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Grid bot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridConfig {
    pub symbol: String,
    pub upper_price: f64,
    pub lower_price: f64,
    pub grid_count: usize,
    pub quantity_per_grid: f64,
    pub max_position: f64,
    pub price_precision: usize,
    pub quantity_precision: usize,
}

/// DCA bot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DCAConfig {
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: f64,
    pub frequency_seconds: u64,
    pub price_deviation_percent: f64,
    pub max_orders: usize,
    pub take_profit_percent: f64,
    pub stop_loss_percent: f64,
    pub price_precision: usize,
    pub quantity_precision: usize,
}

/// TWAP bot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TWAPConfig {
    pub symbol: String,
    pub side: OrderSide,
    pub total_quantity: f64,
    pub order_count: usize,
    pub duration_seconds: u64,
    pub order_type: OrderType,
    pub price_limit: Option<f64>,
    pub price_precision: usize,
    pub quantity_precision: usize,
}

/// Arbitrage bot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageConfig {
    pub symbol_a: String,
    pub symbol_b: String,
    pub exchange_a: String,
    pub exchange_b: String,
    pub min_profit_percent: f64,
    pub order_size: f64,
    pub max_position: f64,
    pub price_precision: usize,
    pub quantity_precision: usize,
}

/// Bot state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotState {
    pub bot_id: String,
    pub bot_type: BotType,
    pub status: BotStatus,
    pub config: BotConfig,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub total_pnl: String,
    pub total_trades: u64,
    pub running_orders: Vec<Order>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BotConfig {
    Grid(GridConfig),
    Dca(DCAConfig),
    Twap(TWAPConfig),
    Arbitrage(ArbitrageConfig),
}

/// Bot statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotStats {
    pub bot_id: String,
    pub total_pnl: f64,
    pub total_trades: u64,
    pub winning_trades: u64,
    pub losing_trades: u64,
    pub avg_profit: f64,
    pub avg_loss: f64,
    pub max_drawdown: f64,
    pub sharpe_ratio: f64,
}

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

/// Create a new order
pub fn create_order(
    symbol: &str,
    side: OrderSide,
    order_type: OrderType,
    quantity: &str,
    price: &str,
) -> Order {
    let now = Utc::now().timestamp_millis();
    let order_id = format!("ord_{}_{}", symbol, now);

    Order {
        order_id,
        symbol: symbol.to_string(),
        side,
        order_type,
        quantity: quantity.to_string(),
        price: price.to_string(),
        status: OrderStatus::New,
        filled_quantity: "0".to_string(),
        created_at: now,
        updated_at: now,
    }
}

// ============================================================================
// GRID BOT
// ============================================================================

/// Grid trading bot
pub struct GridBot {
    config: GridConfig,
    orders: Vec<Order>,
    current_position: f64,
    grid_levels: Vec<f64>,
}

impl GridBot {
    /// Create new grid bot
    pub fn new(config: GridConfig) -> Result<Self, BotError> {
        // Validate configuration
        if config.upper_price <= config.lower_price {
            return Err(BotError::InvalidConfig(
                "Upper price must be greater than lower price".to_string(),
            ));
        }

        if config.grid_count == 0 || config.grid_count > 100 {
            return Err(BotError::InvalidConfig(
                "Grid count must be between 1 and 100".to_string(),
            ));
        }

        // Calculate grid levels
        let price_range = config.upper_price - config.lower_price;
        let grid_size = price_range / config.grid_count as f64;

        let mut grid_levels = Vec::with_capacity(config.grid_count);
        for i in 0..config.grid_count {
            let price = config.lower_price + (grid_size * (i + 1) as f64);
            grid_levels.push(price);
        }

        Ok(GridBot {
            config,
            orders: Vec::new(),
            current_position: 0.0,
            grid_levels,
        })
    }

    /// Calculate grid prices
    pub fn get_grid_prices(&self) -> Vec<f64> {
        self.grid_levels.clone()
    }

    /// Check if we should place a buy order
    pub fn should_place_buy(&self, current_price: f64) -> bool {
        // Check if we haven't reached max position
        if self.current_position >= self.config.max_position {
            return false;
        }

        // Check if price is at or below a grid level
        for (i, &level) in self.grid_levels.iter().enumerate() {
            if current_price <= level && i % 2 == 0 {
                // Check if we don't already have an order at this level
                return !self.orders.iter().any(|o| {
                    o.side == OrderSide::Buy && 
                    self.compare_prices(&o.price, level)
                });
            }
        }

        false
    }

    /// Check if we should place a sell order
    pub fn should_place_sell(&self, current_price: f64) -> bool {
        // Check if we have position to sell
        if self.current_position <= 0.0 {
            return false;
        }

        // Check if price is at or above a grid level
        for (i, &level) in self.grid_levels.iter().enumerate() {
            if current_price >= level && i % 2 == 1 {
                return !self.orders.iter().any(|o| {
                    o.side == OrderSide::Sell && 
                    self.compare_prices(&o.price, level)
                });
            }
        }

        false
    }

    /// Place buy order
    pub fn place_buy(&mut self, current_price: f64) -> Option<Order> {
        if !self.should_place_buy(current_price) {
            return None;
        }

        // Find the lowest grid level below current price
        for &level in &self.grid_levels {
            if level < current_price {
                // Check if no order exists at this level
                if !self.orders.iter().any(|o| {
                    o.side == OrderSide::Buy && self.compare_prices(&o.price, level)
                }) {
                    let qty = self.config.quantity_per_grid;
                    let order = create_order(
                        &self.config.symbol,
                        OrderSide::Buy,
                        OrderType::Limit,
                        &format!("{:.prec$}", qty, prec = self.config.quantity_precision),
                        &format!("{:.prec$}", level, prec = self.config.price_precision),
                    );

                    self.current_position += qty;
                    self.orders.push(order.clone());

                    return Some(order);
                }
            }
        }

        None
    }

    /// Place sell order
    pub fn place_sell(&mut self, current_price: f64) -> Option<Order> {
        if !self.should_place_sell(current_price) {
            return None;
        }

        // Find the highest grid level above current price
        for &level in self.grid_levels.iter().rev() {
            if level > current_price {
                if !self.orders.iter().any(|o| {
                    o.side == OrderSide::Sell && self.compare_prices(&o.price, level)
                }) {
                    let qty = self.config.quantity_per_grid;
                    let order = create_order(
                        &self.config.symbol,
                        OrderSide::Sell,
                        OrderType::Limit,
                        &format!("{:.prec$}", qty, prec = self.config.quantity_precision),
                        &format!("{:.prec$}", level, prec = self.config.price_precision),
                    );

                    self.current_position -= qty;
                    self.orders.push(order.clone());

                    return Some(order);
                }
            }
        }

        None
    }

    /// Handle order filled
    pub fn on_order_filled(&mut self, order: &Order) {
        match order.side {
            OrderSide::Buy => {
                self.current_position += order.filled_quantity.parse().unwrap_or(0.0);
            }
            OrderSide::Sell => {
                self.current_position -= order.filled_quantity.parse().unwrap_or(0.0);
            }
        }

        // Remove filled order
        self.orders.retain(|o| o.order_id != order.order_id);
    }

    /// Cancel order
    pub fn cancel_order(&mut self, order_id: &str) -> bool {
        if let Some(pos) = self.orders.iter().position(|o| o.order_id == order_id) {
            let order = &self.orders[pos];
            
            // Reverse position
            match order.side {
                OrderSide::Buy => {
                    self.current_position -= order.quantity.parse().unwrap_or(0.0);
                }
                OrderSide::Sell => {
                    self.current_position += order.quantity.parse().unwrap_or(0.0);
                }
            }

            self.orders.remove(pos);
            return true;
        }
        
        false
    }

    /// Get current position
    pub fn get_position(&self) -> f64 {
        self.current_position
    }

    /// Get grid profit estimate
    pub fn estimate_profit(&self) -> f64 {
        let grid_size = (self.config.upper_price - self.config.lower_price) 
            / self.config.grid_count as f64;
        let profit_per_grid = self.config.quantity_per_grid * grid_size;
        profit_per_grid * self.config.grid_count as f64
    }

    fn compare_prices(&self, price: &str, target: f64) -> bool {
        if let Ok(p) = price.parse::<f64>() {
            (p - target).abs() < 0.0001
        } else {
            false
        }
    }
}

// ============================================================================
// DCA BOT (Dollar Cost Average)
// ============================================================================

/// DCA trading bot
pub struct DCABot {
    config: DCAConfig,
    orders: Vec<Order>,
    total_bought: f64,
    avg_price: f64,
    started_at: i64,
}

impl DCABot {
    /// Create new DCA bot
    pub fn new(config: DCAConfig) -> Result<Self, BotError> {
        if config.frequency_seconds < 60 {
            return Err(BotError::InvalidConfig(
                "Frequency must be at least 60 seconds".to_string(),
            ));
        }

        if config.quantity <= 0.0 {
            return Err(BotError::InvalidConfig(
                "Quantity must be positive".to_string(),
            ));
        }

        Ok(DCABot {
            config,
            orders: Vec::new(),
            total_bought: 0.0,
            avg_price: 0.0,
            started_at: Utc::now().timestamp_millis(),
        })
    }

    /// Check if should place order based on price deviation
    pub fn should_place_order(&self, current_price: f64, base_price: f64) -> bool {
        if self.orders.len() >= self.config.max_orders {
            return false;
        }

        let deviation = ((current_price - base_price) / base_price * 100.0).abs();

        deviation >= self.config.price_deviation_percent
    }

    /// Place DCA order
    pub fn place_order(&mut self, current_price: f64) -> Option<Order> {
        let order = create_order(
            &self.config.symbol,
            self.config.side,
            self.config.order_type,
            &format!("{:.prec$}", self.config.quantity, prec = self.config.quantity_precision),
            &format!("{:.prec$}", current_price, prec = self.config.price_precision),
        );

        self.total_bought += self.config.quantity;
        
        // Update average price
        if self.avg_price == 0.0 {
            self.avg_price = current_price;
        } else {
            self.avg_price = (self.avg_price + current_price) / 2.0;
        }

        self.orders.push(order.clone());

        Some(order)
    }

    /// Check take profit
    pub fn check_take_profit(&self, current_price: f64) -> bool {
        if self.config.side != OrderSide::Buy || self.total_bought == 0.0 {
            return false;
        }

        let profit_percent = (current_price - self.avg_price) / self.avg_price * 100.0;
        profit_percent >= self.config.take_profit_percent
    }

    /// Check stop loss
    pub fn check_stop_loss(&self, current_price: f64) -> bool {
        if self.config.side != OrderSide::Buy || self.total_bought == 0.0 {
            return false;
        }

        let loss_percent = (self.avg_price - current_price) / self.avg_price * 100.0;
        loss_percent >= self.config.stop_loss_percent
    }

    /// Get statistics
    pub fn get_stats(&self) -> BotStats {
        BotStats {
            bot_id: "dca".to_string(),
            total_pnl: 0.0,
            total_trades: self.orders.len() as u64,
            winning_trades: 0,
            losing_trades: 0,
            avg_profit: 0.0,
            avg_loss: 0.0,
            max_drawdown: 0.0,
            sharpe_ratio: 0.0,
        }
    }
}

// ============================================================================
// TWAP BOT (Time Weighted Average Price)
// ============================================================================

/// TWAP trading bot
pub struct TWAPBot {
    config: TWAPConfig,
    orders: Vec<Order>,
    executed_quantity: f64,
    order_interval_ms: u64,
    last_order_time: i64,
}

impl TWAPBot {
    /// Create new TWAP bot
    pub fn new(config: TWAPConfig) -> Result<Self, BotError> {
        if config.order_count == 0 || config.order_count > 1000 {
            return Err(BotError::InvalidConfig(
                "Order count must be between 1 and 1000".to_string(),
            ));
        }

        if config.total_quantity <= 0.0 {
            return Err(BotError::InvalidConfig(
                "Total quantity must be positive".to_string(),
            ));
        }

        let order_interval_ms = (config.duration_seconds * 1000) / config.order_count as u64;

        Ok(TWAPBot {
            config,
            orders: Vec::new(),
            executed_quantity: 0.0,
            order_interval_ms,
            last_order_time: 0,
        })
    }

    /// Get quantity per order
    pub fn get_quantity_per_order(&self) -> f64 {
        self.config.total_quantity / self.config.order_count as f64
    }

    /// Check if should place next order
    pub fn should_place_order(&self, current_time: i64) -> bool {
        if self.executed_quantity >= self.config.total_quantity {
            return false;
        }

        if self.last_order_time == 0 {
            return true;
        }

        current_time - self.last_order_time >= self.order_interval_ms as i64
    }

    /// Place TWAP order
    pub fn place_order(&mut self, current_price: f64, current_time: i64) -> Option<Order> {
        if !self.should_place_order(current_time) {
            return None;
        }

        let remaining = self.config.total_quantity - self.executed_quantity;
        let qty = remaining.min(self.get_quantity_per_order());

        // Apply price limit if set
        let price = if let Some(limit) = self.config.price_limit {
            match self.config.side {
                OrderSide::Buy => current_price.min(limit),
                OrderSide::Sell => current_price.max(limit),
            }
        } else {
            current_price
        };

        let order = create_order(
            &self.config.symbol,
            self.config.side,
            self.config.order_type,
            &format!("{:.prec$}", qty, prec = self.config.quantity_precision),
            &format!("{:.prec$}", price, prec = self.config.price_precision),
        );

        self.executed_quantity += qty;
        self.last_order_time = current_time;
        self.orders.push(order.clone());

        Some(order)
    }

    /// Get execution progress
    pub fn get_progress(&self) -> f64 {
        if self.config.total_quantity == 0.0 {
            0.0
        } else {
            self.executed_quantity / self.config.total_quantity * 100.0
        }
    }

    /// Check if completed
    pub fn is_completed(&self) -> bool {
        self.executed_quantity >= self.config.total_quantity
    }
}

// ============================================================================
// ARBITRAGE BOT
// ============================================================================

/// Arbitrage opportunity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    pub symbol_a: String,
    pub symbol_b: String,
    pub exchange_a_price: f64,
    pub exchange_b_price: f64,
    pub profit_percent: f64,
    pub size: f64,
    pub estimated_profit: f64,
}

/// Arbitrage trading bot
pub struct ArbitrageBot {
    config: ArbitrageConfig,
    opportunities: Vec<ArbitrageOpportunity>,
    total_profit: f64,
    total_trades: u64,
}

impl ArbitrageBot {
    /// Create new arbitrage bot
    pub fn new(config: ArbitrageConfig) -> Result<Self, BotError> {
        if config.min_profit_percent <= 0.0 {
            return Err(BotError::InvalidConfig(
                "Min profit percent must be positive".to_string(),
            ));
        }

        if config.order_size <= 0.0 {
            return Err(BotError::InvalidConfig(
                "Order size must be positive".to_string(),
            ));
        }

        Ok(ArbitrageBot {
            config,
            opportunities: Vec::new(),
            total_profit: 0.0,
            total_trades: 0,
        })
    }

    /// Check for arbitrage opportunities
    pub fn check_arbitrage(&mut self, price_a: f64, price_b: f64) -> Option<ArbitrageOpportunity> {
        if price_a == 0.0 || price_b == 0.0 {
            return None;
        }

        // Calculate profit from cross-exchange arbitrage
        let profit_percent = if price_a < price_b {
            ((price_b - price_a) / price_a) * 100.0
        } else {
            ((price_a - price_b) / price_b) * 100.0
        };

        if profit_percent >= self.config.min_profit_percent {
            let opportunity = ArbitrageOpportunity {
                symbol_a: self.config.symbol_a.clone(),
                symbol_b: self.config.symbol_b.clone(),
                exchange_a_price: price_a,
                exchange_b_price: price_b,
                profit_percent,
                size: self.config.order_size,
                estimated_profit: self.config.order_size * profit_percent / 100.0,
            };

            self.opportunities.push(opportunity.clone());
            Some(opportunity)
        } else {
            None
        }
    }

    /// Execute arbitrage trade
    pub fn execute_arbitrage(&mut self, opportunity: &ArbitrageOpportunity) -> Vec<Order> {
        let mut orders = Vec::new();

        // Buy on cheaper exchange, sell on expensive
        if opportunity.exchange_a_price < opportunity.exchange_b_price {
            // Buy on A, Sell on B
            let buy_order = create_order(
                &self.config.symbol_a,
                OrderSide::Buy,
                OrderType::Market,
                &format!("{:.prec$}", opportunity.size, prec = self.config.quantity_precision),
                &format!("{:.prec$}", opportunity.exchange_a_price, prec = self.config.price_precision),
            );
            
            let sell_order = create_order(
                &self.config.symbol_b,
                OrderSide::Sell,
                OrderType::Market,
                &format!("{:.prec$}", opportunity.size, prec = self.config.quantity_precision),
                &format!("{:.prec$}", opportunity.exchange_b_price, prec = self.config.price_precision),
            );

            orders.push(buy_order);
            orders.push(sell_order);
        } else {
            // Buy on B, Sell on A
            let buy_order = create_order(
                &self.config.symbol_b,
                OrderSide::Buy,
                OrderType::Market,
                &format!("{:.prec$}", opportunity.size, prec = self.config.quantity_precision),
                &format!("{:.prec$}", opportunity.exchange_b_price, prec = self.config.price_precision),
            );
            
            let sell_order = create_order(
                &self.config.symbol_a,
                OrderSide::Sell,
                OrderType::Market,
                &format!("{:.prec$}", opportunity.size, prec = self.config.quantity_precision),
                &format!("{:.prec$}", opportunity.exchange_a_price, prec = self.config.price_precision),
            );

            orders.push(buy_order);
            orders.push(sell_order);
        }

        self.total_profit += opportunity.estimated_profit;
        self.total_trades += 1;

        orders
    }

    /// Get total profit
    pub fn get_total_profit(&self) -> f64 {
        self.total_profit
    }

    /// Get trade count
    pub fn get_trade_count(&self) -> u64 {
        self.total_trades
    }
}

// ============================================================================
// BOT MANAGER
// ============================================================================

/// Bot manager for handling multiple bots
pub struct BotManager {
    bots: HashMap<String, BotState>,
}

impl BotManager {
    /// Create new bot manager
    pub fn new() -> Self {
        BotManager {
            bots: HashMap::new(),
        }
    }

    /// Create and register a new bot
    pub fn create_bot(&mut self, bot_type: BotType, config: BotConfig) -> Result<String, BotError> {
        let bot_id = format!("bot_{}_{}", 
            match bot_type {
                BotType::Grid => "grid",
                BotType::Dca => "dca",
                BotType::Twap => "twap",
                BotType::Arbitrage => "arb",
            },
            Utc::now().timestamp_millis()
        );

        let state = BotState {
            bot_id: bot_id.clone(),
            bot_type,
            status: BotStatus::Stopped,
            config,
            created_at: Utc::now().timestamp_millis(),
            updated_at: Utc::now().timestamp_millis(),
            started_at: None,
            total_pnl: "0".to_string(),
            total_trades: 0,
            running_orders: Vec::new(),
        };

        self.bots.insert(bot_id.clone(), state);
        Ok(bot_id)
    }

    /// Start a bot
    pub fn start_bot(&mut self, bot_id: &str) -> Result<(), BotError> {
        if let Some(bot) = self.bots.get_mut(bot_id) {
            if bot.status == BotStatus::Running {
                return Err(BotError::InvalidConfig("Bot already running".to_string()));
            }

            bot.status = BotStatus::Running;
            bot.started_at = Some(Utc::now().timestamp_millis());
            bot.updated_at = Utc::now().timestamp_millis();
            Ok(())
        } else {
            Err(BotError::InvalidConfig("Bot not found".to_string()))
        }
    }

    /// Stop a bot
    pub fn stop_bot(&mut self, bot_id: &str) -> Result<(), BotError> {
        if let Some(bot) = self.bots.get_mut(bot_id) {
            bot.status = BotStatus::Stopped;
            bot.updated_at = Utc::now().timestamp_millis();
            Ok(())
        } else {
            Err(BotError::InvalidConfig("Bot not found".to_string()))
        }
    }

    /// Get bot state
    pub fn get_bot(&self, bot_id: &str) -> Option<&BotState> {
        self.bots.get(bot_id)
    }

    /// Get all bots
    pub fn get_all_bots(&self) -> Vec<&BotState> {
        self.bots.values().collect()
    }

    /// Get bots by type
    pub fn get_bots_by_type(&self, bot_type: BotType) -> Vec<&BotState> {
        self.bots.values()
            .filter(|b| b.bot_type == bot_type)
            .collect()
    }

    /// Delete a bot
    pub fn delete_bot(&mut self, bot_id: &str) -> bool {
        self.bots.remove(bot_id).is_some()
    }
}

impl Default for BotManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_bot() {
        let config = GridConfig {
            symbol: "BTCUSDT".to_string(),
            upper_price: 51000.0,
            lower_price: 49000.0,
            grid_count: 10,
            quantity_per_grid: 0.01,
            max_position: 0.1,
            price_precision: 2,
            quantity_precision: 4,
        };

        let bot = GridBot::new(config).unwrap();
        assert_eq!(bot.get_grid_prices().len(), 10);
    }

    #[test]
    fn test_dca_bot() {
        let config = DCAConfig {
            symbol: "BTCUSDT".to_string(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            quantity: 0.01,
            frequency_seconds: 3600,
            price_deviation_percent: 2.0,
            max_orders: 10,
            take_profit_percent: 5.0,
            stop_loss_percent: 10.0,
            price_precision: 2,
            quantity_precision: 4,
        };

        let bot = DCABot::new(config).unwrap();
        let stats = bot.get_stats();
        assert_eq!(stats.total_trades, 0);
    }

    #[test]
    fn test_twap_bot() {
        let config = TWAPConfig {
            symbol: "BTCUSDT".to_string(),
            side: OrderSide::Buy,
            total_quantity: 1.0,
            order_count: 10,
            duration_seconds: 3600,
            order_type: OrderType::Limit,
            price_limit: Some(50000.0),
            price_precision: 2,
            quantity_precision: 4,
        };

        let bot = TWAPBot::new(config).unwrap();
        assert_eq!(bot.get_quantity_per_order(), 0.1);
    }

    #[test]
    fn test_arbitrage_bot() {
        let config = ArbitrageConfig {
            symbol_a: "BTCUSDT".to_string(),
            symbol_b: "BTCUSDT".to_string(),
            exchange_a: "binance".to_string(),
            exchange_b: "bybit".to_string(),
            min_profit_percent: 0.5,
            order_size: 1.0,
            max_position: 10.0,
            price_precision: 2,
            quantity_precision: 4,
        };

        let mut bot = ArbitrageBot::new(config).unwrap();
        
        // Price difference 1% - should trigger
        let opp = bot.check_arbitrage(50000.0, 50500.0);
        assert!(opp.is_some());
        
        if let Some(ref o) = opp {
            assert!(o.profit_percent >= 0.5);
        }
    }

    #[test]
    fn test_bot_manager() {
        let mut manager = BotManager::new();
        
        let config = BotConfig::Grid(GridConfig {
            symbol: "BTCUSDT".to_string(),
            upper_price: 51000.0,
            lower_price: 49000.0,
            grid_count: 10,
            quantity_per_grid: 0.01,
            max_position: 0.1,
            price_precision: 2,
            quantity_precision: 4,
        });
        
        let bot_id = manager.create_bot(BotType::Grid, config).unwrap();
        assert!(manager.start_bot(&bot_id).is_ok());
        assert!(manager.stop_bot(&bot_id).is_ok());
        assert!(manager.delete_bot(&bot_id));
    }
}