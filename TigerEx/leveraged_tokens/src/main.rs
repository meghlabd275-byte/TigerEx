//! TigerEx Leveraged Tokens System
//! Auto-compounding leveraged positions

use std::collections::HashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// Core Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeveragedToken {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub underlying_asset: String,
    pub leverage: i8,
    pub token_type: TokenType,
    pub nav: f64,
    pub nav_change_24h: f64,
    pub total_supply: f64,
    pub market_cap: f64,
    pub rebalance_threshold: f64,
    pub last_rebalance: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenType {
    Long3X,
    Long5X,
    Long10X,
    Short3X,
    Short5X,
    Short10X,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPosition {
    pub id: String,
    pub user_id: String,
    pub token_symbol: String,
    pub amount: f64,
    pub avg_nav: f64,
    pub realized_pnl: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebalanceEvent {
    pub id: String,
    pub token_symbol: String,
    pub old_leverage: i8,
    pub new_leverage: i8,
    pub underlying_price: f64,
    pub rebalance_ratio: f64,
    pub timestamp: i64,
}

// ============================================================================
// Leveraged Token Manager
// ============================================================================

pub struct LeveragedTokenManager {
    tokens: RwLock<HashMap<String, LeveragedToken>>,
    positions: RwLock<HashMap<String, TokenPosition>>,
    prices: RwLock<HashMap<String, f64>>,
    rebalance_history: RwLock<Vec<RebalanceEvent>>,
}

impl LeveragedTokenManager {
    pub fn new() -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
            positions: RwLock::new(HashMap::new()),
            prices: RwLock::new(HashMap::new()),
            rebalance_history: RwLock::new(Vec::new()),
        }
    }

    #[inline]
    pub fn create_token(&self, symbol: String, name: String, underlying: String, leverage: i8) -> Result<LeveragedToken, String> {
        if leverage == 0 || leverage.abs() < 2 || leverage.abs() > 10 {
            return Err("Leverage must be between 2x and 10x".to_string());
        }

        let token_type = if leverage > 0 {
            match leverage {
                3 => TokenType::Long3X,
                5 => TokenType::Long5X,
                10 => TokenType::Long10X,
                _ => return Err("Invalid long leverage".to_string()),
            }
        } else {
            match leverage.abs() {
                3 => TokenType::Short3X,
                5 => TokenType::Short5X,
                10 => TokenType::Short10X,
                _ => return Err("Invalid short leverage".to_string()),
            }
        };

        let token = LeveragedToken {
            id: Uuid::new_v4().to_string(),
            symbol: symbol.clone(),
            name,
            underlying_asset: underlying,
            leverage,
            token_type,
            nav: 10.0,
            nav_change_24h: 0.0,
            total_supply: 0.0,
            market_cap: 0.0,
            rebalance_threshold: 0.15,
            last_rebalance: chrono::Utc::now().timestamp(),
            is_active: true,
        };

        self.tokens.write().insert(symbol, token.clone());
        Ok(token)
    }

    #[inline]
    pub fn mint(&self, user_id: &str, token_symbol: &str, amount: f64) -> Result<TokenPosition, String> {
        let mut tokens = self.tokens.write();
        let token = tokens.get_mut(token_symbol).ok_or("Token not found")?;

        if !token.is_active {
            return Err("Token not active".to_string());
        }

        token.total_supply += amount;
        token.market_cap = token.total_supply * token.nav;

        let position = TokenPosition {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            token_symbol: token_symbol.to_string(),
            amount,
            avg_nav: token.nav,
            realized_pnl: 0.0,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };

        self.positions.write().insert(position.id.clone(), position.clone());
        Ok(position)
    }

    #[inline]
    pub fn burn(&self, user_id: &str, token_symbol: &str, amount: f64) -> Result<(f64, f64), String> {
        let mut tokens = self.tokens.write();
        let token = tokens.get_mut(token_symbol).ok_or("Token not found")?;

        let mut positions = self.positions.write();
        let position = positions.values_mut()
            .find(|p| p.user_id == user_id && p.token_symbol == token_symbol && p.amount >= amount)
            .ok_or("Insufficient balance")?;

        let current_value = amount * token.nav;
        let cost = amount * position.avg_nav;
        let pnl = current_value - cost;

        position.amount -= amount;
        position.realized_pnl += pnl;
        position.updated_at = chrono::Utc::now().timestamp();

        token.total_supply -= amount;
        token.market_cap = token.total_supply * token.nav;

        Ok((current_value, pnl))
    }

    #[inline]
    pub fn update_nav(&self, token_symbol: &str, underlying_price: f64) -> Result<f64, String> {
        let mut tokens = self.tokens.write();
        let token = tokens.get_mut(token_symbol).ok_or("Token not found")?;

        let old_nav = token.nav;
        let price_change = (underlying_price - token.last_rebalance as f64) / token.last_rebalance as f64;

        if token.leverage > 0 {
            token.nav *= 1.0 + (price_change * token.leverage as f64);
        } else {
            token.nav *= 1.0 - (price_change * token.leverage.abs() as f64);
        }

        token.nav_change_24h = (token.nav - old_nav) / old_nav * 100.0;

        Ok(token.nav)
    }

    #[inline]
    pub fn get_token(&self, symbol: &str) -> Option<LeveragedToken> {
        self.tokens.read().get(symbol).cloned()
    }

    #[inline]
    pub fn get_all_tokens(&self) -> Vec<LeveragedToken> {
        self.tokens.read().values().cloned().collect()
    }

    #[inline]
    pub fn update_price(&self, asset: &str, price: f64) {
        self.prices.write().insert(asset.to_string(), price);
    }
}

fn main() {
    println!("TigerEx Leveraged Tokens v1.0");
    println!("Auto-compounding leveraged positions\n");

    let manager = LeveragedTokenManager::new();

    let btc_3l = manager.create_token(
        "BTC3L".to_string(),
        "Bitcoin 3x Long".to_string(),
        "BTC".to_string(),
        3,
    ).unwrap();

    let btc_3s = manager.create_token(
        "BTC3S".to_string(),
        "Bitcoin 3x Short".to_string(),
        "BTC".to_string(),
        -3,
    ).unwrap();

    println!("Created tokens:");
    println!("  {} - {} ({}x)", btc_3l.symbol, btc_3l.name, btc_3l.leverage);
    println!("  {} - {} ({}x)", btc_3s.symbol, btc_3s.name, btc_3s.leverage);

    let pos1 = manager.mint("user1", "BTC3L", 100.0).unwrap();
    println!("\nMinted {} {} tokens", pos1.amount, pos1.token_symbol);
}
