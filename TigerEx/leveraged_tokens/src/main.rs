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
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Amount must be a positive finite number".to_string());
        }
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
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Amount must be a positive finite number".to_string());
        }
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

    /// Apply an underlying price move to a token's NAV.
    ///
    /// A leveraged token tracks `leverage ×` the daily return of its underlying,
    /// so NAV changes by `leverage × (new_price / old_price - 1)`. A short token
    /// loses when the price rises. A move that would drive NAV to or below zero
    /// is rejected (the token would be worthless and must be liquidated by the
    /// issuer instead of silently going negative).
    pub fn update_nav(
        &self,
        token_symbol: &str,
        old_underlying_price: f64,
        new_underlying_price: f64,
    ) -> Result<f64, String> {
        if !old_underlying_price.is_finite() || old_underlying_price <= 0.0 {
            return Err("Previous underlying price must be positive".to_string());
        }
        if !new_underlying_price.is_finite() || new_underlying_price <= 0.0 {
            return Err("New underlying price must be positive".to_string());
        }
        let mut tokens = self.tokens.write();
        let token = tokens.get_mut(token_symbol).ok_or("Token not found")?;

        let old_nav = token.nav;
        let price_return = new_underlying_price / old_underlying_price - 1.0;
        let leveraged_return = price_return * token.leverage as f64;
        let new_nav = old_nav * (1.0 + leveraged_return);
        if !new_nav.is_finite() || new_nav <= 0.0 {
            return Err("Underlying move would drive NAV to zero or below".to_string());
        }

        token.nav = new_nav;
        token.nav_change_24h = (token.nav - old_nav) / old_nav * 100.0;
        token.market_cap = token.total_supply * token.nav;

        Ok(token.nav)
    }

    /// Daily rebalance: snap the token back to exactly `leverage ×` the
    /// underlying so compounding does not drift the effective leverage.
    ///
    /// The issuer adjusts the token's position in the underlying to restore the
    /// target exposure. This records the event; the NAV itself is unchanged
    /// because rebalancing does not create or destroy value.
    pub fn rebalance(
        &self,
        token_symbol: &str,
        underlying_price: f64,
        now: i64,
    ) -> Result<RebalanceEvent, String> {
        if !underlying_price.is_finite() || underlying_price <= 0.0 {
            return Err("Underlying price must be positive".to_string());
        }
        let mut tokens = self.tokens.write();
        let token = tokens.get_mut(token_symbol).ok_or("Token not found")?;

        let event = RebalanceEvent {
            id: Uuid::new_v4().to_string(),
            token_symbol: token_symbol.to_string(),
            old_leverage: token.leverage,
            new_leverage: token.leverage,
            underlying_price,
            rebalance_ratio: 1.0,
            timestamp: now,
        };
        token.last_rebalance = now;
        self.rebalance_history.write().push(event.clone());
        Ok(event)
    }

    /// True when the token's drift from its target leverage exceeds the
    /// configured threshold and a rebalance is due.
    pub fn needs_rebalance(&self, token_symbol: &str, effective_leverage: f64) -> Result<bool, String> {
        let tokens = self.tokens.read();
        let token = tokens.get(token_symbol).ok_or("Token not found")?;
        let target = token.leverage as f64;
        if target == 0.0 {
            return Err("Token has no leverage target".to_string());
        }
        Ok(((effective_leverage - target) / target).abs() >= token.rebalance_threshold)
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
    pub fn rebalance_history(&self) -> Vec<RebalanceEvent> {
        self.rebalance_history.read().clone()
    }

    #[inline]
    pub fn update_price(&self, asset: &str, price: f64) {
        if price.is_finite() && price > 0.0 {
            self.prices.write().insert(asset.to_string(), price);
        }
    }

    #[inline]
    pub fn get_price(&self, asset: &str) -> Option<f64> {
        self.prices.read().get(asset).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager_with_token() -> LeveragedTokenManager {
        let m = LeveragedTokenManager::new();
        m.create_token("BTC3L".into(), "Bitcoin 3x Long".into(), "BTC".into(), 3).unwrap();
        m.create_token("BTC3S".into(), "Bitcoin 3x Short".into(), "BTC".into(), -3).unwrap();
        m
    }

    #[test]
    fn rejects_invalid_leverage() {
        let m = LeveragedTokenManager::new();
        assert!(m.create_token("X".into(), "x".into(), "BTC".into(), 0).is_err());
        assert!(m.create_token("X".into(), "x".into(), "BTC".into(), 1).is_err());
        assert!(m.create_token("X".into(), "x".into(), "BTC".into(), 11).is_err());
    }

    #[test]
    fn mint_rejects_non_positive_amount() {
        let m = manager_with_token();
        assert!(m.mint("u1", "BTC3L", 0.0).is_err());
        assert!(m.mint("u1", "BTC3L", -5.0).is_err());
        assert!(m.mint("u1", "BTC3L", f64::NAN).is_err());
    }

    #[test]
    fn long_token_tracks_positive_return_with_leverage() {
        let m = manager_with_token();
        // Underlying +10% -> NAV +30%.
        let nav = m.update_nav("BTC3L", 100.0, 110.0).unwrap();
        assert!((nav - 13.0).abs() < 1e-9, "expected 13.0 got {nav}");
    }

    #[test]
    fn short_token_loses_when_price_rises() {
        let m = manager_with_token();
        let nav = m.update_nav("BTC3S", 100.0, 110.0).unwrap();
        assert!((nav - 7.0).abs() < 1e-9, "expected 7.0 got {nav}");
    }

    #[test]
    fn update_nav_rejects_bad_prices_and_wipeout() {
        let m = manager_with_token();
        assert!(m.update_nav("BTC3L", 0.0, 100.0).is_err());
        assert!(m.update_nav("BTC3L", 100.0, -1.0).is_err());
        // A -50% move on a 3x long would make NAV negative.
        assert!(m.update_nav("BTC3L", 100.0, 50.0).is_err());
    }

    #[test]
    fn burn_realizes_pnl() {
        let m = manager_with_token();
        m.mint("u1", "BTC3L", 10.0).unwrap();
        m.update_nav("BTC3L", 100.0, 110.0).unwrap(); // NAV 10 -> 13
        let (value, pnl) = m.burn("u1", "BTC3L", 10.0).unwrap();
        assert!((value - 130.0).abs() < 1e-9);
        assert!((pnl - 30.0).abs() < 1e-9);
        assert!(m.burn("u1", "BTC3L", 1.0).is_err()); // nothing left
    }

    #[test]
    fn needs_rebalance_respects_threshold() {
        let m = manager_with_token();
        assert!(!m.needs_rebalance("BTC3L", 3.1).unwrap());
        assert!(m.needs_rebalance("BTC3L", 3.6).unwrap());
        assert!(m.needs_rebalance("BTC3L", 2.0).unwrap());
    }

    #[test]
    fn rebalance_records_event_and_updates_timestamp() {
        let m = manager_with_token();
        let ev = m.rebalance("BTC3L", 105.0, 12345).unwrap();
        assert_eq!(ev.timestamp, 12345);
        assert_eq!(m.get_token("BTC3L").unwrap().last_rebalance, 12345);
        assert_eq!(m.rebalance_history().len(), 1);
    }

    #[test]
    fn price_updates_ignore_invalid_values() {
        let m = manager_with_token();
        m.update_price("BTC", 100.0);
        assert_eq!(m.get_price("BTC"), Some(100.0));
        m.update_price("BTC", -5.0);
        assert_eq!(m.get_price("BTC"), Some(100.0));
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
