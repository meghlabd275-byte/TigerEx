//! TigerEx Liquidation Engine - Rust Implementation
//! 
//! High-performance liquidation engine for futures and margin trading
//! Auto-liquidation, ADL, and bankruptcy protection
//! 
//! Migration from Go to Rust for deterministic execution

use std::collections::HashMap;

/// Liquidation status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiquidationStatus {
    Healthy,
    AtRisk,
    Liquidating,
    Liquidated,
    Bankrupt,
}

/// Position side for liquidation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionSide {
    Long,
    Short,
}

/// Liquidation type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiquidationType {
    MarginCall,
    AutoLiquidate,
    PartialLiquidation,
    Bankruptcy,
    ADL, // Auto-Deleveraging
}

/// Liquidation event
#[derive(Debug, Clone)]
pub struct LiquidationEvent {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub position_side: PositionSide,
    pub liquidation_type: LiquidationType,
    pub quantity: u64,
    pub liquidation_price: u64,
    pub mark_price: u64,
    pub realized_pnl: i64,
    pub remaining_margin: u64,
    pub timestamp_ms: u64,
}

/// Position with liquidation tracking
#[derive(Debug, Clone)]
pub struct LiquidatablePosition {
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: u64,
    pub entry_price: u64,
    pub mark_price: u64,
    pub leverage: u32,
    pub margin: u64,
    pub margin_ratio: f64,
    pub liquidation_price: u64,
    pub status: LiquidationStatus,
}

/// Liquidation engine configuration
#[derive(Debug, Clone)]
pub struct LiquidationConfig {
    pub maintenance_margin_rate: f64,  // 0.5% default
    pub partial_liquidation_percent: f64, // 25% default
    pub max_leverage: u32,
    pub bankruptcy_price_offset: f64, // Extra buffer for bankruptcy
    pub auto_delever_enabled: bool,
    pub partial_liquidation_enabled: bool,
    pub max_liquidations_per_block: u32,
}

impl Default for LiquidationConfig {
    fn default() -> Self {
        Self {
            maintenance_margin_rate: 0.005,
            partial_liquidation_percent: 0.25,
            max_leverage: 125,
            bankruptcy_price_offset: 0.001,
            auto_delever_enabled: true,
            partial_liquidation_enabled: true,
            max_liquidations_per_block: 100,
        }
    }
}

impl LiquidationConfig {
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Calculate liquidation price for long position
    pub fn calc_liquidation_long(&self, entry_price: u64, leverage: u32) -> u64 {
        let maintenance = self.maintenance_margin_rate;
        let ratio = (1.0 - (1.0 / leverage as f64) + maintenance) * (entry_price as f64);
        ratio as u64
    }
    
    /// Calculate liquidation price for short position
    pub fn calc_liquidation_short(&self, entry_price: u64, leverage: u32) -> u64 {
        let maintenance = self.maintenance_margin_rate;
        let ratio = (1.0 + (1.0 / leverage as f64) - maintenance) * (entry_price as f64);
        ratio as u64
    }
    
    /// Calculate bankruptcy price
    pub fn calc_bankruptcy_price(&self, entry_price: u64, leverage: u32, side: PositionSide) -> u64 {
        let offset = self.bankruptcy_price_offset;
        match side {
            PositionSide::Long => {
                let price = entry_price as f64 * (1.0 - (1.0 / leverage as f64) - offset);
                price as u64
            }
            PositionSide::Short => {
                let price = entry_price as f64 * (1.0 + (1.0 / leverage as f64) + offset);
                price as u64
            }
        }
    }
}

/// Main Liquidation Engine
pub struct LiquidationEngine {
    config: LiquidationConfig,
    positions: HashMap<String, LiquidatablePosition>, // user_id + symbol -> position
    liquidation_queue: Vec<LiquidatablePosition>,
    events: Vec<LiquidationEvent>,
    order_id_counter: u64,
    enabled: bool,
}

impl Default for LiquidationEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl LiquidationEngine {
    pub fn new() -> Self {
        LiquidationEngine {
            config: LiquidationConfig::new(),
            positions: HashMap::new(),
            liquidation_queue: Vec::new(),
            events: Vec::new(),
            order_id_counter: 0,
            enabled: true,
        }
    }
    
    pub fn with_config(config: LiquidationConfig) -> Self {
        LiquidationEngine {
            config,
            positions: HashMap::new(),
            liquidation_queue: Vec::new(),
            events: Vec::new(),
            order_id_counter: 0,
            enabled: true,
        }
    }
    
    /// Enable/disable liquidation engine
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    /// Get position key
    fn position_key(user_id: &str, symbol: &str) -> String {
        format!("{}:{}", user_id, symbol)
    }
    
    /// Update or create position
    pub fn update_position(
        &mut self,
        user_id: String,
        symbol: String,
        side: PositionSide,
        quantity: u64,
        entry_price: u64,
        mark_price: u64,
        leverage: u32,
        margin: u64,
    ) {
        let key = Self::position_key(&user_id, &symbol);
        
        let margin_ratio = if quantity > 0 && entry_price > 0 {
            let position_value = (entry_price as f64 * quantity as f64) / leverage as f64;
            margin as f64 / position_value
        } else {
            0.0
        };
        
        let liquidation_price = match side {
            PositionSide::Long => self.config.calc_liquidation_long(entry_price, leverage),
            PositionSide::Short => self.config.calc_liquidation_short(entry_price, leverage),
        };
        
        let status = self.calculate_status(mark_price, liquidation_price, margin_ratio);
        
        let position = LiquidatablePosition {
            user_id: user_id.clone(),
            symbol: symbol.clone(),
            side,
            quantity,
            entry_price,
            mark_price,
            leverage,
            margin,
            margin_ratio,
            liquidation_price,
            status,
        };
        
        self.positions.insert(key, position);
        
        // Add to queue if at risk
        if status == LiquidationStatus::AtRisk || status == LiquidationStatus::Liquidating {
            self.add_to_queue(position);
        }
    }
    
    /// Calculate position status
    fn calculate_status(&self, mark_price: u64, liquidation_price: u64, margin_ratio: f64) -> LiquidationStatus {
        // Check margin ratio first
        if margin_ratio < self.config.maintenance_margin_rate as f64 * 0.5 {
            return LiquidationStatus::Liquidating;
        }
        
        // Check price relative to liquidation
        let buffer = (liquidation_price as f64 * 0.1) as u64; // 10% buffer
        if mark_price <= liquidation_price.wrapping_add(buffer) {
            return LiquidationStatus::AtRisk;
        }
        
        LiquidationStatus::Healthy
    }
    
    /// Add position to liquidation queue
    fn add_to_queue(&mut self, position: LiquidatablePosition) {
        // Avoid duplicates
        if !self.liquidation_queue.iter().any(|p| p.user_id == position.user_id && p.symbol == position.symbol) {
            self.liquidation_queue.push(position);
        }
    }
    
    /// Process liquidations for a symbol
    pub fn process_liquidations(&mut self, symbol: &str, mark_price: u64) -> Vec<LiquidationEvent> {
        let mut events = Vec::new();
        
        // Filter positions for this symbol
        let positions_to_liquidate: Vec<LiquidatablePosition> = self.liquidation_queue
            .iter()
            .filter(|p| p.symbol == symbol && p.status == LiquidationStatus::Liquidating)
            .cloned()
            .collect();
        
        for position in positions_to_liquidate {
            if events.len() >= self.config.max_liquidations_per_block as usize {
                break;
            }
            
            let event = self.liquidate_position(&position, mark_price);
            events.push(event);
        }
        
        events
    }
    
    /// Liquidate a single position
    fn liquidate_position(&mut self, position: &LiquidatablePosition, mark_price: u64) -> LiquidationEvent {
        self.order_id_counter += 1;
        
        let liquidation_type = if position.margin_ratio < self.config.maintenance_margin_rate {
            LiquidationType::Bankruptcy
        } else if self.config.partial_liquidation_enabled {
            LiquidationType::PartialLiquidation
        } else {
            LiquidationType::AutoLiquidate
        };
        
        // Calculate quantities
        let liquidate_qty = match liquidation_type {
            LiquidationType::PartialLiquidation => {
                (position.quantity as f64 * self.config.partial_liquidation_percent) as u64
            }
            _ => position.quantity,
        };
        
        let remaining_qty = position.quantity - liquidate_qty;
        let remaining_margin = (position.margin as f64 * (1.0 - self.config.partial_liquidation_percent)) as u64;
        
        // Calculate PnL
        let realized_pnl: i64 = match position.side {
            PositionSide::Long => {
                (mark_price as i64 - position.entry_price as i64) * liquidate_qty as i64
            }
            PositionSide::Short => {
                (position.entry_price as i64 - mark_price as i64) * liquidate_qty as i64
            }
        };
        
        let event = LiquidationEvent {
            id: format!("LIQ-{}", self.order_id_counter),
            user_id: position.user_id.clone(),
            symbol: position.symbol.clone(),
            position_side: position.side,
            liquidation_type,
            quantity: liquidate_qty,
            liquidation_price: position.liquidation_price,
            mark_price,
            realized_pnl,
            remaining_margin,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };
        
        // Update position or remove
        if remaining_qty > 0 {
            let key = Self::position_key(&position.user_id, &position.symbol);
            if let Some(pos) = self.positions.get_mut(&key) {
                pos.quantity = remaining_qty;
                pos.margin = remaining_margin;
                pos.status = LiquidationStatus::Healthy;
            }
        } else {
            let key = Self::position_key(&position.user_id, &position.symbol);
            self.positions.remove(&key);
        }
        
        // Remove from queue
        self.liquidation_queue.retain(|p| {
            !(p.user_id == position.user_id && p.symbol == position.symbol)
        });
        
        self.events.push(event.clone());
        event
    }
    
    /// Check if position needs liquidation
    pub fn check_liquidation(&self, user_id: &str, symbol: &str) -> Option<LiquidationStatus> {
        let key = Self::position_key(user_id, symbol);
        self.positions.get(&key).map(|p| p.status)
    }
    
    /// Get all positions at risk
    pub fn get_at_risk_positions(&self) -> Vec<&LiquidatablePosition> {
        self.positions
            .values()
            .filter(|p| p.status != LiquidationStatus::Healthy)
            .collect()
    }
    
    /// Get liquidation events
    pub fn get_events(&self) -> &Vec<LiquidationEvent> {
        &self.events
    }
    
    /// Get queue size
    pub fn queue_size(&self) -> usize {
        self.liquidation_queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_liquidation_price_calculation() {
        let config = LiquidationConfig::new();
        
        // Test long liquidation
        let liq_price = config.calc_liquidation_long(50000, 10);
        println!("Long liquidation at 10x: {}", liq_price);
        
        // Test short liquidation
        let liq_price = config.calc_liquidation_short(50000, 10);
        println!("Short liquidation at 10x: {}", liq_price);
    }
    
    #[test]
    fn test_position_tracking() {
        let mut engine = LiquidationEngine::new();
        
        // Update position
        engine.update_position(
            "user1".to_string(),
            "BTC/USDT".to_string(),
            PositionSide::Long,
            1000,
            50000,
            48000, // Near liquidation
            10,
            5000,
        );
        
        // Check status
        let status = engine.check_liquidation("user1", "BTC/USDT");
        println!("Status: {:?}", status);
    }
}