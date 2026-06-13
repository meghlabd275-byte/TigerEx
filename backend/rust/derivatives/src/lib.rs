//! TigerEx Derivatives Engine - High-Performance Derivatives Trading
//! 
//! Supports USDT-M Futures, COIN-M Futures, Options, and Perpetual Contracts

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Use core types
use tigerex_core::{
    OrderSide, OrderStatus, OrderType, TradingPair, CryptoSystem,
};

// ============================================================================
// FUTURES TYPES
// ============================================================================

/// Futures contract type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FuturesType {
    /// USDT-Margined Futures
    USDTM,
    /// Coin-Margined Futures
    COINM,
    /// Perpetual Contracts
    Perpetual,
    /// Quarterly Futures
    Quarterly,
    /// Bi-Weekly Futures
    BiWeekly,
    /// Index Futures
    Index,
    /// Range Futures
    Range,
}

/// Position side for derivatives
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
    Both,
}

/// Funding rate information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundingRate {
    pub symbol: String,
    pub funding_rate: f64,
    pub next_funding_time: i64,
    pub predicted_rate: f64,
}

/// Futures position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuturesPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub liquidation_price: f64,
    pub margin_used: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub leverage: u32,
    pub isolated: bool,
    pub position_margin: f64,
    pub order_margin: f64,
    pub maintenance_margin: f64,
    pub opened_at: i64,
    pub updated_at: i64,
}

impl FuturesPosition {
    pub fn new(
        user_id: &str,
        symbol: &str,
        side: PositionSide,
        quantity: f64,
        entry_price: f64,
        leverage: u32,
        isolated: bool,
    ) -> Self {
        let margin_required = (quantity * entry_price) / (leverage as f64);
        let maintenance_margin = margin_required * 0.5; // 50% of initial margin
        let liquidation_price = match side {
            PositionSide::Long => entry_price * (1.0 - 1.0 / (leverage as f64)),
            PositionSide::Short => entry_price * (1.0 + 1.0 / (leverage as f64)),
            PositionSide::Both => entry_price,
        };

        Self {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            quantity,
            entry_price,
            mark_price: entry_price,
            liquidation_price,
            margin_used: margin_required,
            unrealized_pnl: 0.0,
            realized_pnl: 0.0,
            leverage,
            isolated,
            position_margin: margin_required,
            order_margin: 0.0,
            maintenance_margin,
            opened_at: Utc::now().timestamp_millis(),
            updated_at: Utc::now().timestamp_millis(),
        }
    }

    /// Update position with new trade
    pub fn add_trade(&mut self, trade_price: f64, trade_quantity: f64, trade_side: PositionSide) {
        if self.side == trade_side || self.side == PositionSide::Both {
            // Add to position
            let total_cost = self.entry_price * self.quantity + trade_price * trade_quantity;
            self.quantity += trade_quantity;
            self.entry_price = total_cost / self.quantity;
        } else {
            // Reduce or flip position
            if trade_quantity >= self.quantity {
                // Flip side
                let remaining = trade_quantity - self.quantity;
                self.side = trade_side;
                self.quantity = remaining;
                self.entry_price = trade_price;
            } else {
                // Reduce position
                self.quantity -= trade_quantity;
            }
        }
        self.updated_at = Utc::now().timestamp_millis();
    }

    /// Update mark price and calculate unrealized P&L
    pub fn update_mark_price(&mut self, mark_price: f64) {
        self.mark_price = mark_price;
        self.unrealized_pnl = match self.side {
            PositionSide::Long => (mark_price - self.entry_price) * self.quantity,
            PositionSide::Short => (self.entry_price - mark_price) * self.quantity,
            PositionSide::Both => 0.0,
        };
        self.updated_at = Utc::now().timestamp_millis();
    }

    /// Check if position is liquidatable
    pub fn is_liquidatable(&self) -> bool {
        let margin_ratio = self.position_margin / self.maintenance_margin;
        margin_ratio <= 1.0
    }

    /// Calculate margin ratio
    pub fn margin_ratio(&self) -> f64 {
        if self.maintenance_margin > 0.0 {
            self.position_margin / self.maintenance_margin
        } else {
            f64::MAX
        }
    }
}

/// Open interest data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenInterest {
    pub symbol: String,
    pub long_oi: f64,
    pub short_oi: f64,
    pub total_oi: f64,
    pub timestamp: i64,
}

/// Long/Short ratio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongShortRatio {
    pub symbol: String,
    pub long_ratio: f64,
    pub short_ratio: f64,
    pub timestamp: i64,
}

/// Liquidation event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationEvent {
    pub id: String,
    pub symbol: String,
    pub user_id: String,
    pub side: PositionSide,
    pub price: f64,
    pub quantity: f64,
    pub remaining_margin: f64,
    pub timestamp: i64,
}

// ============================================================================
// OPTIONS TYPES
// ============================================================================

/// Option type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptionType {
    Call,
    Put,
}

/// Option style
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptionStyle {
    American,
    European,
}

/// Option position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub underlying: String,
    pub option_type: OptionType,
    pub style: OptionStyle,
    pub strike_price: f64,
    pub expiry_time: i64,
    pub quantity: f64,
    pub entry_price: f64,
    pub margin_used: f64,
    pub realized_pnl: f64,
    pub opened_at: i64,
}

impl OptionPosition {
    pub fn new(
        user_id: &str,
        underlying: &str,
        option_type: OptionType,
        style: OptionStyle,
        strike_price: f64,
        expiry_time: i64,
        quantity: f64,
        entry_price: f64,
    ) -> Self {
        let margin_required = entry_price * quantity * 0.1; // 10% margin requirement
        
        Self {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            symbol: format!("{}_{}_{}_{}", underlying, 
                match option_type { OptionType::Call => "C", OptionType::Put => "P" },
                strike_price as i64,
                expiry_time),
            underlying: underlying.to_string(),
            option_type,
            style,
            strike_price,
            expiry_time,
            quantity,
            entry_price,
            margin_used: margin_required,
            realized_pnl: 0.0,
            opened_at: Utc::now().timestamp_millis(),
        }
    }

    /// Calculate intrinsic value
    pub fn intrinsic_value(&self, underlying_price: f64) -> f64 {
        match self.option_type {
            OptionType::Call => (underlying_price - self.strike_price).max(0.0) * self.quantity,
            OptionType::Put => (self.strike_price - underlying_price).max(0.0) * self.quantity,
        }
    }

    /// Check if option is in the money
    pub fn is_itm(&self, underlying_price: f64) -> bool {
        self.intrinsic_value(underlying_price) > 0.0
    }
}

/// Option Greeks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Greeks {
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64,
    pub vega: f64,
    pub rho: f64,
}

impl Greeks {
    /// Calculate Black-Scholes Greeks
    pub fn black_scholes(
        spot: f64,
        strike: f64,
        time_to_expiry: f64,
        risk_free_rate: f64,
        volatility: f64,
        option_type: OptionType,
    ) -> Self {
        // Simplified Black-Scholes calculation
        let sqrt_t = time_to_expiry.sqrt();
        let d1 = (spot.ln() + (risk_free_rate + volatility * volatility / 2.0) * time_to_expiry) 
            / (volatility * sqrt_t);
        let d2 = d1 - volatility * sqrt_t;
        
        let (delta, rho) = match option_type {
            OptionType::Call => {
                let nd1 = normal_cdf(d1);
                let drho = time_to_expiry * strike * (-risk_free_rate * time_to_expiry).exp() 
                    * normal_cdf(d2);
                (nd1, drho)
            }
            OptionType::Put => {
                let nd1 = normal_cdf(d1) - 1.0;
                let drho = -time_to_expiry * strike * (-risk_free_rate * time_to_expiry).exp() 
                    * normal_cdf(-d2);
                (nd1, drho)
            }
        };
        
        let gamma = normal_pdf(d1) / (spot * volatility * sqrt_t);
        let vega = spot * normal_pdf(d1) * sqrt_t / 100.0;
        let theta = match option_type {
            OptionType::Call => (-spot * normal_pdf(d1) * volatility / (2.0 * sqrt_t) 
                - risk_free_rate * strike * (-risk_free_rate * time_to_expiry).exp() * normal_cdf(d2)) 
                / 365.0,
            OptionType::Put => (-spot * normal_pdf(d1) * volatility / (2.0 * sqrt_t) 
                + risk_free_rate * strike * (-risk_free_rate * time_to_expiry).exp() * normal_cdf(-d2)) 
                / 365.0,
        };
        
        Self { delta, gamma, theta, vega, rho }
    }
}

fn normal_cdf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;
    
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs() / 2.0_f64.sqrt();
    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();
    
    0.5 * (1.0 + sign * y)
}

fn normal_pdf(x: f64) -> f64 {
    (-x * x / 2.0).exp() / (2.0 * std::f64::consts::PI).sqrt()
}

// ============================================================================
// DERIVATIVES ENGINE
// ============================================================================

/// Complete derivatives trading engine
pub struct DerivativesEngine {
    positions: HashMap<String, FuturesPosition>,
    option_positions: HashMap<String, OptionPosition>,
    funding_rates: HashMap<String, FundingRate>,
    open_interest: HashMap<String, OpenInterest>,
    long_short_ratios: HashMap<String, LongShortRatio>,
    liquidation_queue: Vec<LiquidationEvent>,
}

impl DerivativesEngine {
    pub fn new() -> Self {
        Self {
            positions: HashMap::new(),
            option_positions: HashMap::new(),
            funding_rates: HashMap::new(),
            open_interest: HashMap::new(),
            long_short_ratios: HashMap::new(),
            liquidation_queue: Vec::new(),
        }
    }

    /// Open a futures position
    pub fn open_position(&mut self, position: FuturesPosition) -> String {
        let id = position.id.clone();
        self.positions.insert(id.clone(), position);
        id
    }

    /// Close a futures position
    pub fn close_position(&mut self, position_id: &str, close_price: f64) -> Option<FuturesPosition> {
        if let Some(mut position) = self.positions.remove(position_id) {
            // Calculate final P&L
            position.update_mark_price(close_price);
            position.realized_pnl += position.unrealized_pnl;
            position.unrealized_pnl = 0.0;
            position.quantity = 0.0;
            Some(position)
        } else {
            None
        }
    }

    /// Update all positions with new mark prices
    pub fn update_mark_prices(&mut self, prices: &HashMap<String, f64>) {
        for (symbol, price) in prices {
            for position in self.positions.values_mut() {
                if position.symbol == *symbol {
                    position.update_mark_price(*price);
                    
                    // Check liquidation
                    if position.is_liquidatable() {
                        self.liquidation_queue.push(LiquidationEvent {
                            id: Uuid::new_v4().to_string(),
                            symbol: position.symbol.clone(),
                            user_id: position.user_id.clone(),
                            side: position.side,
                            price: *price,
                            quantity: position.quantity,
                            remaining_margin: position.position_margin,
                            timestamp: Utc::now().timestamp_millis(),
                        });
                    }
                }
            }
        }
    }

    /// Get next liquidation event
    pub fn next_liquidation(&mut self) -> Option<LiquidationEvent> {
        self.liquidation_queue.pop()
    }

    /// Update funding rate for a symbol
    pub fn update_funding_rate(&mut self, symbol: &str, rate: f64, next_time: i64) {
        self.funding_rates.insert(symbol.to_string(), FundingRate {
            symbol: symbol.to_string(),
            funding_rate: rate,
            next_funding_time: next_time,
            predicted_rate: rate,
        });
    }

    /// Calculate funding payment
    pub fn calculate_funding(&self, position: &FuturesPosition) -> f64 {
        if let Some(funding) = self.funding_rates.get(&position.symbol) {
            match position.side {
                PositionSide::Long => position.quantity * position.mark_price * funding.funding_rate,
                PositionSide::Short => -position.quantity * position.mark_price * funding.funding_rate,
                PositionSide::Both => 0.0,
            }
        } else {
            0.0
        }
    }

    /// Update open interest
    pub fn update_open_interest(&mut self, symbol: &str, long: f64, short: f64) {
        self.open_interest.insert(symbol.to_string(), OpenInterest {
            symbol: symbol.to_string(),
            long_oi: long,
            short_oi: short,
            total_oi: long + short,
            timestamp: Utc::now().timestamp_millis(),
        });
    }

    /// Get long/short ratio
    pub fn get_long_short_ratio(&self, symbol: &str) -> Option<&LongShortRatio> {
        self.long_short_ratios.get(symbol)
    }

    /// Open option position
    pub fn open_option(&mut self, position: OptionPosition) -> String {
        let id = position.id.clone();
        self.option_positions.insert(id.clone(), position);
        id
    }

    /// Calculate portfolio Greeks
    pub fn calculate_portfolio_greeks(&self, underlying_price: f64) -> Greeks {
        let mut total_delta = 0.0;
        let mut total_gamma = 0.0;
        let mut total_theta = 0.0;
        let mut total_vega = 0.0;
        let mut total_rho = 0.0;
        
        for pos in self.option_positions.values() {
            let time_to_expiry = (pos.expiry_time - Utc::now().timestamp_millis()) as f64 / (365.0 * 24.0 * 3600.0 * 1000.0);
            let greeks = Greeks::black_scholes(
                underlying_price,
                pos.strike_price,
                time_to_expiry,
                0.05, // 5% risk-free rate
                0.3,  // 30% volatility
                pos.option_type,
            );
            
            total_delta += greeks.delta * pos.quantity;
            total_gamma += greeks.gamma * pos.quantity;
            total_theta += greeks.theta * pos.quantity;
            total_vega += greeks.vega * pos.quantity;
            total_rho += greeks.rho * pos.quantity;
        }
        
        Greeks {
            delta: total_delta,
            gamma: total_gamma,
            theta: total_theta,
            vega: total_vega,
            rho: total_rho,
        }
    }
}

// ============================================================================
// LEVERAGED TOKENS
// ============================================================================

/// Leveraged token position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeveragedToken {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub underlying: String,
    pub leverage: i32, // e.g., 3 for 3x
    pub nav: f64,
    pub nav_change_24h: f64,
    pub total_supply: f64,
    pub rebalance_count: u32,
    pub last_rebalance: i64,
}

impl LeveragedToken {
    pub fn new(name: &str, symbol: &str, underlying: &str, leverage: i32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            symbol: symbol.to_string(),
            underlying: underlying.to_string(),
            leverage,
            nav: 1.0,
            nav_change_24h: 0.0,
            total_supply: 0.0,
            rebalance_count: 0,
            last_rebalance: Utc::now().timestamp_millis(),
        }
    }

    /// Rebalance token based on underlying price change
    pub fn rebalance(&mut self, price_change: f64) {
        // Calculate new NAV based on leverage
        let leveraged_change = price_change * (self.leverage as f64);
        self.nav *= 1.0 + leveraged_change;
        self.nav_change_24h = leveraged_change;
        self.rebalance_count += 1;
        self.last_rebalance = Utc::now().timestamp_millis();
    }
}

// ============================================================================
// HEDGE MODE
// ============================================================================

/// Hedge mode settings for user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HedgeModeSettings {
    pub user_id: String,
    pub enabled: bool,
    pub mode: HedgeMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HedgeMode {
    /// One-way mode (default)
    OneWay,
    /// Hedge mode (can hold both long and short)
    Hedge,
}

// ============================================================================
// PARTIAL LIQUIDATION
// ============================================================================

/// Partial liquidation handler
pub struct PartialLiquidation {
    pub partial_ratio: f64, // 0.25 for 25%
    pub max_leverage: u32,
}

impl PartialLiquidation {
    pub fn new() -> Self {
        Self {
            partial_ratio: 0.25,
            max_leverage: 125,
        }
    }

    /// Calculate liquidation amount
    pub fn calculate_liquidation_amount(&self, position: &FuturesPosition) -> f64 {
        let margin_ratio = position.margin_ratio();
        
        if margin_ratio <= 0.5 {
            // Full liquidation
            position.quantity
        } else if margin_ratio <= 0.8 {
            // Partial liquidation
            position.quantity * self.partial_ratio
        } else {
            0.0 // No liquidation needed
        }
    }
}

pub use self::{
    DerivativesEngine, FundingRate, FuturesPosition, FuturesType, Greeks,
    HedgeMode, HedgeModeSettings, LeveragedToken, LiquidationEvent, LongShortRatio,
    OpenInterest, OptionPosition, OptionStyle, OptionType, PartialLiquidation,
    PositionSide,
};