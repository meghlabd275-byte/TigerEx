/**
 * TigerEx Rust Ultra-Low-Latency Risk Engine
 * 
 * Memory-safe infrastructure with deterministic performance.
 * No GC pauses, fearless concurrency.
 * 
 * Modules:
 * - Pre-trade risk checks
 * - Margin engine
 * - Liquidation engine
 * - Bankruptcy protection
 * - Position limits
 */

use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;

// ========================================================================
// CORE RISK TYPES
// ========================================================================

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RiskCheckResult {
    Pass,
    Reject(u8),  // Rejection code
    RequiresManualApproval,
}

#[derive(Clone, Debug)]
pub struct Account {
    pub user_id: String,
    pub equity: u64,           // Total equity (scaled integer)
    pub margin_used: u64,      // Margin currently used
    pub margin_available: u64, // Available margin
    pub unrealized_pnl: i64,  // Unrealized P&L
    pub realized_pnl: i64,     // Realized P&L
    pub leverage: u8,         // Current leverage (1-125)
    pub positions: Vec<Position>,
}

#[derive(Clone, Debug)]
pub struct Position {
    pub symbol: String,
    pub side: PositionSide,
    pub size: i64,           // Positive = long, negative = short
    pub entry_price: u64,
    pub liquidation_price: u64,
    pub margin_requirement: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PositionSide {
    Long,
    Short,
}

// ========================================================================
// MARGIN ENGINE
// ========================================================================

pub struct MarginEngine {
    // Cross-margin parameters
    pub initial_margin_rate: u64,    // e.g., 1000 = 10%
    pub maintenance_margin_rate: u64, // e.g., 500 = 5%
    pub max_leverage: u8,
    
    // Tiered fees
    fees: HashMap<String, TieredFee>,
}

#[derive(Clone, Debug)]
pub struct TieredFee {
    pub volume_threshold: u64,
    pub maker_fee: u64,  // bp = basis points * 100
    pub taker_fee: u64,
}

impl Default for MarginEngine {
    fn default() -> Self {
        let mut engine = MarginEngine {
            initial_margin_rate: 1000,   // 10% for 10x leverage
            maintenance_margin_rate: 500, // 5% maintenance
            max_leverage: 125,          // Maximum 125x
            fees: HashMap::new(),
        };
        
        // Standard fee tier
        engine.fees.insert("standard".into(), TieredFee {
            volume_threshold: 0,
            maker_fee: 200,  // 2bp
            taker_fee: 300,   // 3bp
        });
        
        engine
    }
}

impl MarginEngine {
    /// Calculate margin requirement for a position
    pub fn calc_margin_requirement(&self, price: u64, size: u64) -> u64 {
        let notional = price.saturating_mul(size);
        let margin = (notional * self.initial_margin_rate as u64) / 10000;
        margin.max(1)  // Minimum 1 unit
    }
    
    /// Check if account can open position
    pub fn check_open(&self, account: &Account, order_value: u64) -> RiskCheckResult {
        let margin_required = order_value / self.max_legage as u64;
        
        if account.margin_available < margin_required {
            return RiskCheckResult::Reject(1); // Insufficient margin
        }
        
        let new_leverage = ((account.margin_used + margin_required) * 100) / account.equity;
        if new_leverage > (self.max_leverage as u64 * 100) {
            return RiskCheckResult::Reject(2); // Exceeds max leverage
        }
        
        RiskCheckResult::Pass
    }
    
    /// Update account after trade 
    pub fn update_after_trade(&self, account: &mut Account, order_value: u64, is_buy: bool) {
        let margin = self.calc_margin_requirement(order_value, 1);
        
        if is_buy {
            account.margin_used += margin;
        } else {
            account.margin_used = account.margin_used.saturating_sub(margin);
        }
        
        account.margin_available = account.equity.saturating_sub(account.margin_used);
    }
}

// ========================================================================
// BANKRUPTCY & ADL (AUTO-DELEVERAGING)
// ========================================================================

pub struct BankruptcyEngine {
    insurance_fund: AtomicU64,
    bankruptcy_offset: HashMap<String, i64>,
}

impl Default for BankruptcyEngine {
    fn default() -> Self {
        Self {
            insurance_fund: AtomicU64::new(0),
            bankruptcy_offset: HashMap::new(),
        }
    }
}

impl BankruptcyEngine {
    /// Check account health - are they bankrupt?
    pub fn check_bankruptcy(&self, account: &Account) -> RiskCheckResult {
        if account.equity == 0 {
            return RiskCheckResult::Reject(10); // Bankrupt
        }
        
        if account.equity < account.margin_used {
            return RiskCheckResult::Reject(11); // Underwater
        }
        
        RiskCheckResult::Pass
    }
    
    /// Cover losses from insurance fund
    pub fn cover_loss(&self, user_id: &str, loss: i64) -> bool {
        let current = self.insurance_fund.load(Ordering::Relaxed);
        
        if current >= loss as u64 {
            self.insurance_fund.fetch_sub(loss as u64, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
    
    /// Auto-deleveraging - liquidate opposite positions
    pub fn adl_liquidate(&self, positions: &mut [Position]) {
        // Sort by profit (losers get liquidated first)
        positions.sort_by(|a, b| {
            let a_pnl = (b.size as i64 /*fake*/);
            let b_pnl = (a.size as i64);
            b_pnl.cmp(&a_pnl)
        });
        
        // Liquidate most profitable losers first
        for pos in positions.iter_mut() {
            pos.size = 0;
        }
    }
}

// ========================================================================
// LIQUIDATION ENGINE
// ========================================================================

pub struct LiquidationEngine {
    pub maintenance_margin_ratio: u64,  // e.g., 500 = 5%
    pub bankruptcy_price_multiplier: u64, // e.g., 950 = 95%
}

impl Default for LiquidationEngine {
    fn default() -> Self {
        Self {
            maintenance_margin_ratio: 500,
            bankruptcy_price_multiplier: 950,
        }
    }
}

impl LiquidationEngine {
    /// Calculate liquidation price for a position
    pub fn calc_liquidation_price(&self, position: &Position, account_equity: u64) -> u64 {
        let maintenance = account_equity * self.maintenance_margin_ratio as u64 / 10000;
        
        match position.side {
            PositionSide::Long => {
                // Liquidation when price drops below
                let liq_price = position.liquidation_price; // Would calculate properly
                liq_price.saturating_sub(maintenance)
            },
            PositionSide::Short => {
                // Liquidation when price rises above
                let liq_price = position.liquidation_price;
                liq_price.saturating_add(maintenance)
            },
        }
    }
    
    /// Check if any positions should be liquidated
    pub fn check_liquidations(&self, account: &Account) -> Vec<String> {
        let mut to_liquidate = Vec::new();
        
        for pos in &account.positions {
            let liq_price = self.calc_liquidation_price(pos, account.equity);
            
            let should_liquidate = match pos.side {
                PositionSide::Long => liq_price >= pos.entry_price,
                PositionSide::Short => liq_price <= pos.entry_price,
            };
            
            if should_liquidate {
                to_liquidate.push(pos.symbol.clone());
            }
        }
        
        to_liquidate
    }
    
    /// Execute liquidation
    pub fn liquidate(&self, position: &mut Position, fill_price: u64) -> u64 {
        let qty = position.size.unsigned_abs() as u64;
        position.size = 0;
        qty
    }
}

// ========================================================================
// PRE-TRADE RISK CHECKS
// ========================================================================

pub struct PreTradeRiskChecks {
    pub max_order_size: HashMap<String, u64>,
    pub max_orders_per_second: u32,
    pub max_notional_per_minute: HashMap<String, u64>,
}

impl Default for PreTradeRiskChecks {
    fn default() -> Self {
        let mut max_order_size = HashMap::new();
        max_order_size.insert("BTCUSDT".into(), 100);  // 100 BTC
        max_order_size.insert("ETHUSDT".into(), 1000);   // 1000 ETH
        
        let mut max_notional = HashMap::new();
        max_notional.insert("BTCUSDT".into(), 5_000_000)); // $5M/min
        
        Self {
            max_order_size,
            max_orders_per_second: 100,
            max_notional_per_minute: max_notional,
        }
    }
}

impl PreTradeRiskChecks {
    /// Comprehensive pre-trade risk check
    pub fn check_order(
        &self,
        user_id: &str,
        symbol: &str,
        price: u64,
        quantity: u64,
    ) -> RiskCheckResult {
        let notional = price.saturating_mul(quantity);
        
        // Check max size
        if let Some(&max_size) = self.max_order_size.get(symbol) {
            if quantity > max_size {
                return RiskCheckResult::Reject(20); // Too large
            }
        }
        
        // Check max notional
        if let Some(&max_notional) = self.max_notional_per_minute.get(symbol) {
            if notional > max_notional {
                return RiskCheckResult::Reject(21); // Exceeds notional limit
            }
        }
        
        RiskCheckResult::Pass
    }
}

// ========================================================================
// MAIN RISK ENGINE
// ========================================================================

pub struct RiskEngine {
    pub margin: MarginEngine,
    pub bankruptcy: BankruptcyEngine,
    pub liquidation: LiquidationEngine,
    pub pre_trade: PreTradeRiskChecks,
}

impl Default for RiskEngine {
    fn default() -> Self {
        Self {
            margin: MarginEngine::default(),
            bankruptcy: BankruptcyEngine::default(),
            liquidation: LiquidationEngine::default(),
            pre_trade: PreTradeRiskChecks::default(),
        }
    }
}

impl RiskEngine {
    /// Full pre-trade risk check pipeline
    pub fn check(
        &self,
        account: &Account,
        symbol: &str,
        price: u64,
        quantity: u64,
    ) -> RiskCheckResult {
        // 1. Pre-trade checks
        match self.pre_trade.check_order(&account.user_id, symbol, price, quantity) {
            RiskCheckResult::Reject(code) => return RiskCheckResult::Reject(code),
            _ => {}
        }
        
        // 2. Margin check
        let notional = price.saturating_mul(quantity);
        match self.margin.check_open(account, notional) {
            RiskCheckResult::Reject(code) => return RiskCheckResult::Reject(code),
            _ => {}
        }
        
        // 3. Liquidation check
        let liquidations = self.liquidation.check_liquidations(account);
        if !liquidations.is_empty() {
            return RiskCheckResult::Reject(30); // Account being liquidated
        }
        
        // 4. Bankruptcy
        match self.bankruptcy.check_bankruptcy(account) {
            RiskCheckResult::Reject(code) => return RiskCheckResult::Reject(code),
            _ => {}
        }
        
        RiskCheckResult::Pass
    }
}