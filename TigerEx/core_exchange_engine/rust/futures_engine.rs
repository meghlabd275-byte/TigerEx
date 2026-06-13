//! TigerEx Futures Trading Engine - Rust Implementation
//! 
//! High-performance futures and perpetual swap trading engine
//! Supports leverage, funding rates, and liquidations
//! 
//! Migration from Go to Rust for institutional-grade derivatives

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Futures contract type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FuturesContractType {
    Perpetual,  // Perpetual swap
    Quarterly,   // Quarterly futures
    Monthly,    // Monthly futures
}

/// Position side
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionSide {
    Long,
    Short,
}

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FuturesOrderType {
    Market,
    Limit,
    StopMarket,
    StopLimit,
}

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Position status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Open,
    Partial,
    Closed,
    Liquidated,
}

/// Funding rate
#[derive(Debug, Clone)]
pub struct FundingRate {
    pub symbol: String,
    pub rate: i64,        // Scaled by 1e8
    pub next_funding: u64,
    pub timestamp: u64,
}

/// Position
#[derive(Debug, Clone)]
pub struct FuturesPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub size: i64,          // Position size (positive for long, negative for short)
    pub entry_price: u64,
    pub mark_price: u64,
    pub leverage: u32,
    pub margin: u64,
    pub unrealized_pnl: i64,
    pub realized_pnl: i64,
    pub open_notional: u64,
    pub status: PositionStatus,
    pub opened_at: u64,
    pub updated_at: u64,
}

impl FuturesPosition {
    pub fn calculate_unrealized_pnl(&self, mark_price: u64) -> i64 {
        let price_diff = if self.side == PositionSide::Long {
            mark_price as i64 - self.entry_price as i64
        } else {
            self.entry_price as i64 - mark_price as i64
        };
        price_diff * self.size
    }
    
    pub fn calculate_roe(&self, mark_price: u64) -> f64 {
        if self.margin == 0 {
            return 0.0;
        }
        let pnl = self.calculate_unrealized_pnl(mark_price);
        (pnl as f64 / self.margin as f64) * 100.0
    }
    
    pub fn liquidation_price(&self) -> u64 {
        let maintenance_margin = 0.005_f64; // 0.5%
        let margin_ratio = self.margin as f64 / (self.open_notional as f64);
        
        if self.side == PositionSide::Long {
            let price = self.entry_price as f64 * (1.0 - margin_ratio + maintenance_margin);
            price as u64
        } else {
            let price = self.entry_price as f64 * (1.0 + margin_ratio - maintenance_margin);
            price as u64
        }
    }
}

/// Order
#[derive(Debug, Clone)]
pub struct FuturesOrder {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: FuturesOrderType,
    pub size: i64,
    pub price: Option<u64>,
    pub stop_price: Option<u64>,
    pub filled: i64,
    pub remaining: i64,
    pub leverage: u32,
    pub margin: u64,
    pub status: OrderStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Pending,
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// Trade
#[derive(Debug, Clone)]
pub struct FuturesTrade {
    pub id: String,
    pub order_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub price: u64,
    pub size: i64,
    pub fee: u64,
    pub funding_rate: i64,
    pub timestamp: u64,
}

/// Contract info
#[derive(Debug, Clone)]
pub struct ContractInfo {
    pub symbol: String,
    pub contract_type: FuturesContractType,
    pub base_asset: String,
    pub quote_asset: String,
    pub tick_size: u64,
    pub lot_size: u64,
    pub max_leverage: u32,
    pub maintenance_margin_rate: f64,
    pub maker_fee_rate: i64,
    pub taker_fee_rate: i64,
    pub settlement_asset: String,
    pub expiration: Option<u64>,
}

/// Mark price
#[derive(Debug, Clone)]
pub struct MarkPrice {
    pub symbol: String,
    pub price: u64,
    pub timestamp: u64,
}

/// Funding history
#[derive(Debug, Clone)]
pub struct FundingHistory {
    pub symbol: String,
    pub rate: i64,
    pub timestamp: u64,
}

/// Futures Trading Engine
pub struct FuturesEngine {
    // Contracts
    contracts: HashMap<String, ContractInfo>,
    
    // Positions by user
    positions: HashMap<String, HashMap<String, FuturesPosition>>,
    
    // Orders
    orders: HashMap<String, FuturesOrder>,
    
    // Trades history
    trades: VecDeque<FuturesTrade>,
    
    // Mark prices
    mark_prices: HashMap<String, u64>,
    
    // Funding rates
    funding_rates: HashMap<String, FundingRate>,
    
    // Funding history
    funding_history: HashMap<String, VecDeque<FundingHistory>>,
    
    // Counters
    order_id_counter: u64,
    trade_id_counter: u64,
}

impl FuturesEngine {
    pub fn new() -> Self {
        FuturesEngine {
            contracts: HashMap::new(),
            positions: HashMap::new(),
            orders: HashMap::new(),
            trades: VecDeque::with_capacity(100000),
            mark_prices: HashMap::new(),
            funding_rates: HashMap::new(),
            funding_history: HashMap::new(),
            order_id_counter: 0,
            trade_id_counter: 0,
        }
    }
    
    /// Initialize default contracts
    pub fn initialize_contracts(&mut self) {
        let contracts = vec![
            ("BTC-USDT-PERP".to_string(), FuturesContractType::Perpetual, "BTC".to_string(), "USDT".to_string(), 1, 1, 125),
            ("ETH-USDT-PERP".to_string(), FuturesContractType::Perpetual, "ETH".to_string(), "USDT".to_string(), 1, 1, 125),
            ("BNB-USDT-PERP".to_string(), FuturesContractType::Perpetual, "BNB".to_string(), "USDT".to_string(), 1, 1, 100),
            ("SOL-USDT-PERP".to_string(), FuturesContractType::Perpetual, "SOL".to_string(), "USDT".to_string(), 1, 1, 100),
        ];
        
        for (symbol, contract_type, base, quote, tick, lot, leverage) in contracts {
            self.contracts.insert(symbol.clone(), ContractInfo {
                symbol: symbol.clone(),
                contract_type,
                base_asset: base,
                quote_asset: quote,
                tick_size: tick,
                lot_size: lot,
                max_leverage: leverage,
                maintenance_margin_rate: 0.005,
                maker_fee_rate: 100,   // 0.001%
                taker_fee_rate: 200,  // 0.002%
                settlement_asset: "USDT".to_string(),
                expiration: None,
            });
        }
    }
    
    /// Create futures order
    pub fn create_order(
        &mut self,
        user_id: String,
        symbol: String,
        side: OrderSide,
        order_type: FuturesOrderType,
        size: i64,
        price: Option<u64>,
        leverage: u32,
    ) -> Result<FuturesOrder, String> {
        let contract = self.contracts.get(&symbol)
            .ok_or_else(|| "Contract not found")?;
        
        if leverage > contract.max_leverage {
            return Err("Leverage exceeds maximum".to_string());
        }
        
        self.order_id_counter += 1;
        let order_id = format!("FUT-{}-{}", symbol, self.order_id_counter);
        
        let margin = self.calculate_margin(size, price.unwrap_or(0), leverage);
        
        let order = FuturesOrder {
            id: order_id.clone(),
            user_id,
            symbol,
            side,
            order_type,
            size,
            price,
            stop_price: None,
            filled: 0,
            remaining: size,
            leverage,
            margin,
            status: OrderStatus::New,
            created_at: current_timestamp(),
        };
        
        self.orders.insert(order_id, order.clone());
        Ok(order)
    }
    
    /// Calculate required margin
    fn calculate_margin(&self, size: i64, price: u64, leverage: u32) -> u64 {
        let position_value = (price as u128 * size.unsigned_abs() as u128) / leverage as u128;
        (position_value as u64).max(1)
    }
    
    /// Execute order
    pub fn execute_order(&mut self, order_id: &str, execution_price: u64) -> Result<FuturesTrade, String> {
        let order = self.orders.get_mut(order_id)
            .ok_or_else(|| "Order not found")?;
        
        if order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled {
            return Err("Order cannot be executed".to_string());
        }
        
        let contract = self.contracts.get(&order.symbol)
            .ok_or_else(|| "Contract not found")?;
        
        // Create trade
        self.trade_id_counter += 1;
        let trade = FuturesTrade {
            id: format!("FT-{}", self.trade_id_counter),
            order_id: order_id.to_string(),
            symbol: order.symbol.clone(),
            side: order.side,
            price: execution_price,
            size: order.remaining,
            fee: (execution_price as u128 * order.remaining.unsigned_abs() as u128 * contract.taker_fee_rate as u128 / 1e8) as u64,
            funding_rate: 0,
            timestamp: current_timestamp(),
        };
        
        // Update order
        order.filled = order.remaining;
        order.remaining = 0;
        order.status = OrderStatus::Filled;
        
        // Update position
        self.update_position(&order.user_id, &order.symbol, order.side, order.size, execution_price, order.margin);
        
        // Store trade
        if self.trades.len() >= 100000 {
            self.trades.pop_front();
        }
        self.trades.push_back(trade.clone());
        
        Ok(trade)
    }
    
    /// Update position
    fn update_position(&mut self, user_id: &str, symbol: &str, side: OrderSide, size: i64, price: u64, margin: u64) {
        let key = format!("{}:{}", user_id, symbol);
        let positions = self.positions.entry(user_id.to_string())
            .or_insert_with(|| HashMap::new());
        
        if let Some(pos) = positions.get_mut(symbol) {
            // Update existing position
            pos.size += if side == OrderSide::Buy { size } else { -size };
            pos.unrealized_pnl = pos.calculate_unrealized_pnl(price);
            pos.updated_at = current_timestamp();
        } else {
            // Create new position
            let position = FuturesPosition {
                id: key,
                user_id: user_id.to_string(),
                symbol: symbol.to_string(),
                side: if side == OrderSide::Buy { PositionSide::Long } else { PositionSide::Short },
                size,
                entry_price: price,
                mark_price: price,
                leverage: 10,
                margin,
                unrealized_pnl: 0,
                realized_pnl: 0,
                open_notional: price * size.unsigned_abs(),
                status: PositionStatus::Open,
                opened_at: current_timestamp(),
                updated_at: current_timestamp(),
            };
            positions.insert(symbol.to_string(), position);
        }
    }
    
    /// Update mark price
    pub fn update_mark_price(&mut self, symbol: &str, price: u64) {
        self.mark_prices.insert(symbol.to_string(), price);
        
        // Update positions
        if let Some(positions) = self.positions.values_mut() {
            if let Some(pos) = positions.get_mut(symbol) {
                pos.mark_price = price;
                pos.unrealized_pnl = pos.calculate_unrealized_pnl(price);
            }
        }
    }
    
    /// Calculate funding rate
    pub fn calculate_funding(&self, symbol: &str) -> i64 {
        let price = match self.mark_prices.get(symbol) {
            Some(p) => *p,
            None => return 0,
        };
        
        // Simple funding calculation: 0.01% per hour
        let index_price = price as i64;
        let funding = (index_price / 10000) / 100; // 0.01%
        funding
    }
    
    /// Get position
    pub fn get_position(&self, user_id: &str, symbol: &str) -> Option<&FuturesPosition> {
        self.positions.get(user_id).and_then(|p| p.get(symbol))
    }
    
    /// Get order
    pub fn get_order(&self, order_id: &str) -> Option<&FuturesOrder> {
        self.orders.get(order_id)
    }
    
    /// Get mark price
    pub fn get_mark_price(&self, symbol: &str) -> Option<u64> {
        self.mark_prices.get(symbol).copied()
    }
    
    /// Get open interest
    pub fn get_open_interest(&self, symbol: &str) -> i64 {
        self.positions.values()
            .filter_map(|p| p.get(symbol).map(|pos| pos.size))
            .sum()
    }
    
    /// Get 24h volume
    pub fn get_24h_volume(&self, symbol: &str) -> u64 {
        let now = current_timestamp();
        let day_ago = now - 86400000;
        
        self.trades.iter()
            .filter(|t| t.symbol == symbol && t.timestamp > day_ago)
            .map(|t| t.price as u64 * t.size.unsigned_abs() as u64)
            .sum()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_order() {
        let mut engine = FuturesEngine::new();
        engine.initialize_contracts();
        
        let order = engine.create_order(
            "user1".to_string(),
            "BTC-USDT-PERP".to_string(),
            OrderSide::Buy,
            FuturesOrderType::Limit,
            1000,
            Some(50000),
            10,
        ).unwrap();
        
        assert_eq!(order.size, 1000);
    }
    
    #[test]
    fn test_execute_order() {
        let mut engine = FuturesEngine::new();
        engine.initialize_contracts();
        
        let order = engine.create_order(
            "user1".to_string(),
            "BTC-USDT-PERP".to_string(),
            OrderSide::Buy,
            FuturesOrderType::Market,
            100,
            None,
            10,
        ).unwrap();
        
        let trade = engine.execute_order(&order.id, 50000).unwrap();
        assert_eq!(trade.size, 100);
    }
    
    #[test]
    fn test_mark_price() {
        let mut engine = FuturesEngine::new();
        engine.initialize_contracts();
        
        engine.update_mark_price("BTC-USDT-PERP", 50000);
        
        let price = engine.get_mark_price("BTC-USDT-PERP");
        assert_eq!(price, Some(50000));
    }
}