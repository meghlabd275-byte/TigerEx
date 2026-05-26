//! TigerEx Risk Management Engine - Rust Implementation
//! 
//! Production-grade risk management for crypto trading

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskCheckResult {
    pub allowed: bool,
    pub risk_level: RiskLevel,
    pub message: Option<String>,
    pub required_margin: Option<f64>,
    pub max_leverage: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub leverage: f64,
    pub liquidation_price: f64,
    pub unrealized_pnl: f64,
    pub margin: f64,
    pub margin_ratio: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRisk {
    pub total_equity: f64,
    pub total_margin: f64,
    pub available_margin: f64,
    pub total_position_value: f64,
    pub margin_ratio: f64,
    pub liquidation_risk: RiskLevel,
}

pub struct RiskManagementEngine {
    max_leverage: f64,
    margin_ratio_maintenance: f64,
    margin_ratio_partial_liquidation: f64,
    max_position_size: f64,
    max_daily_loss: f64,
    max_open_positions: usize,
    positions: Vec<Position>,
}

impl RiskManagementEngine {
    pub fn new() -> Self {
        Self {
            max_leverage: 125.0,
            margin_ratio_maintenance: 0.005,
            margin_ratio_partial_liquidation: 0.01,
            max_position_size: 1_000_000.0,
            max_daily_loss: 100_000.0,
            max_open_positions: 20,
            positions: Vec::new(),
        }
    }

    pub fn check_order(
        &self,
        user_id: &str,
        symbol: &str,
        side: PositionSide,
        quantity: f64,
        price: f64,
        leverage: f64,
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
        let order_value = quantity * price;
        if order_value > self.max_position_size {
            return RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::High,
                message: Some(format!("Order size exceeds maximum of ${}", self.max_position_size)),
                required_margin: None,
                max_leverage: None,
            };
        }

        // Check position count
        let user_positions: Vec<&Position> = self.positions
            .iter()
            .filter(|p| p.user_id == user_id)
            .collect();
        
        if user_positions.len() >= self.max_open_positions {
            return RiskCheckResult {
                allowed: false,
                risk_level: RiskLevel::High,
                message: Some(format!("Maximum open positions is {}", self.max_open_positions)),
                required_margin: None,
                max_leverage: None,
            };
        }

        // Check existing position for this symbol
        if let Some(existing) = user_positions.iter().find(|p| p.symbol == symbol) {
            if existing.side != side {
                let total_qty = existing.quantity + quantity;
                if total_qty > existing.quantity * 1.5 {
                    return RiskCheckResult {
                        allowed: true,
                        risk_level: RiskLevel::Medium,
                        message: Some("Reducing position".to_string()),
                        required_margin: Some(order_value / leverage),
                        max_leverage: Some(leverage),
                    };
                }
            }
        }

        RiskCheckResult {
            allowed: true,
            risk_level: RiskLevel::Low,
            message: Some("Order allowed".to_string()),
            required_margin: Some(order_value / leverage),
            max_leverage: Some(leverage),
        }
    }

    pub fn calculate_liquidation_price(
        &self,
        entry_price: f64,
        leverage: f64,
        side: PositionSide,
    ) -> f64 {
        let maintenance_margin = 0.005;
        
        match side {
            PositionSide::Long => {
                entry_price * (1.0 - (1.0 / leverage) + maintenance_margin)
            }
            PositionSide::Short => {
                entry_price * (1.0 / leverage) + maintenance_margin
            }
        }
    }

    pub fn check_account_risk(&self, user_id: &str) -> AccountRisk {
        let user_positions: Vec<&Position> = self.positions
            .iter()
            .filter(|p| p.user_id == user_id)
            .collect();

        let total_equity = 1_000_000.0; // Should come from account service
        let total_margin: f64 = user_positions.iter().map(|p| p.margin).sum();
        let total_position_value: f64 = user_positions.iter()
            .map(|p| p.quantity * p.mark_price)
            .sum();
        let available_margin = total_equity - total_margin;
        let margin_ratio = if total_equity > 0.0 {
            total_margin / total_equity
        } else {
            0.0
        };

        let liquidation_risk = if margin_ratio < self.margin_ratio_maintenance {
            RiskLevel::Critical
        } else if margin_ratio < self.margin_ratio_partial_liquidation {
            RiskLevel::High
        } else if margin_ratio < 0.03 {
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

    pub fn add_position(&mut self, position: Position) {
        self.positions.push(position);
    }

    pub fn remove_positions_for_user(&mut self, user_id: &str) {
        self.positions.retain(|p| p.user_id != user_id);
    }
}

impl Default for RiskManagementEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_order_allowed() {
        let engine = RiskManagementEngine::new();
        let result = engine.check_order(
            "user1",
            "BTC/USDT",
            PositionSide::Long,
            1.0,
            50000.0,
            10.0,
        );
        assert!(result.allowed);
    }

    #[test]
    fn test_check_order_leverage_exceeded() {
        let engine = RiskManagementEngine::new();
        let result = engine.check_order(
            "user1",
            "BTC/USDT",
            PositionSide::Long,
            1.0,
            50000.0,
            150.0,
        );
        assert!(!result.allowed);
        assert_eq!(result.risk_level, RiskLevel::Critical);
    }

    #[test]
    fn test_liquidation_price_long() {
        let engine = RiskManagementEngine::new();
        let liq_price = engine.calculate_liquidation_price(50000.0, 10.0, PositionSide::Long);
        assert!(liq_price > 40000.0 && liq_price < 41000.0);
    }
}