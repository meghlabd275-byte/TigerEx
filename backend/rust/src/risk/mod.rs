//! TigerEx Risk Engine - Rust Implementation
//! Real-time risk management for exchange operations

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// ============================================================================
// RISK LIMITS
/// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_position_size: f64,
    pub max_order_size: f64,
    pub max_daily_volume: f64,
    pub max_leverage: f64,
    pub max_open_orders: u32,
    pub min_order_size: f64,
    pub max_slippage: f64,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_position_size: 1_000_000.0,
            max_order_size: 100_000.0,
            max_daily_volume: 10_000_000.0,
            max_leverage: 10.0,
            max_open_orders: 100,
            min_order_size: 0.001,
            max_slippage: 0.05,
        }
    }
}

/// ============================================================================
// POSITION
/// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub liquidation_price: f64,
    pub unrealized_pnl: f64,
    pub margin_used: f64,
    pub leverage: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
}

/// ============================================================================
// RISK ENGINE
/// ============================================================================

pub struct RiskEngine {
    limits: RiskLimits,
    positions: HashMap<String, Position>,
    daily_volumes: HashMap<String, f64>,
    open_orders: HashMap<String, u32>,
}

impl RiskEngine {
    pub fn new() -> Self {
        Self {
            limits: RiskLimits::default(),
            positions: HashMap::new(),
            daily_volumes: HashMap::new(),
            open_orders: HashMap::new(),
        }
    }

    /// Check order risk
    pub fn check_order(&self, symbol: &str, _side: PositionSide, quantity: f64, price: f64) -> RiskCheckResult {
        let value = quantity * price;
        
        if value > self.limits.max_order_size {
            return RiskCheckResult::Rejected(RiskRejection::OrderTooLarge);
        }
        if quantity < self.limits.min_order_size {
            return RiskCheckResult::Rejected(RiskRejection::OrderTooSmall);
        }
        if price <= 0.0 {
            return RiskCheckResult::Rejected(RiskRejection::InvalidPrice);
        }

        if let Some(pos) = self.positions.get(symbol) {
            if pos.quantity * price > self.limits.max_position_size {
                return RiskCheckResult::Rejected(RiskRejection::PositionLimitExceeded);
            }
        }

        let daily_vol = self.daily_volumes.get(symbol).copied().unwrap_or(0.0);
        if daily_vol + value > self.limits.max_daily_volume {
            return RiskCheckResult::Rejected(RiskRejection::DailyVolumeExceeded);
        }

        RiskCheckResult::Accepted
    }

    /// Calculate liquidation price
    pub fn calculate_liquidation(&self, entry_price: f64, side: PositionSide, leverage: f64) -> f64 {
        let maintenance_margin = 0.005;
        match side {
            PositionSide::Long => entry_price * (1.0 - maintenance_margin - (1.0 / leverage)),
            PositionSide::Short => entry_price * (1.0 + maintenance_margin + (1.0 / leverage)),
        }
    }

    /// Update position after trade
    pub fn update_position(&mut self, symbol: &str, side: PositionSide, quantity: f64, price: f64, current_price: f64) {
        let key = symbol.to_string();
        
        if let Some(pos) = self.positions.get_mut(&key) {
            let new_quantity = match (pos.side, side) {
                (PositionSide::Long, PositionSide::Long) => pos.quantity + quantity,
                (PositionSide::Short, PositionSide::Short) => pos.quantity + quantity,
                _ => (pos.quantity - quantity).abs(),
            };

            if new_quantity <= 0.0 {
                self.positions.remove(&key);
                return;
            }

            let total_cost = (pos.quantity * pos.entry_price) + (quantity * price);
            pos.entry_price = total_cost / (pos.quantity + quantity);
            pos.quantity = new_quantity;
            pos.unrealized_pnl = match pos.side {
                PositionSide::Long => (current_price - pos.entry_price) * pos.quantity,
                PositionSide::Short => (pos.entry_price - current_price) * pos.quantity,
            };
            pos.liquidation_price = self.calculate_liquidation(pos.entry_price, pos.side, pos.leverage);
        } else {
            let liquidation_price = self.calculate_liquidation(price, side, 1.0);
            let pnl = match side {
                PositionSide::Long => (current_price - price) * quantity,
                PositionSide::Short => (price - current_price) * quantity,
            };

            self.positions.insert(key, Position {
                symbol: symbol.to_string(),
                side,
                quantity,
                entry_price: price,
                liquidation_price,
                unrealized_pnl: pnl,
                margin_used: price * quantity,
                leverage: 1.0,
            });
        }
    }

    /// Check liquidation
    pub fn check_liquidation(&self, symbol: &str, current_price: f64) -> LiquidationStatus {
        if let Some(pos) = self.positions.get(symbol) {
            let should_liquidate = match pos.side {
                PositionSide::Long => current_price <= pos.liquidation_price,
                PositionSide::Short => current_price >= pos.liquidation_price,
            };

            if should_liquidate {
                LiquidationStatus::Liquidate {
                    liquidation_price: pos.liquidation_price,
                    unrealized_pnl: pos.unrealized_pnl,
                }
            } else {
                LiquidationStatus::Safe
            }
        } else {
            LiquidationStatus::NoPosition
        }
    }

    /// Get total exposure
    pub fn total_exposure(&self) -> f64 {
        self.positions.values().map(|p| p.quantity * p.entry_price).sum()
    }

    /// Get risk summary
    pub fn get_risk_summary(&self) -> RiskSummary {
        RiskSummary {
            total_exposure: self.total_exposure(),
            position_count: self.positions.len() as u32,
            daily_volume: self.daily_volumes.values().copied().sum(),
        }
    }
}

/// ============================================================================
// RESULTS
/// ============================================================================

pub enum RiskCheckResult {
    Accepted,
    Rejected(RiskRejection),
}

pub enum RiskRejection {
    OrderTooLarge,
    OrderTooSmall,
    InvalidPrice,
    PositionLimitExceeded,
    DailyVolumeExceeded,
    LeverageTooHigh,
    InsufficientBalance,
}

pub enum LiquidationStatus {
    Safe,
    Liquidate { liquidation_price: f64, unrealized_pnl: f64 },
    NoPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskSummary {
    pub total_exposure: f64,
    pub position_count: u32,
    pub daily_volume: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_order() {
        let engine = RiskEngine::new();
        let result = engine.check_order("BTC/USDT", PositionSide::Long, 1.0, 50000.0);
        matches!(result, RiskCheckResult::Accepted);
    }

    #[test]
    fn test_liquidation() {
        let engine = RiskEngine::new();
        let liq_price = engine.calculate_liquidation(50000.0, PositionSide::Long, 10.0);
        assert!(liq_price < 50000.0);
    }
}