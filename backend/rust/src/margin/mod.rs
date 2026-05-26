//! Margin Trading - Rust Implementation
//! 
//! Margin positions, leverage, interest calculations

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Margin position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub size: f64,
    pub entry_price: f64,
    pub liquidation_price: f64,
    pub leverage: f64,
    pub margin: f64,
    pub unrealized_pnl: f64,
    pub roe: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionSide { Long, Short }

/// Margin account
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginAccount {
    pub user_id: String,
    pub total_margin: f64,
    pub available_margin: f64,
    pub margin_ratio: f64,
    pub liquidation_flag: bool,
}

pub struct MarginService {
    positions: HashMap<String, MarginPosition>,
    accounts: HashMap<String, MarginAccount>,
    max_leverage: f64,
    maintenance_margin: f64,
}

impl MarginService {
    pub fn new() -> Self {
        Self {
            positions: HashMap::new(),
            accounts: HashMap::new(),
            max_leverage: 125.0,
            maintenance_margin: 0.005,
        }
    }

    /// Open position
    pub fn open_position(&mut self, user_id: &str, symbol: &str, side: PositionSide,
                    size: f64, entry_price: f64, leverage: f64) -> Result<MarginPosition, String> {
        if leverage > self.max_leverage {
            return Err(format!("Max leverage is {}", self.max_leverage));
        }

        let margin = (size * entry_price) / leverage;
        
        let liquidation_price = match side {
            PositionSide::Long => entry_price * (1.0 - 1.0/leverage + self.maintenance_margin),
            PositionSide::Short => entry_price * (1.0 + 1.0/leverage - self.maintenance_margin),
        };

        let position = MarginPosition {
            id: format!("pos_{}", current_timestamp_ms()),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            size,
            entry_price,
            liquidation_price,
            leverage,
            margin,
            unrealized_pnl: 0.0,
            roe: 0.0,
        };

        self.positions.insert(position.id.clone(), position.clone());
        
        // Update account
        let account = self.accounts.entry(user_id.to_string())
            .or_insert_with(|| MarginAccount {
                user_id: user_id.to_string(),
                total_margin: 0.0,
                available_margin: 10000.0, // Mock
                margin_ratio: 1.0,
                liquidation_flag: false,
            });
        account.total_margin += margin;

        Ok(position)
    }

    /// Close position
    pub fn close_position(&mut self, position_id: &str, exit_price: f64) -> Result<MarginPosition, String> {
        let position = self.positions.get_mut(position_id)
            .ok_or("Position not found")?;

        let pnl = match position.side {
            PositionSide::Long => (exit_price - position.entry_price) * position.size,
            PositionSide::Short => (position.entry_price - exit_price) * position.size,
        };

        position.unrealized_pnl = pnl;
        position.roe = if position.margin > 0.0 { 
            (pnl / position.margin) * 100.0 
        } else { 0.0 };

        Ok(position.clone())
    }

    /// Check liquidation
    pub fn check_liquidation(&self, position_id: &str, current_price: f64) -> bool {
        let position = match self.positions.get(position_id) {
            Some(p) => p,
            None => return false,
        };

        match position.side {
            PositionSide::Long => current_price <= position.liquidation_price,
            PositionSide::Short => current_price >= position.liquidation_price,
        }
    }

    /// Get positions
    pub fn get_positions(&self, user_id: &str) -> Vec<&MarginPosition> {
        self.positions.values()
            .filter(|p| p.user_id == user_id)
            .collect()
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_position() {
        let mut service = MarginService::new();
        let result = service.open_position(
            "user1", "BTC/USDT", PositionSide::Long, 1.0, 50000.0, 10.0
        );
        assert!(result.is_ok());
    }
}