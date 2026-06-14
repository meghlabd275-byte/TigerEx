// TigerEx Trading Bots - High-Performance Automated Trading
// Grid, DCA, TWAP, and Trailing Stop Bots

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// BOT TRAITS
// ============================================================================

pub trait TradingBot: Send + Sync {
    fn get_id(&self) -> &str;
    fn get_name(&self) -> &str;
    fn get_status(&self) -> BotStatus;
    fn start(&mut self) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
    fn tick(&mut self) -> Result<Vec<Order>, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BotStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

// ============================================================================
// ORDER
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub bot_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: f64,
    pub price: f64,
    pub status: OrderStatus,
    pub created_at: u64,
    pub filled_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderType {
    Limit,
    Market,
    StopLoss,
    StopLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
    Pending,
    Submitted,
    Filled,
    Cancelled,
    Failed,
}

// ============================================================================
// GRID BOT
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridBot {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub status: BotStatus,
    pub grid_levels: u32,
    pub grid_spacing: f64,
    pub grid_range_low: f64,
    pub grid_range_high: f64,
    pub base_quantity: f64,
    pub total_invested: f64,
    pub active_orders: Vec<Order>,
    pub filled_orders: Vec<Order>,
    pub profit: f64,
}

impl GridBot {
    pub fn new(
        id: String,
        symbol: String,
        grid_levels: u32,
        grid_range_low: f64,
        grid_range_high: f64,
        base_quantity: f64,
    ) -> Self {
        let grid_spacing = (grid_range_high - grid_range_low) / grid_levels as f64;
        
        GridBot {
            id: id.clone(),
            name: format!("Grid-{}", id),
            symbol,
            status: BotStatus::Stopped,
            grid_levels,
            grid_spacing,
            grid_range_low,
            grid_range_high,
            base_quantity,
            total_invested: 0.0,
            active_orders: vec![],
            filled_orders: vec![],
            profit: 0.0,
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.status != BotStatus::Stopped {
            return Err("Bot already running".to_string());
        }
        
        self.status = BotStatus::Starting;
        self.generate_grid_orders()?;
        self.status = BotStatus::Running;
        
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if self.status != BotStatus::Running {
            return Err("Bot not running".to_string());
        }
        
        self.status = BotStatus::Stopping;
        
        // Cancel active orders
        for order in &mut self.active_orders {
            order.status = OrderStatus::Cancelled;
        }
        
        self.status = BotStatus::Stopped;
        
        Ok(())
    }

    pub fn tick(&mut self, current_price: f64) -> Result<Vec<Order>, String> {
        if self.status != BotStatus::Running {
            return Ok(vec![]);
        }

        let mut new_orders = vec![];
        
        // Check if price crossed a grid level
        let level = ((current_price - self.grid_range_low) / self.grid_spacing).floor() as i32;
        
        for i in 0..self.grid_levels {
            let price = self.grid_range_low + (i as f64 * self.grid_spacing);
            
            // Check if we need to place orders
            let has_buy = self.active_orders.iter()
                .any(|o| o.side == OrderSide::Buy && (o.price - price).abs() < 0.01);
            let has_sell = self.active_orders.iter()
                .any(|o| o.side == OrderSide::Sell && (o.price - price).abs() < 0.01);
            
            // Place buy order below current price
            if current_price > price && !has_buy && i as i32 < level {
                let order = Order {
                    order_id: generate_order_id(&self.id, "BUY"),
                    bot_id: self.id.clone(),
                    symbol: self.symbol.clone(),
                    side: OrderSide::Buy,
                    order_type: OrderType::Limit,
                    quantity: self.base_quantity,
                    price: price,
                    status: OrderStatus::Pending,
                    created_at: current_time(),
                    filled_at: None,
                };
                new_orders.push(order);
            }
            
            // Place sell order above current price
            if current_price < price && !has_sell && i as i32 > level {
                let order = Order {
                    order_id: generate_order_id(&self.id, "SELL"),
                    bot_id: self.id.clone(),
                    symbol: self.symbol.clone(),
                    side: OrderSide::Sell,
                    order_type: OrderType::Limit,
                    quantity: self.base_quantity,
                    price: price,
                    status: OrderStatus::Pending,
                    created_at: current_time(),
                    filled_at: None,
                };
                new_orders.push(order);
            }
        }
        
        Ok(new_orders)
    }

    fn generate_grid_orders(&mut self) -> Result<(), String> {
        self.active_orders.clear();
        
        for i in 0..self.grid_levels {
            let price = self.grid_range_low + (i as f64 * self.grid_spacing);
            
            // Buy at even levels
            if i % 2 == 0 {
                let order = Order {
                    order_id: generate_order_id(&self.id, "BUY"),
                    bot_id: self.id.clone(),
                    symbol: self.symbol.clone(),
                    side: OrderSide::Buy,
                    order_type: OrderType::Limit,
                    quantity: self.base_quantity,
                    price: price,
                    status: OrderStatus::Pending,
                    created_at: current_time(),
                    filled_at: None,
                };
                self.active_orders.push(order);
            }
        }
        
        Ok(())
    }

    pub fn get_profit(&self) -> f64 {
        self.profit
    }

    pub fn get_total_invested(&self) -> f64 {
        self.total_invested
    }
}

// ============================================================================
// DCA BOT (Dollar Cost Averaging)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DCABot {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub status: BotStatus,
    pub target_amount: f64,
    pub current_amount: f64,
    pub num_purchases: u32,
    pub purchase_interval: u64, // seconds
    pub purchase_size: f64,
    pub last_purchase: u64,
    pub next_purchase: u64,
    pub filled_orders: Vec<Order>,
}

impl DCABot {
    pub fn new(
        id: String,
        symbol: String,
        target_amount: f64,
        num_purchases: u32,
        purchase_interval: u64,
    ) -> Self {
        let purchase_size = target_amount / num_purchases as f64;
        
        DCABot {
            id: id.clone(),
            name: format!("DCA-{}", id),
            symbol,
            status: BotStatus::Stopped,
            target_amount,
            current_amount: 0.0,
            num_purchases,
            purchase_interval,
            purchase_size,
            last_purchase: 0,
            next_purchase: current_time() + purchase_interval,
            filled_orders: vec![],
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.status != BotStatus::Stopped {
            return Err("Bot already running".to_string());
        }
        
        self.status = BotStatus::Running;
        self.next_purchase = current_time() + self.purchase_interval;
        
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.status = BotStatus::Stopped;
        Ok(())
    }

    pub fn tick(&mut self, current_price: f64) -> Result<Option<Order>, String> {
        if self.status != BotStatus::Running {
            return Ok(None);
        }
        
        // Check if we should make a purchase
        let now = current_time();
        if now < self.next_purchase {
            return Ok(None);
        }
        
        // Check if we've reached target
        if self.current_amount >= self.target_amount {
            return Ok(None);
        }
        
        // Create purchase order
        let quantity = self.purchase_size / current_price;
        
        let order = Order {
            order_id: generate_order_id(&self.id, "DCA"),
            bot_id: self.id.clone(),
            symbol: self.symbol.clone(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            quantity: quantity,
            price: current_price,
            status: OrderStatus::Pending,
            created_at: now,
            filled_at: None,
        };
        
        self.last_purchase = now;
        self.next_purchase = now + self.purchase_interval;
        self.current_amount += self.purchase_size;
        
        Ok(Some(order))
    }

    pub fn get_progress(&self) -> f64 {
        self.current_amount / self.target_amount
    }
}

// ============================================================================
// TWAP BOT
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TWAPBot {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub status: BotStatus,
    pub side: OrderSide,
    pub total_quantity: f64,
    pub remaining_quantity: f64,
    pub num_slices: u32,
    pub slice_interval: u64,
    pub last_slice: u64,
    pub next_slice: u64,
    pub active_orders: Vec<Order>,
}

impl TWAPBot {
    pub fn new(
        id: String,
        symbol: String,
        side: OrderSide,
        total_quantity: f64,
        num_slices: u32,
        slice_interval: u64,
    ) -> Self {
        let slice_quantity = total_quantity / num_slices as f64;
        
        TWAPBot {
            id: id.clone(),
            name: format!("TWAP-{}", id),
            symbol,
            status: BotStatus::Stopped,
            side,
            total_quantity,
            remaining_quantity: total_quantity,
            num_slices,
            slice_interval,
            last_slice: 0,
            next_slice: current_time() + slice_interval,
            active_orders: vec![],
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        self.status = BotStatus::Running;
        self.next_slice = current_time() + self.slice_interval;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.status = BotStatus::Stopped;
        Ok(())
    }

    pub fn tick(&mut self, current_price: f64) -> Result<Option<Order>, String> {
        if self.status != BotStatus::Running {
            return Ok(None);
        }
        
        let now = current_time();
        if now < self.next_slice {
            return Ok(None);
        }
        
        if self.remaining_quantity <= 0.0 {
            return Ok(None);
        }
        
        let slice_quantity = self.total_quantity / self.num_slices as f64;
        
        let order = Order {
            order_id: generate_order_id(&self.id, "TWAP"),
            bot_id: self.id.clone(),
            symbol: self.symbol.clone(),
            side: self.side.clone(),
            order_type: OrderType::Limit,
            quantity: slice_quantity,
            price: current_price,
            status: OrderStatus::Pending,
            created_at: now,
            filled_at: None,
        };
        
        self.last_slice = now;
        self.next_slice = now + self.slice_interval;
        self.remaining_quantity -= slice_quantity;
        
        Ok(Some(order))
    }

    pub fn get_progress(&self) -> f64 {
        (self.total_quantity - self.remaining_quantity) / self.total_quantity
    }
}

// ============================================================================
// TRAILING STOP BOT
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrailingStopBot {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub status: BotStatus,
    pub side: OrderSide,
    pub initial_quantity: f64,
    pub current_quantity: f64,
    pub activation_price: f64,
    pub callback_rate: f64, // percentage
    pub highest_price: f64,
    pub stop_price: f64,
    pub active_order: Option<Order>,
    pub filled_orders: Vec<Order>,
}

impl TrailingStopBot {
    pub fn new(
        id: String,
        symbol: String,
        side: OrderSide,
        initial_quantity: f64,
        activation_price: f64,
        callback_rate: f64,
    ) -> Self {
        TrailingStopBot {
            id: id.clone(),
            name: format!("Trailing-{}", id),
            symbol,
            status: BotStatus::Stopped,
            side,
            initial_quantity,
            current_quantity: initial_quantity,
            activation_price,
            callback_rate,
            highest_price: activation_price,
            stop_price: 0.0,
            active_order: None,
            filled_orders: vec![],
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        self.status = BotStatus::Running;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.status = BotStatus::Stopped;
        if let Some(ref mut order) = self.active_order {
            order.status = OrderStatus::Cancelled;
        }
        Ok(())
    }

    pub fn tick(&mut self, current_price: f64) -> Result<Option<Order>, String> {
        if self.status != BotStatus::Running {
            return Ok(None);
        }

        // Update highest price for long positions
        if self.side == OrderSide::Sell && current_price > self.highest_price {
            self.highest_price = current_price;
        }
        // Update lowest price for short positions
        if self.side == OrderSide::Buy && current_price < self.highest_price {
            self.highest_price = current_price;
        }

        // Calculate new stop price
        let new_stop = match self.side {
            OrderSide::Sell => self.highest_price * (1.0 - self.callback_rate / 100.0),
            OrderSide::Buy => self.highest_price * (1.0 + self.callback_rate / 100.0),
        };

        // Check if stop should be triggered
        let should_trigger = match self.side {
            OrderSide::Sell => current_price <= new_stop,
            OrderSide::Buy => current_price >= new_stop,
        };

        // Check if activation price is reached
        let activated = match self.side {
            OrderSide::Sell => current_price <= self.activation_price,
            OrderSide::Buy => current_price >= self.activation_price,
        };

        if !activated {
            return Ok(None);
        }

        // Place stop order if not already placed
        if self.active_order.is_none() {
            let order = Order {
                order_id: generate_order_id(&self.id, "STOP"),
                bot_id: self.id.clone(),
                symbol: self.symbol.clone(),
                side: self.side.clone(),
                order_type: OrderType::StopLoss,
                quantity: self.current_quantity,
                price: new_stop,
                status: OrderStatus::Pending,
                created_at: current_time(),
                filled_at: None,
            };
            
            self.stop_price = new_stop;
            self.active_order = Some(order);
            
            return Ok(Some(order.clone()));
        }

        // Update stop price if moved
        if (new_stop - self.stop_price).abs() > 0.01 {
            if let Some(ref mut order) = self.active_order {
                order.price = new_stop;
                self.stop_price = new_stop;
                return Ok(Some(order.clone()));
            }
        }

        Ok(None)
    }

    pub fn get_profit(&self) -> f64 {
        self.highest_price - self.activation_price
    }
}

// ============================================================================
// BOT MANAGER
// ============================================================================

pub struct BotManager {
    pub grid_bots: Vec<GridBot>,
    pub dca_bots: Vec<DCABot>,
    pub twap_bots: Vec<TWAPBot>,
    pub trailing_bots: Vec<TrailingStopBot>,
}

impl BotManager {
    pub fn new() -> Self {
        BotManager {
            grid_bots: vec![],
            dca_bots: vec![],
            twap_bots: vec![],
            trailing_bots: vec![],
        }
    }

    pub fn create_grid_bot(&mut self, symbol: String, grid_levels: u32, grid_range_low: f64, grid_range_high: f64, base_quantity: f64) -> String {
        let id = generate_bot_id("GRID");
        let bot = GridBot::new(id.clone(), symbol, grid_levels, grid_range_low, grid_range_high, base_quantity);
        self.grid_bots.push(bot);
        id
    }

    pub fn create_dca_bot(&mut self, symbol: String, target_amount: f64, num_purchases: u32, purchase_interval: u64) -> String {
        let id = generate_bot_id("DCA");
        let bot = DCABot::new(id.clone(), symbol, target_amount, num_purchases, purchase_interval);
        self.dca_bots.push(bot);
        id
    }

    pub fn create_twap_bot(&mut self, symbol: String, side: OrderSide, total_quantity: f64, num_slices: u32, slice_interval: u64) -> String {
        let id = generate_bot_id("TWAP");
        let bot = TWAPBot::new(id.clone(), symbol, side, total_quantity, num_slices, slice_interval);
        self.twap_bots.push(bot);
        id
    }

    pub fn create_trailing_bot(&mut self, symbol: String, side: OrderSide, initial_quantity: f64, activation_price: f64, callback_rate: f64) -> String {
        let id = generate_bot_id("TRAIL");
        let bot = TrailingStopBot::new(id.clone(), symbol, side, initial_quantity, activation_price, callback_rate);
        self.trailing_bots.push(bot);
        id
    }
}

// ============================================================================
// HELPERS
// ============================================================================

fn current_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn generate_bot_id(prefix: &str) -> String {
    format!("{}_{}_{}", prefix, current_time(), rand_u64() % 10000)
}

fn generate_order_id(bot_id: &str) -> String {
    format!("{}_{}_{}", bot_id, current_time(), rand_u64() % 10000)
}

fn rand_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}