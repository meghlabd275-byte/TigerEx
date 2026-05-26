//! TigerEx Risk Management Engine - Rust Implementation
//! 
//! High-performance risk management for trading operations
//! Real-time risk calculations with compile-time safety
//! 
//! Migration from TypeScript to Rust

use std::collections::HashMap;

/// Risk severity levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl Default for RiskLevel {
    fn default() -> Self {
        RiskLevel::Low
    }
}

/// Position side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PositionSide {
    Long,
    Short,
}

/// Order side for risk checks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Risk check result
#[derive(Debug, Clone)]
pub struct RiskCheckResult {
    pub allowed: bool,
    pub risk_level: RiskLevel,
    pub message: Option<String>,
    pub required_margin: Option<u64>,
    pub max_leverage: Option<u32>,
}

impl Default for RiskCheckResult {
    fn default() -> Self {
        RiskCheckResult {
            allowed: true,
            risk_level: RiskLevel::Low,
            message: None,
            required_margin: None,
            max_leverage: None,
        }
    }
}

/// Trading position
#[derive(Debug, Clone)]
pub struct Position {
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: u64,
    pub entry_price: u64,
    pub mark_price: u64,
    pub leverage: u32,
    pub liquidation_price: u64,
    pub unrealized_pnl: i64,
    pub margin: u64,
    pub margin_ratio: f64,
}

impl Position {
    pub fn new(
        user_id: String,
        symbol: String,
        side: PositionSide,
        quantity: u64,
        entry_price: u64,
        leverage: u32,
    ) -> Self {
        let mark_price = entry_price;
        let liquidation_price = calculate_liquidation_price_raw(entry_price, leverage, side);
        
        Position {
            user_id,
            symbol,
            side,
            quantity,
            entry_price,
            mark_price,
            leverage,
            liquidation_price,
            unrealized_pnl: 0,
            margin: 0,
            margin_ratio: 0.0,
        }
    }
}

/// Account risk summary
#[derive(Debug, Clone)]
pub struct AccountRisk {
    pub total_equity: i64,
    pub total_margin: u64,
    pub available_margin: i64,
    pub total_position_value: u64,
    pub margin_ratio: f64,
    pub liquidation_risk: RiskLevel,
}

/// Helper: Calculate liquidation price (raw i64 for speed)
fn calculate_liquidation_price_raw(entry_price: u64, leverage: u32, side: PositionSide) -> u64 {
    const MAINTENANCE_MARGIN_RATE: f64 = 0.005;
    
    if side == PositionSide::Long {
        let ratio = (1.0 - (1.0 / leverage as f64) + MAINTENANCE_MARGIN_RATE) * (entry_price as f64);
        ratio as u64
    } else {
        let ratio = (1.0 + (1.0 / leverage as f64) - MAINTENANCE_MARGIN_RATE) * (entry_price as f64);
        ratio as u64
    }
}

/// Main Risk Management Engine
pub struct RiskManagementEngine {
    // Risk parameters (immutable after initialization)
    max_leverage: u32,
    margin_ratio_maintenance: f64,
    margin_ratio_partial_liquidation: f64,
    max_position_size: u64,
    max_daily_loss: i64,
    max_open_positions: usize,
    
    // Daily tracking
    daily_pnl: i64,
    daily_trades_count: u32,
}

impl Default for RiskManagementEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl RiskManagementEngine {
    pub fn new() -> Self {
        RiskManagementEngine {
            max_leverage: 125,
            margin_ratio_maintenance: 0.005,    // 0.5%
            margin_ratio_partial_liquidation: 0.01, // 1%
            max_position_size: 1_000_000,  // $1M
            max_daily_loss: -100_000,      // -$100k
            max_open_positions: 20,
            daily_pnl: 0,
            daily_trades_count: 0,
        }
    }
}

impl RiskManagementEngine {
    /// Check if order is allowed
    pub fn check_order(
        &self,
        user_id: &str,
        symbol: &str,
        side: OrderSide,
        quantity: u64,
        price: u64,
        leverage: u32,
        current_positions: &[Position],
    ) -> RiskCheckResult {
        // Check leverage
        if leverage > self.max_leverage {
            return RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::Critical,
                message: Some(format!("Maximum leverage is {}x", self.max_leverage)),
                required_margin: None,
                max_leverage: Some(self.max_leverage),
            };
        }

        // Check position size
        let order_value = (quantity as u128) * (price as u128);
        if order_value > self.max_position_size as u128 {
            return RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::High,
                message: Some(format!("Order size exceeds maximum of ${}", self.max_position_size)),
                required_margin: None,
                max_leverage: None,
            };
        }

        // Check position count
        if current_positions.len() >= self.max_open_positions {
            return RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::High,
                message: Some(format!("Maximum open positions is {}", self.max_open_positions)),
                required_margin: None,
                max_leverage: None,
            };
        }

        // Check existing position for flip risk
        let existing_position = current_positions.iter().find(|p| p.symbol == symbol);
        if let Some(pos) = existing_position {
            let existing_is_long = pos.side == PositionSide::Long;
            let new_is_buy = side == OrderSide::Buy;
            
            // If trying to close/opposite
            if (existing_is_long && !new_is_buy) || (!existing_is_long && new_is_buy) {
                let total_qty = pos.quantity + quantity;
                if total_qty > pos.quantity * 3 / 2 {
                    return RiskCheckResult {
                        allowed: true,
                        risk_level: RiskLevel::Medium,
                        message: Some("Position flip risk".to_string()),
                        required_margin: None,
                        max_leverage: None,
                    };
                }
            }
        }

        // Calculate required margin
        let order_value_u64 = order_value as u64;
        let required_margin = order_value_u64 / leverage as u64;

        RiskCheckResult {
            allowed: true,
            risk_level: RiskLevel::Low,
            message: None,
            required_margin: Some(required_margin),
            max_leverage: Some(self.max_leverage),
        }
    }

    /// Calculate liquidation price
    pub fn calculate_liquidation_price(
        &self,
        entry_price: u64,
        leverage: u32,
        side: PositionSide,
    ) -> u64 {
        calculate_liquidation_price_raw(entry_price, leverage, side)
    }

    /// Calculate position P&L
    pub fn calculate_pnl(
        &self,
        entry_price: u64,
        mark_price: u64,
        quantity: u64,
        side: PositionSide,
    ) -> i64 {
        if side == PositionSide::Long {
            (mark_price as i64 - entry_price as i64) * (quantity as i64)
        } else {
            (entry_price as i64 - mark_price as i64) * (quantity as i64)
        }
    }

    /// Check account risk
    pub fn check_account_risk(
        &self,
        positions: &[Position],
        total_balance: i64,
    ) -> AccountRisk {
        let mut total_margin = 0u64;
        let mut total_position_value = 0u64;

        for position in positions {
            total_margin += position.margin;
            total_position_value += position.quantity * position.mark_price;
        }

        let total_pnl: i64 = positions.iter()
            .map(|p| p.unrealized_pnl)
            .sum();

        let total_equity = total_balance + total_pnl;
        let available_margin = total_equity - total_margin as i64;
        let margin_ratio = if total_position_value > 0 {
            total_margin as f64 / total_position_value as f64
        } else {
            1.0
        };

        // Determine liquidation risk
        let liquidation_risk = if margin_ratio < self.margin_ratio_maintenance {
            RiskLevel::Critical
        } else if margin_ratio < self.margin_ratio_partial_liquidation {
            RiskLevel::High
        } else if margin_ratio < 0.02 {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        };

        AccountRisk {
            total_equity,
            total_margin,
            available_margin,
            total_position_value,
            margin_ratio,
            liquidation_risk,
        }
    }

    /// Check for liquidation
    pub fn check_liquidation(&self, position: &Position) -> bool {
        let current_margin_ratio = self.calculate_margin_ratio(position);
        current_margin_ratio < self.margin_ratio_maintenance
    }

    /// Calculate margin ratio
    fn calculate_margin_ratio(&self, position: &Position) -> f64 {
        if position.mark_price == 0 || position.quantity == 0 {
            return 1.0;
        }
        
        let position_value = (position.quantity as u128) * (position.mark_price as u128);
        position.margin as f64 / position_value as f64
    }

    /// Get maximum order quantity
    pub fn get_max_quantity(
        &self,
        user_balance: i64,
        price: u64,
        leverage: u32,
        existing_quantity: u64,
    ) -> i64 {
        if price == 0 || leverage == 0 {
            return 0;
        }
        
        let max_new_position = (user_balance as u128 * leverage as u128) / (price as u128);
        let result = max_new_position as i64 - existing_quantity as i64;
        
        if result < 0 { 0 } else { result }
    }

    /// Calculate margin requirement
    pub fn calculate_margin(&self, order_value: u64, leverage: u32) -> u64 {
        if leverage == 0 {
            return 0;
        }
        order_value / leverage as u64
    }

    /// Check daily loss limit
    pub fn check_daily_loss_limit(&self, daily_pnl: i64) -> RiskCheckResult {
        if daily_pnl <= self.max_daily_loss {
            RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::Critical,
                message: Some("Daily loss limit reached".to_string()),
                required_margin: None,
                max_leverage: None,
            }
        } else {
            RiskCheckResult {
                allowed: true,
                risk_level: RiskLevel::Low,
                message: None,
                required_margin: None,
                max_leverage: None,
            }
        }
    }

    /// Update daily P&L
    pub fn update_daily_pnl(&mut self, pnl: i64) {
        self.daily_pnl += pnl;
        self.daily_trades_count += 1;
    }

    /// Get daily statistics
    pub fn get_daily_stats(&self) -> (i64, u32) {
        (self.daily_pnl, self.daily_trades_count)
    }

    /// Reset daily stats (call at day start)
    pub fn reset_daily(&mut self) {
        self.daily_pnl = 0;
        self.daily_trades_count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_order() {
        let engine = RiskManagementEngine::new();
        
        let result = engine.check_order(
            "user1",
            "BTC/USDT",
            OrderSide::Buy,
            1000,
            50000,
            10,
            &[],
        );
        
        assert!(result.allowed);
        assert_eq!(result.risk_level, RiskLevel::Low);
    }

    #[test]
    fn test_liquidation_price() {
        let engine = RiskManagementEngine::new();
        
        let liq_price = engine.calculate_liquidation_price(
            50000,
            10,
            PositionSide::Long,
        );
        
        println!("Liquidation price: {}", liq_price);
        assert!(liq_price > 0);
    }

    #[test]
    fn test_pnl_calculation() {
        let engine = RiskManagementEngine::new();
        
        let pnl = engine.calculate_pnl(
            50000,
            55000,
            1000,
            PositionSide::Long,
        );
        
        assert_eq!(pnl, 5_000_000);
    }
}