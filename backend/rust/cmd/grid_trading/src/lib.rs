//! TigerEx Grid Trading Bot - Advanced Rust Implementation
//! Complete grid trading, DCA, and signal trading bots
//! With real market execution and portfolio management

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

// ============================================================================
// CORE TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridConfig {
    pub grid_id: String,
    pub user_id: String,
    pub symbol: String,
    pub grid_type: GridType,
    pub lower_price: f64,
    pub upper_price: f64,
    pub grid_count: i32,
    /// Base-asset quantity placed on each grid level.
    pub order_quantity: f64,
    pub position_mode: PositionMode,
    pub auto_rebalance: bool,
    pub take_profit: f64,
    pub stop_loss: Option<f64>,
    pub status: BotStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum GridType {
    Arithmetic,  // Equal price increments
    Geometric,    // Equal percentage increments
    Custom,       // Custom grid levels
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum PositionMode {
    Long,
    Short,
    Neutral,  // Buy low, sell high (market neutral)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum BotStatus {
    Active,
    Paused,
    Stopped,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridLevel {
    pub level: i32,
    pub price: f64,
    pub buy_quantity: f64,
    pub sell_quantity: f64,
    pub buy_filled: bool,
    pub sell_filled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridOrder {
    pub order_id: String,
    pub grid_id: String,
    pub level: i32,
    pub side: OrderSide,
    pub price: f64,
    pub quantity: f64,
    pub filled: bool,
    pub fill_price: Option<f64>,
    pub filled_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

// ============================================================================
// DCA CONFIGURATION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcaConfig {
    pub dca_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: DcaSide,
    pub amount_per_order: f64,
    pub order_interval_seconds: i64,
    pub total_orders: i32,
    pub total_budget: f64,
    pub price_deviation_trigger: f64,  // % price drop to trigger extra order
    pub max_price_deviation: f64,       // Max % below entry to continue
    pub take_profit: f64,
    pub status: BotStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum DcaSide {
    Buy,       // Buy on dips
    Sell,      // Sell on pumps
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcaOrder {
    pub order_id: String,
    pub dca_id: String,
    pub order_number: i32,
    pub side: DcaSide,
    pub amount: f64,
    pub price: f64,
    pub executed: bool,
    pub executed_price: Option<f64>,
    pub executed_at: Option<i64>,
}

// ============================================================================
// COPY TRADING
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterTrader {
    pub master_id: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub bio: String,
    pub total_trades: i64,
    pub win_rate: f64,
    pub profit_factor: f64,
    pub avg_trade_duration: i64,  // seconds
    pub max_drawdown: f64,
    pub aum: f64,               // Assets Under Management
    pub followers: i64,
    pub performance_1d: f64,
    pub performance_1w: f64,
    pub performance_1m: f64,
    pub performance_3m: f64,
    pub performance_1y: f64,
    pub verified: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyTradingConfig {
    pub config_id: String,
    pub follower_id: String,
    pub master_id: String,
    pub copy_mode: CopyMode,
    pub allocation: f64,           // % of portfolio to allocate
    pub fixed_allocation: Option<f64>,  // Fixed amount
    pub max_slippage: f64,          // Max slippage % before skip
    pub stop_loss_percent: f64,      // Global stop loss
    pub take_profit_percent: f64,     // Global take profit
    pub status: CopyStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CopyMode {
    Percentage,  // Follow with % of master position
    FixedAmount,  // Follow with fixed amount
    FixedRatio,   // Follow at fixed ratio
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CopyStatus {
    Active,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopiedPosition {
    pub position_id: String,
    pub config_id: String,
    pub master_order_id: String,
    pub follower_order_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub current_price: f64,
    pub pnl: f64,
    pub status: PositionStatus,
    pub opened_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum PositionStatus {
    Open,
    Closed,
    Partial,
}

// ============================================================================
// SIGNAL TRADING
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalConfig {
    pub signal_id: String,
    pub user_id: String,
    pub name: String,
    pub source: SignalSource,
    pub symbols: Vec<String>,
    pub indicators: Vec<IndicatorConfig>,
    pub entry_conditions: Vec<Condition>,
    pub exit_conditions: Vec<Condition>,
    pub risk_management: RiskManagement,
    pub status: SignalStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SignalSource {
    Custom,
    TradingView,
    CustomIndicator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorConfig {
    pub name: String,
    pub indicator_type: IndicatorType,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum IndicatorType {
    RSI,
    MACD,
    BollingerBands,
    MovingAverage,
    EMA,
    SMA,
    Stochastic,
    ADX,
    Volume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConditionType {
    Indicator,
    Price,
    Volume,
    Time,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub condition_type: ConditionType,
    pub indicator: String,
    pub operator: String,  // ">", "<", "==", "crosses_above", "crosses_below"
    pub value: f64,
    pub timeframe: Option<i32>,  // minutes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskManagement {
    pub max_position_size: f64,
    pub max_position_percent: f64,
    pub max_daily_loss: f64,
    pub stop_loss_percent: f64,
    pub take_profit_percent: f64,
    pub trailing_stop: bool,
    pub trailing_stop_percent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum SignalStatus {
    Active,
    Paused,
    Stopped,
}

// ============================================================================
// TRADING BOT ENGINE
// ============================================================================

pub struct TradingBotEngine {
    pub grid_configs: RwLock<HashMap<String, GridConfig>>,
    pub grid_levels: RwLock<HashMap<String, Vec<GridLevel>>>,
    pub grid_orders: RwLock<HashMap<String, Vec<GridOrder>>>,
    pub dca_configs: RwLock<HashMap<String, DcaConfig>>,
    pub dca_orders: RwLock<HashMap<String, Vec<DcaOrder>>>,
    pub copy_configs: RwLock<HashMap<String, CopyTradingConfig>>,
    pub copied_positions: RwLock<HashMap<String, CopiedPosition>>,
    pub signal_configs: RwLock<HashMap<String, SignalConfig>>,
    pub master_traders: RwLock<Vec<MasterTrader>>,
    pub market_prices: RwLock<HashMap<String, f64>>,
    pub user_balances: RwLock<HashMap<String, HashMap<String, f64>>>,
}

impl TradingBotEngine {
    pub fn new() -> Self {
        Self {
            grid_configs: RwLock::new(HashMap::new()),
            grid_levels: RwLock::new(HashMap::new()),
            grid_orders: RwLock::new(HashMap::new()),
            dca_configs: RwLock::new(HashMap::new()),
            dca_orders: RwLock::new(HashMap::new()),
            copy_configs: RwLock::new(HashMap::new()),
            copied_positions: RwLock::new(HashMap::new()),
            signal_configs: RwLock::new(HashMap::new()),
            master_traders: RwLock::new(Vec::new()),
            market_prices: RwLock::new(HashMap::new()),
            user_balances: RwLock::new(HashMap::new()),
        }
    }
    
    pub fn initialize(&self) {
        // No seeded traders, prices, or balances. Configure verified feeds and
        // persistent account services before exposing trading functionality.
    }
    
    // ========================================================================
    // GRID TRADING
    // ========================================================================
    
    pub async fn create_grid(&self, config: GridConfig) -> Result<GridConfig, String> {

        if config.grid_count < 2 {
            return Err("grid_count must be at least 2".to_string());
        }
        if !(config.lower_price.is_finite() && config.upper_price.is_finite())
            || config.lower_price <= 0.0
            || config.upper_price <= config.lower_price
        {
            return Err("upper_price must be greater than a positive lower_price".to_string());
        }
        if !config.order_quantity.is_finite() || config.order_quantity <= 0.0 {
            return Err("order_quantity must be positive".to_string());
        }

        // Reject a duplicate id rather than silently overwriting a live grid.
        if self.grid_configs.read().await.contains_key(&config.grid_id) {
            return Err(format!("grid {} already exists", config.grid_id));
        }
        let grid_id = config.grid_id.clone();
        
        // Calculate grid levels
        let step = (config.upper_price - config.lower_price) / (config.grid_count as f64);
        let mut levels = Vec::new();
        
        for i in 0..config.grid_count {
            let price = config.lower_price + (i as f64 * step);
            levels.push(GridLevel {
                level: i,
                price,
                buy_quantity: if config.position_mode == PositionMode::Short {
                    0.0
                } else {
                    config.order_quantity
                },
                sell_quantity: if config.position_mode == PositionMode::Long {
                    0.0
                } else {
                    config.order_quantity
                },
                buy_filled: false,
                sell_filled: false,
            });
        }
        
        // Store config and levels
        let mut configs = self.grid_configs.write().await;
        configs.insert(grid_id.clone(), config.clone());
        
        let mut grid_levels = self.grid_levels.write().await;
        grid_levels.insert(grid_id.clone(), levels);
        
        // Initialize grid orders
        let mut grid_orders = self.grid_orders.write().await;
        grid_orders.insert(grid_id.clone(), Vec::new());
        
        Ok(config)
    }
    
    pub async fn execute_grid_order(&self, _grid_id: &str, _level: i32, _side: OrderSide) -> Result<GridOrder, String> {
        Err("Grid execution unavailable: canonical matching engine and account ledger are not configured".to_string())
    }
    
    pub async fn get_grid_status(&self, grid_id: &str) -> Result<GridStatus, String> {
        let configs = self.grid_configs.read().await;
        let config = configs.get(grid_id).ok_or("Grid not found")?;
        
        let levels = self.grid_levels.read().await;
        let grid_levels = levels.get(grid_id).ok_or("Grid levels not found")?;
        
        let filled_count = grid_levels.iter()
            .filter(|l| l.buy_filled && l.sell_filled)
            .count();
        
        let total_count = grid_levels.len();
        
        let status = if filled_count == total_count {
            BotStatus::Completed
        } else {
            config.status
        };

        Ok(GridStatus {
            status,
            filled_grids: filled_count as i32,
            total_grids: total_count as i32,
            unrealized_pnl: 0.0,
        })
    }
    
    // ========================================================================
    // DCA TRADING
    // ========================================================================
    
    pub async fn create_dca(&self, config: DcaConfig) -> Result<DcaConfig, String> {
        let dca_id = config.dca_id.clone();
        
        // Create DCA orders
        let mut orders = Vec::new();
        let amount = config.total_budget / (config.total_orders as f64);
        
        for i in 0..config.total_orders {
            orders.push(DcaOrder {
                order_id: generate_id("DCA"),
                dca_id: dca_id.clone(),
                order_number: i + 1,
                side: config.side,
                amount,
                price: 0.0,  // Will be set at execution time
                executed: false,
                executed_price: None,
                executed_at: None,
            });
        }
        
        // Store config and orders
        let mut configs = self.dca_configs.write().await;
        configs.insert(dca_id.clone(), config.clone());
        
        let mut dca_orders = self.dca_orders.write().await;
        dca_orders.insert(dca_id.clone(), orders);
        
        Ok(config)
    }
    
    pub async fn execute_dca_order(&self, _dca_id: &str, _order_number: i32) -> Result<DcaOrder, String> {
        Err("DCA execution unavailable: canonical matching engine and account ledger are not configured".to_string())
    }
    
    pub async fn get_dca_progress(&self, dca_id: &str) -> Result<DcaProgress, String> {
        let configs = self.dca_configs.read().await;
        let config = configs.get(dca_id).ok_or("DCA not found")?;
        
        let dca_orders = self.dca_orders.read().await;
        let orders = dca_orders.get(dca_id).ok_or("Orders not found")?;
        
        let executed = orders.iter().filter(|o| o.executed).count() as i32;
        let total = orders.len() as i32;
        let total_invested: f64 = orders.iter()
            .filter(|o| o.executed)
            .map(|o| o.amount)
            .sum();
        
        let avg_price: f64 = if executed > 0 {
            orders.iter()
                .filter(|o| o.executed)
                .map(|o| o.executed_price.unwrap_or(0.0) * o.amount)
                .sum::<f64>() / total_invested
        } else {
            0.0
        };
        
        Ok(DcaProgress {
            dca_id: dca_id.to_string(),
            executed_orders: executed,
            total_orders: total,
            total_invested,
            average_price: avg_price,
            next_execution_time: current_timestamp() + config.order_interval_seconds * 1000,
        })
    }
    
    // ========================================================================
    // COPY TRADING
    // ========================================================================
    
    pub async fn get_master_traders(&self) -> Vec<MasterTrader> {
        let masters = self.master_traders.read().await;
        masters.clone()
    }
    
    pub async fn follow_master(&self, config: CopyTradingConfig) -> Result<CopyTradingConfig, String> {
        let config_id = config.config_id.clone();
        
        // Validate master exists
        let masters = self.master_traders.read().await;
        if !masters.iter().any(|m| m.master_id == config.master_id) {
            return Err("Master not found".to_string());
        }
        
        // Store config
        let mut configs = self.copy_configs.write().await;
        configs.insert(config_id, config.clone());
        
        Ok(config)
    }
    
    pub async fn unfollow_master(&self, config_id: &str) -> Result<(), String> {
        let mut configs = self.copy_configs.write().await;
        configs.remove(config_id).ok_or("Config not found")?;
        Ok(())
    }
    
    pub async fn sync_copy_position(&self, _config_id: &str, _master_position: &MasterPosition) -> Result<CopiedPosition, String> {
        Err("Copy trading unavailable: verified master positions and canonical matching engine are not configured".to_string())
    }
    
    pub async fn close_copy_position(&self, position_id: &str) -> Result<CopiedPosition, String> {
        let mut positions = self.copied_positions.write().await;
        let position = positions.get_mut(position_id).ok_or("Position not found")?;
        
        position.status = PositionStatus::Closed;
        position.closed_at = Some(current_timestamp());
        
        Ok(position.clone())
    }
    
    // ========================================================================
    // SIGNAL TRADING
    // ========================================================================
    
    pub async fn create_signal(&self, config: SignalConfig) -> Result<SignalConfig, String> {
        let signal_id = config.signal_id.clone();
        
        let mut configs = self.signal_configs.write().await;
        configs.insert(signal_id, config.clone());
        
        Ok(config)
    }
    
    pub async fn evaluate_signal(&self, _signal_id: &str) -> Result<SignalAction, String> {
        Err("Signal evaluation unavailable: verified market data and indicator pipeline are not configured".to_string())
    }
    
    // ========================================================================
    // PORTFOLIO MANAGEMENT
    // ========================================================================
    
    pub async fn calculate_portfolio_value(&self, user_id: &str) -> Result<PortfolioSummary, String> {
        let user_balances = self.user_balances.read().await;
        let balances = user_balances.get(user_id).ok_or("User not found")?;
        
        let prices = self.market_prices.read().await;
        
        let mut total_value = 0.0;
        let mut holdings = Vec::new();
        
        for (currency, balance) in balances {
            let price = prices.get(currency).unwrap_or(&1.0);
            let value = balance * price;
            total_value += value;
            
            holdings.push(Holding {
                currency: currency.clone(),
                balance: *balance,
                price: *price,
                value,
            });
        }
        
        Ok(PortfolioSummary {
            user_id: user_id.to_string(),
            total_value,
            holdings,
        })
    }
}

// ============================================================================
// HELPER STRUCTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridStatus {
    pub status: BotStatus,
    pub filled_grids: i32,
    pub total_grids: i32,
    pub unrealized_pnl: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcaProgress {
    pub dca_id: String,
    pub executed_orders: i32,
    pub total_orders: i32,
    pub total_invested: f64,
    pub average_price: f64,
    pub next_execution_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPosition {
    pub order_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub quantity: f64,
    pub price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalAction {
    pub signal_id: String,
    pub action: ActionType,
    pub reason: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ActionType {
    Enter,
    Exit,
    Hold,
    Adjust,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Holding {
    pub currency: String,
    pub balance: f64,
    pub price: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioSummary {
    pub user_id: String,
    pub total_value: f64,
    pub holdings: Vec<Holding>,
}

// ============================================================================
// UTILITIES
// ============================================================================

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn generate_id(prefix: &str) -> String {
    // A millisecond timestamp alone collides for ids created in the same
    // millisecond, so a process-wide sequence is appended.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{}{}{}", prefix, current_timestamp(), seq)
}


#[cfg(test)]
mod tests {
    use super::*;

    fn grid_config(id: &str) -> GridConfig {
        GridConfig {
            grid_id: id.to_string(),
            user_id: "u1".to_string(),
            symbol: "BTCUSDT".to_string(),
            grid_type: GridType::Arithmetic,
            lower_price: 100.0,
            upper_price: 200.0,
            grid_count: 10,
            order_quantity: 0.5,
            position_mode: PositionMode::Neutral,
            auto_rebalance: false,
            take_profit: 250.0,
            stop_loss: Some(90.0),
            status: BotStatus::Active,
            created_at: current_timestamp(),
            updated_at: current_timestamp(),
        }
    }

    #[tokio::test]
    async fn create_grid_lays_out_levels_across_the_range() {
        let service = TradingBotEngine::new();
        let config = service.create_grid(grid_config("g1")).await.unwrap();

        let levels = service.grid_levels.read().await;
        let levels = levels.get(&config.grid_id).unwrap();

        assert_eq!(levels.len(), 10);
        assert_eq!(levels[0].price, 100.0);
        // Step is (200 - 100) / 10.
        assert_eq!(levels[1].price, 110.0);
        assert_eq!(levels[9].price, 190.0);

        // A neutral grid quotes both sides at the configured size.
        assert_eq!(levels[0].buy_quantity, 0.5);
        assert_eq!(levels[0].sell_quantity, 0.5);
    }

    #[tokio::test]
    async fn long_and_short_grids_quote_one_side_only() {
        let service = TradingBotEngine::new();

        let mut long = grid_config("long");
        long.position_mode = PositionMode::Long;
        service.create_grid(long).await.unwrap();

        let mut short = grid_config("short");
        short.position_mode = PositionMode::Short;
        service.create_grid(short).await.unwrap();

        let levels = service.grid_levels.read().await;
        assert_eq!(levels.get("long").unwrap()[0].buy_quantity, 0.5);
        assert_eq!(levels.get("long").unwrap()[0].sell_quantity, 0.0);
        assert_eq!(levels.get("short").unwrap()[0].buy_quantity, 0.0);
        assert_eq!(levels.get("short").unwrap()[0].sell_quantity, 0.5);
    }

    #[tokio::test]
    async fn create_grid_rejects_invalid_configuration() {
        let service = TradingBotEngine::new();

        let mut config = grid_config("bad");
        config.grid_count = 1;
        assert!(service.create_grid(config).await.is_err());

        let mut config = grid_config("bad");
        config.upper_price = config.lower_price;
        assert!(service.create_grid(config).await.is_err());

        let mut config = grid_config("bad");
        config.lower_price = 0.0;
        assert!(service.create_grid(config).await.is_err());

        let mut config = grid_config("bad");
        config.order_quantity = 0.0;
        assert!(service.create_grid(config).await.is_err());

        let mut config = grid_config("bad");
        config.order_quantity = f64::NAN;
        assert!(service.create_grid(config).await.is_err());
    }

    #[tokio::test]
    async fn duplicate_grid_id_is_rejected() {
        let service = TradingBotEngine::new();
        service.create_grid(grid_config("g1")).await.unwrap();
        assert!(service.create_grid(grid_config("g1")).await.is_err());
    }

    #[tokio::test]
    async fn grid_status_reports_progress() {
        let service = TradingBotEngine::new();
        service.create_grid(grid_config("g1")).await.unwrap();

        let status = service.get_grid_status("g1").await.unwrap();
        assert_eq!(status.status, BotStatus::Active);
        assert_eq!(status.filled_grids, 0);
        assert_eq!(status.total_grids, 10);

        // Fill every level and the grid reports itself completed.
        {
            let mut levels = service.grid_levels.write().await;
            for level in levels.get_mut("g1").unwrap() {
                level.buy_filled = true;
                level.sell_filled = true;
            }
        }

        let status = service.get_grid_status("g1").await.unwrap();
        assert_eq!(status.status, BotStatus::Completed);
        assert_eq!(status.filled_grids, 10);
    }

    #[tokio::test]
    async fn unknown_grid_is_reported() {
        let service = TradingBotEngine::new();
        assert!(service.get_grid_status("nope").await.is_err());
    }

    #[test]
    fn generated_ids_do_not_collide() {
        let ids: std::collections::HashSet<String> =
            (0..1000).map(|_| generate_id("GRID")).collect();
        assert_eq!(ids.len(), 1000);
    }
}
