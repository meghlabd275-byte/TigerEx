//! TigerEx Margin Trading Service - Rust
//! Leveraged trading with margin

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Margin account
#[derive(Debug, Clone)]
pub struct MarginAccount {
    pub user_id: String,
    pub collateral: f64,
    pub borrowed: f64,
    pub interest_accrued: f64,
    pub margin_ratio: f64,
}

impl MarginAccount {
    pub fn new(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_string(),
            collateral: 0.0,
            borrowed: 0.0,
            interest_accrued: 0.0,
            margin_ratio: 0.0,
        }
    }

    pub fn available_to_borrow(&self) -> f64 {
        (self.collateral * 3.0) - self.borrowed
    }

    pub fn health_ratio(&self) -> f64 {
        if self.borrowed == 0.0 {
            return 1.0;
        }
        self.collateral / self.borrowed
    }
}

/// Margin position
#[derive(Debug, Clone)]
pub struct MarginPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub size: f64,
    pub entry_price: f64,
    pub leverage: u32,
    pub unrealized_pnl: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PositionSide {
    Long,
    Short,
}

/// Margin trading service
pub struct MarginService {
    accounts: RwLock<HashMap<String, MarginAccount>>,
    positions: RwLock<Vec<MarginPosition>>,
}

impl MarginService {
    pub fn new() -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            positions: RwLock::new(Vec::new()),
        }
    }

    /// Open margin account
    pub fn open_account(&self, user_id: &str, collateral: f64) -> Result<MarginAccount, String> {
        if collateral < 100.0 {
            return Err("Minimum collateral is $100".to_string());
        }

        let account = MarginAccount::new(user_id);
        let account.collateral = collateral;

        let mut accounts = self.accounts.write().unwrap();
        accounts.insert(user_id.to_string(), account.clone());

        Ok(account)
    }

    /// Borrow funds
    pub fn borrow(&self, user_id: &str, amount: f64) -> Result<f64, String> {
        let mut accounts = self.accounts.write().unwrap();
        
        let account = accounts
            .get_mut(user_id)
            .ok_or("Account not found")?;

        if amount > account.available_to_borrow() {
            return Err("Insufficient collateral".to_string());
        }

        account.borrowed += amount;
        Ok(amount)
    }

    /// Repay borrow
    pub fn repay(&self, user_id: &str, amount: f64) -> Result<f64, String> {
        let mut accounts = self.accounts.write().unwrap();
        
        let account = accounts
            .get_mut(user_id)
            .ok_or("Account not found")?;

        let repay = amount.min(account.borrowed);
        account.borrowed -= repay;
        
        Ok(repay)
    }

    /// Get account
    pub fn get_account(&self, user_id: &str) -> Option<MarginAccount> {
        let accounts = self.accounts.read().unwrap();
        accounts.get(user_id).cloned()
    }

    /// Open margin position
    pub fn open_position(
        &self,
        user_id: &str,
        symbol: &str,
        side: PositionSide,
        size: f64,
        entry_price: f64,
        leverage: u32,
    ) -> Result<MarginPosition, String> {
        if leverage > 10 {
            return Err("Maximum leverage is 10x".to_string());
        }

        let position = MarginPosition {
            id: generate_id(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            size,
            entry_price,
            leverage,
            unrealized_pnl: 0.0,
        };

        let mut positions = self.positions.write().unwrap();
        positions.push(position.clone());

        Ok(position)
    }

    /// Calculate unrealized P&L
    pub fn update_pnl(&self, symbol: &str, current_price: f64) {
        let mut positions = self.positions.write().unwrap();
        
        for pos in positions.iter_mut() {
            if pos.symbol == symbol {
                pos.unrealized_pnl = match pos.side {
                    PositionSide::Long => (current_price - pos.entry_price) * pos.size,
                    PositionSide::Short => (pos.entry_price - current_price) * pos.size,
                };
            }
        }
    }

    /// Check liquidation
    pub fn check_liquidation(&self, user_id: &str) -> Option<LiquidationSignal> {
        let account = self.get_account(user_id)?;
        
        if account.health_ratio() < 1.2 {
            Some(LiquidationSignal {
                user_id: user_id.to_string(),
                health_ratio: account.health_ratio(),
                warnings: vec!["Margin call".to_string()],
            })
        } else {
            None
        }
    }
}

impl Default for MarginService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LiquidationSignal {
    pub user_id: String,
    pub health_ratio: f64,
    pub warnings: Vec<String>,
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("marg_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account() {
        let service = MarginService::new();
        
        service.open_account("user1", 1000.0).unwrap();
        let account = service.get_account("user1").unwrap();
        
        assert_eq!(account.collateral, 1000.0);
    }
}