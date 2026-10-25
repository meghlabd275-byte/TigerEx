//! TigerEx Liquidation Engine - Risk Management in Rust
//! CRITICAL: Handles position liquidations to prevent losses
//! WHY RUST: Deterministic, no GC pauses during liquidation

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Position side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PositionSide {
    Long,
    Short,
}

/// Position status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PositionStatus {
    Open,
    Liquidating,
    Liquidated,
    Closed,
}

/// Position - leveraged trading position
#[derive(Debug, Clone)]
pub struct Position {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub entry_price: f64,
    pub quantity: f64,
    pub leverage: u32,
    pub margin: f64,
    pub liquidation_price: f64,
    pub status: PositionStatus,
    pub opened_at: u64,
    pub updated_at: u64,
    pub unrealized_pnl: f64,
}

impl Position {
    pub fn new(
        id: String,
        user_id: String,
        symbol: String,
        side: PositionSide,
        entry_price: f64,
        quantity: f64,
        leverage: u32,
    ) -> Self {
        let margin = entry_price * quantity / leverage as f64;
        let liquidation_price = Self::calculate_liquidation(entry_price, leverage, side);
        
        Self {
            id,
            user_id,
            symbol,
            side,
            entry_price,
            quantity,
            leverage,
            margin,
            liquidation_price,
            status: PositionStatus::Open,
            opened_at: current_timestamp(),
            updated_at: current_timestamp(),
            unrealized_pnl: 0.0,
        }
    }

    /// Calculate liquidation price
    pub fn calculate_liquidation(entry_price: f64, leverage: u32, side: PositionSide) -> f64 {
        let margin_ratio = 1.0 / leverage as f64; // e.g., 0.01 for 100x
        
        // Maintenance margin ratio (typically 0.5%)
        let maintenance_margin = 0.005;
        
        // Liquidation distance = margin / quantity adjusted
        let liq_distance = entry_price * margin_ratio / (1.0 - maintenance_margin);
        
        match side {
            PositionSide::Long => entry_price - liq_distance,
            PositionSide::Short => entry_price + liq_distance,
        }
    }

    /// Check if position should be liquidated
    pub fn should_liquidate(&self, current_price: f64) -> bool {
        if self.status != PositionStatus::Open {
            return false;
        }
        
        match self.side {
            PositionSide::Long => current_price <= self.liquidation_price,
            PositionSide::Short => current_price >= self.liquidation_price,
        }
    }

    /// Update unrealized P&L
    pub fn update_pnl(&mut self, current_price: f64) {
        self.unrealized_pnl = match self.side {
            PositionSide::Long => (current_price - self.entry_price) * self.quantity,
            PositionSide::Short => (self.entry_price - current_price) * self.quantity,
        };
        self.updated_at = current_timestamp();
    }

    /// Get margin ratio
    pub fn margin_ratio(&self, current_price: f64) -> f64 {
        let equity = self.margin + self.unrealized_pnl;
        (equity / (current_price * self.quantity)).abs()
    }

    /// Get profit status
    pub fn is_profitable(&self) -> bool {
        self.unrealized_pnl > 0.0
    }
}

/// Liquidation event
#[derive(Debug, Clone)]
pub struct LiquidationEvent {
    pub id: String,
    pub position_id: String,
    pub user_id: String,
    pub symbol: String,
    pub liquidation_price: f64,
    pub settlement_price: f64,
    pub remaining_margin: f64,
    pub realized_loss: f64,
    pub status: LiquidationStatus,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LiquidationStatus {
    Pending,
    Executing,
    Completed,
    Failed,
}

/// LiquidationEngine - manages risk and liquidations
pub struct LiquidationEngine {
    positions: RwLock<HashMap<String, Position>>,
    user_positions: RwLock<HashMap<String, Vec<String>>>,
    liquidations: RwLock<HashMap<String, LiquidationEvent>>,
    // Configuration
    maintenance_margin_ratio: f64,
    margin_call_ratio: f64,
}

impl LiquidationEngine {
    pub fn new() -> Self {
        Self {
            positions: RwLock::new(HashMap::new()),
            user_positions: RwLock::new(HashMap::new()),
            liquidations: RwLock::new(HashMap::new()),
            maintenance_margin_ratio: 0.005, // 0.5%
            margin_call_ratio: 0.01,          // 1%
        }
    }

    /// Open position
    pub fn open_position(&self, position: Position) -> Result<(), String> {
        // Validate leverage
        if position.leverage > 125 {
            return Err("Maximum leverage is 125x".to_string());
        }
        
        if position.leverage < 1 {
            return Err("Minimum leverage is 1x".to_string());
        }

        // A NaN entry price or quantity makes min_margin NaN, and NaN < 10.0
        // is false, so the margin check below would pass.
        if !position.entry_price.is_finite() || position.entry_price <= 0.0 {
            return Err("Entry price must be finite and positive".to_string());
        }
        if !position.quantity.is_finite() || position.quantity <= 0.0 {
            return Err("Quantity must be finite and positive".to_string());
        }

        // Validate margin
        let min_margin = position.entry_price * position.quantity / position.leverage as f64;
        if min_margin < 10.0 {
            return Err("Minimum margin is $10".to_string());
        }

        let id = position.id.clone();
        let user_id = position.user_id.clone();
        
        let mut positions = self.positions.write().unwrap();
        positions.insert(id.clone(), position);

        let mut user_pos = self.user_positions.write().unwrap();
        user_pos
            .entry(user_id)
            .or_insert_with(Vec::new)
            .push(id);

        Ok(())
    }

    /// Get position
    pub fn get_position(&self, position_id: &str) -> Option<Position> {
        let positions = self.positions.read().unwrap();
        positions.get(position_id).cloned()
    }

    /// Update all positions with current prices
    pub fn update_prices(&self, symbol: &str, current_price: f64) -> Vec<LiquidationEvent> {
        // A zero, negative or NaN price would either mark every long position
        // for liquidation at once or silently stop updating P&L (NaN compares
        // false against every bound), so reject it outright.
        if !current_price.is_finite() || current_price <= 0.0 {
            return Vec::new();
        }

        let mut events = Vec::new();
        
        // Find positions to check
        let position_ids: Vec<String> = {
            let positions = self.positions.read().unwrap();
            positions
                .iter()
                .filter(|(_, p)| p.symbol == symbol && p.status == PositionStatus::Open)
                .map(|(id, _)| id.clone())
                .collect()
        };

        // Check each position
        for id in position_ids {
            let mut positions = self.positions.write().unwrap();
            
            if let Some(position) = positions.get_mut(&id) {
                position.update_pnl(current_price);
                
                if position.should_liquidate(current_price) {
                    let evt = self.execute_liquidation(
                        position,
                        current_price,
                    );
                    events.push(evt);
                }
            }
        }

        events
    }

    /// Execute liquidation internally
    fn execute_liquidation(&self, position: &mut Position, current_price: f64) -> LiquidationEvent {
        position.update_pnl(current_price);
        let equity = position.margin + position.unrealized_pnl;
        // A position liquidated in profit leaves the user with the
        // remainder; one whose equity is negative is bankrupt and the
        // shortfall is owed by the insurance fund.
        let (realized_loss, remaining_margin) = if equity > 0.0 {
            (position.margin - equity, equity)
        } else {
            (position.margin, 0.0)
        };
        
        // Update position
        position.status = PositionStatus::Liquidated;
        
        let event = LiquidationEvent {
            id: generate_id(),
            position_id: position.id.clone(),
            user_id: position.user_id.clone(),
            symbol: position.symbol.clone(),
            liquidation_price: position.liquidation_price,
            settlement_price: current_price,
            remaining_margin,
            realized_loss,
            status: LiquidationStatus::Completed,
            timestamp: current_timestamp(),
        };
        
        // Store event
        let id = event.id.clone();
        let mut liquidations = self.liquidations.write().unwrap();
        liquidations.insert(id, event.clone());
        
        event
    }

    /// Check margin call level
    pub fn check_margin_call(&self, position: &Position, current_price: f64) -> MarginCallLevel {
        let ratio = position.margin_ratio(current_price);
        
        if ratio <= self.maintenance_margin_ratio {
            MarginCallLevel::Liquidation
        } else if ratio <= self.margin_call_ratio {
            MarginCallLevel::MarginCall
        } else if ratio <= self.margin_call_ratio * 2.0 {
            MarginCallLevel::Warning
        } else {
            MarginCallLevel::Healthy
        }
    }

    /// Get liquidations for user
    pub fn get_user_liquidations(&self, user_id: &str) -> Vec<LiquidationEvent> {
        let events = self.liquidations.read().unwrap();
        events
            .values()
            .filter(|e| e.user_id == user_id)
            .cloned()
            .collect()
    }

    /// Close position
    pub fn close_position(&self, position_id: &str) -> Result<Position, String> {
        let mut positions = self.positions.write().unwrap();
        
        if let Some(position) = positions.get_mut(position_id) {
            if position.status == PositionStatus::Open {
                position.status = PositionStatus::Closed;
                Ok(position.clone())
            } else {
                Err("Position not open".to_string())
            }
        } else {
            Err("Position not found".to_string())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MarginCallLevel {
    Healthy,
    Warning,
    MarginCall,
    Liquidation,
}

impl Default for LiquidationEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("liq_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_liquidation_price() {
        let price = Position::calculate_liquidation(50000.0, 10, PositionSide::Long);
        
        assert!(price < 50000.0);
    }

    fn engine_with_long(entry: f64, qty: f64, leverage: u32) -> (LiquidationEngine, Position) {
        let engine = LiquidationEngine::new();
        let position = Position::new(
            "p1".to_string(),
            "u1".to_string(),
            "BTC/USDT".to_string(),
            PositionSide::Long,
            entry,
            qty,
            leverage,
        );
        engine.open_position(position.clone()).unwrap();
        (engine, position)
    }

    #[test]
    fn non_finite_entry_price_and_quantity_are_rejected() {
        let engine = LiquidationEngine::new();
        let mut position = Position::new(
            "p1".to_string(),
            "u1".to_string(),
            "BTC/USDT".to_string(),
            PositionSide::Long,
            50_000.0,
            1.0,
            10,
        );

        // NaN < 10.0 is false, so the old margin check accepted these.
        position.entry_price = f64::NAN;
        assert!(engine.open_position(position.clone()).is_err());

        position.entry_price = 50_000.0;
        position.quantity = f64::NAN;
        assert!(engine.open_position(position).is_err());
    }

    #[test]
    fn an_invalid_price_update_does_not_liquidate_anything() {
        let (engine, _) = engine_with_long(50_000.0, 1.0, 10);

        // The old implementation would mark every long for liquidation at a
        // zero or negative price.
        assert!(engine.update_prices("BTC/USDT", 0.0).is_empty());
        assert!(engine.update_prices("BTC/USDT", -1.0).is_empty());
        assert!(engine.update_prices("BTC/USDT", f64::NAN).is_empty());
    }

    #[test]
    fn a_price_drop_below_liquidation_triggers_a_liquidation() {
        let (engine, position) = engine_with_long(50_000.0, 1.0, 10);

        let events = engine.update_prices("BTC/USDT", position.liquidation_price - 1.0);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].position_id, "p1");
        assert_eq!(
            engine.get_position("p1").unwrap().status,
            PositionStatus::Liquidated
        );
    }

    #[test]
    fn a_profitable_liquidation_leaves_the_user_with_the_remainder() {
        let (engine, _) = engine_with_long(50_000.0, 1.0, 10);

        // Settle above entry: equity exceeds the posted margin.
        let events = engine.update_prices("BTC/USDT", 50_500.0);
        assert!(events.is_empty(), "a profitable position is not liquidated");

        // Force the liquidation path directly to check the accounting.
        let mut position = engine.get_position("p1").unwrap();
        let event = engine.execute_liquidation(&mut position, 50_500.0);

        assert!(event.realized_loss < 0.0, "the user actually gained");
        assert!(event.remaining_margin > position.margin);
    }

    #[test]
    fn a_bankrupt_liquidation_loses_the_whole_margin() {
        let (engine, _) = engine_with_long(50_000.0, 1.0, 10);

        let mut position = engine.get_position("p1").unwrap();
        let margin = position.margin;
        // A settlement far below entry drives equity negative.
        let event = engine.execute_liquidation(&mut position, 1.0);

        assert_eq!(event.remaining_margin, 0.0);
        assert_eq!(event.realized_loss, margin);
    }
}