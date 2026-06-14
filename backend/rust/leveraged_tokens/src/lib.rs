//! TigerEx Leveraged Tokens - Auto-compounding Leveraged Tokens
//! Implementation of ERC-20 like tokens with 3x, 5x, 10x, 25x leverage

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use chrono::{DateTime, Utc};

#[derive(Error, Debug)]
pub enum LeveragedTokenError {
    #[error("Invalid leverage: {0}")]
    InvalidLeverage(String),
    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),
    #[error("Rebalance required: {0}")]
    RebalanceRequired(String),
    #[error("Price oracle error: {0}")]
    OracleError(String),
}

impl Serialize for LeveragedTokenError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenType {
    Long3x,   // BTC3L
    Long5x,    // BTC5L
    Long10x,   // BTC10L
    Long25x,   // BTC25L
    Short3x,   // BTC3S
    Short5x,    // BTC5S
    Short10x,  // BTC10S
    Short25x,  // BTC25S
}

impl TokenType {
    pub fn leverage(&self) -> f64 {
        match self {
            TokenType::Long3x | TokenType::Short3x => 3.0,
            TokenType::Long5x | TokenType::Short5x => 5.0,
            TokenType::Long10x | TokenType::Short10x => 10.0,
            TokenType::Long25x | TokenType::Short25x => 25.0,
        }
    }

    pub fn is_long(&self) -> bool {
        matches!(self, TokenType::Long3x | TokenType::Long5x | TokenType::Long10x | TokenType::Long25x)
    }

    pub fn symbol(&self, base: &str) -> String {
        let suffix = match self {
            TokenType::Long3x => "3L",
            TokenType::Long5x => "5L",
            TokenType::Long10x => "10L",
            TokenType::Long25x => "25L",
            TokenType::Short3x => "3S",
            TokenType::Short5x => "5S",
            TokenType::Short10x => "10S",
            TokenType::Short25x => "25S",
        };
        format!("{}{}", base.to_uppercase(), suffix)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeveragedToken {
    pub token_id: String,
    pub name: String,
    pub symbol: String,
    pub token_type: TokenType,
    pub underlying_asset: String,
    pub total_supply: f64,
    pub nav: f64,              // Net Asset Value
    pub nav_per_share: f64,
    pub target_leverage: f64,
    pub actual_leverage: f64,
    pub current_position: f64,
    pub entry_price: f64,
    pub last_rebalance_price: f64,
    pub rebalance_threshold: f64,  // When to rebalance (e.g., 5% drift)
    pub fees: TokenFees,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenFees {
    pub management_fee: f64,    // Annual fee (e.g., 1.5%)
    pub performance_fee: f64,    // Performance fee (e.g., 10%)
    pub redemption_fee: f64,     // Redemption fee (e.g., 0.5%)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBalance {
    pub user_id: String,
    pub token_id: String,
    pub balance: f64,
    pub avg_entry_nav: f64,
    pub realized_pnl: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebalanceEvent {
    pub event_id: String,
    pub token_id: String,
    pub old_leverage: f64,
    pub new_leverage: f64,
    pub old_position: f64,
    pub new_position: f64,
    pub underlying_price: f64,
    pub pnl: f64,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceHistory {
    pub timestamp: i64,
    pub price: f64,
    pub nav: f64,
    pub leverage: f64,
}

// ============================================================================
// LEVERAGED TOKEN MANAGER
// ============================================================================

pub struct LeveragedTokenManager {
    tokens: HashMap<String, LeveragedToken>,
    balances: HashMap<String, TokenBalance>, // user_token_key -> balance
    price_history: HashMap<String, Vec<PriceHistory>>,
    rebalance_events: Vec<RebalanceEvent>,
    current_prices: HashMap<String, f64>, // asset -> price
}

impl LeveragedTokenManager {
    pub fn new() -> Self {
        let mut prices = HashMap::new();
        prices.insert("BTC".to_string(), 50000.0);
        prices.insert("ETH".to_string(), 3000.0);
        prices.insert("BNB".to_string(), 400.0);
        prices.insert("SOL".to_string(), 100.0);

        LeveragedTokenManager {
            tokens: HashMap::new(),
            balances: HashMap::new(),
            price_history: HashMap::new(),
            rebalance_events: Vec::new(),
            current_prices: prices,
        }
    }

    /// Create a new leveraged token
    pub fn create_token(
        &mut self,
        underlying: &str,
        token_type: TokenType,
        name: &str,
    ) -> Result<LeveragedToken, LeveragedTokenError> {
        let token_id = format!("{}_{}", underlying.to_uppercase(), token_type as u8);
        
        let token = LeveragedToken {
            token_id: token_id.clone(),
            name: name.to_string(),
            symbol: token_type.symbol(underlying),
            token_type,
            underlying_asset: underlying.to_uppercase(),
            total_supply: 0.0,
            nav: 1.0, // Start at $1 NAV
            nav_per_share: 1.0,
            target_leverage: token_type.leverage(),
            actual_leverage: token_type.leverage(),
            current_position: 0.0,
            entry_price: 0.0,
            last_rebalance_price: 0.0,
            rebalance_threshold: 0.10, // 10% drift triggers rebalance
            fees: TokenFees {
                management_fee: 0.015,  // 1.5% annual
                performance_fee: 0.10,    // 10% of profits
                redemption_fee: 0.005,   // 0.5%
            },
            created_at: Utc::now().timestamp(),
            updated_at: Utc::now().timestamp(),
        };

        self.tokens.insert(token_id.clone(), token.clone());
        
        // Initialize price history
        self.price_history.insert(token_id, Vec::new());
        
        Ok(token)
    }

    /// Update underlying price
    pub fn update_price(&mut self, asset: &str, price: f64) {
        self.current_prices.insert(asset.to_uppercase(), price);
    }

    /// Mint new tokens (buy)
    pub fn mint(
        &mut self,
        user_id: &str,
        token_id: &str,
        amount_usd: f64,
    ) -> Result<(f64, f64), LeveragedTokenError> {
        let token = self.tokens.get_mut(token_id)
            .ok_or_else(|| LeveragedTokenError::InvalidLeverage("Token not found".to_string()))?;

        // Calculate tokens to mint
        let tokens_to_mint = amount_usd / token.nav_per_share;
        
        // Update token supply
        token.total_supply += tokens_to_mint;
        token.current_position += amount_usd;
        
        // Update user balance
        let key = format!("{}_{}", user_id, token_id);
        if let Some(balance) = self.balances.get_mut(&key) {
            let total_cost = (balance.balance + tokens_to_mint) * balance.avg_entry_nav;
            let new_cost = tokens_to_mint * token.nav_per_share;
            balance.balance += tokens_to_mint;
            balance.avg_entry_nav = (total_cost + new_cost) / balance.balance;
        } else {
            self.balances.insert(key, TokenBalance {
                user_id: user_id.to_string(),
                token_id: token_id.to_string(),
                balance: tokens_to_mint,
                avg_entry_nav: token.nav_per_share,
                realized_pnl: 0.0,
            });
        }

        token.updated_at = Utc::now().timestamp();
        
        Ok((tokens_to_mint, token.nav_per_share))
    }

    /// Burn tokens (redeem)
    pub fn burn(
        &mut self,
        user_id: &str,
        token_id: &str,
        token_amount: f64,
    ) -> Result<f64, LeveragedTokenError> {
        let key = format!("{}_{}", user_id, token_id);
        let balance = self.balances.get(&key)
            .ok_or_else(|| LeveragedTokenError::InsufficientBalance("No balance found".to_string()))?;

        if balance.balance < token_amount {
            return Err(LeveragedTokenError::InsufficientBalance(
                format!("Insufficient balance: {} < {}", balance.balance, token_amount)
            ));
        }

        let token = self.tokens.get_mut(token_id)
            .ok_or_else(|| LeveragedTokenError::InvalidLeverage("Token not found".to_string()))?;

        // Calculate redemption value
        let redemption_value = token_amount * token.nav_per_share;
        
        // Apply redemption fee
        let fee = redemption_value * token.fees.redemption_fee;
        let net_value = redemption_value - fee;

        // Update token supply
        token.total_supply -= token_amount;
        token.current_position -= redemption_value;

        // Update user balance
        let balance = self.balances.get_mut(&key).unwrap();
        balance.balance -= token_amount;

        token.updated_at = Utc::now().timestamp();
        
        Ok(net_value)
    }

    /// Trigger rebalance when leverage drifts
    pub fn check_and_rebalance(&mut self, token_id: &str) -> Result<RebalanceEvent, LeveragedTokenError> {
        let token = self.tokens.get_mut(token_id)
            .ok_or_else(|| LeveragedTokenError::InvalidLeverage("Token not found".to_string()))?;

        let underlying_price = *self.current_prices.get(&token.underlying_asset)
            .ok_or_else(|| LeveragedTokenError::OracleError("Price not available".to_string()))?;

        // Calculate current leverage
        if token.total_supply > 0.0 && token.nav > 0.0 {
            let position_value = token.current_position;
            let token_value = token.total_supply * token.nav_per_share;
            
            if token_value > 0.0 {
                token.actual_leverage = position_value / token_value;
            }
        }

        // Check if rebalance needed
        let leverage_diff = (token.actual_leverage - token.target_leverage).abs();
        
        if leverage_diff > token.rebalance_threshold || 
           token.actual_leverage > token.target_leverage * 1.5 ||
           token.actual_leverage < token.target_leverage * 0.5 {
            
            // Execute rebalance
            return self.rebalance(token_id);
        }

        Err(LeveragedTokenError::RebalanceRequired("No rebalance needed".to_string()))
    }

    /// Execute rebalance
    pub fn rebalance(&mut self, token_id: &str) -> Result<RebalanceEvent, LeveragedTokenError> {
        let token = self.tokens.get_mut(token_id)
            .ok_or_else(|| LeveragedTokenError::InvalidLeverage("Token not found".to_string()))?;

        let underlying_price = *self.current_prices.get(&token.underlying_asset)
            .ok_or_else(|| LeveragedTokenError::OracleError("Price not available".to_string()))?;

        let old_position = token.current_position;
        let old_leverage = token.actual_leverage;

        // Calculate new position to restore target leverage
        let target_position = token.total_supply * token.nav_per_share * token.target_leverage;
        
        // Calculate PnL
        let price_change = if token.last_rebalance_price > 0.0 {
            (underlying_price - token.last_rebalance_price) / token.last_rebalance_price
        } else {
            0.0
        };

        let pnl = if token.token_type.is_long() {
            old_position * price_change // Long: profit when price goes up
        } else {
            -old_position * price_change // Short: profit when price goes down
        };

        // Adjust position
        token.current_position = target_position;
        token.actual_leverage = token.target_leverage;
        token.entry_price = underlying_price;
        token.last_rebalance_price = underlying_price;

        // Recalculate NAV
        let new_nav = token.nav + (pnl / token.total_supply.max(1.0));
        token.nav = new_nav.max(0.001); // Prevent NAV from going negative
        token.nav_per_share = token.nav;

        let event = RebalanceEvent {
            event_id: format!("rebalance_{}_{}", token_id, Utc::now().timestamp_millis()),
            token_id: token_id.to_string(),
            old_leverage,
            new_leverage: token.target_leverage,
            old_position,
            new_position: target_position,
            underlying_price,
            pnl,
            timestamp: Utc::now().timestamp(),
        };

        self.rebalance_events.push(event.clone());
        token.updated_at = Utc::now().timestamp();

        Ok(event)
    }

    /// Update NAV based on price movement
    pub fn update_nav(&mut self, token_id: &str) -> Result<f64, LeveragedTokenError> {
        let token = self.tokens.get_mut(token_id)
            .ok_or_else(|| LeveragedTokenError::InvalidLeverage("Token not found".to_string()))?;

        let underlying_price = *self.current_prices.get(&token.underlying_asset)
            .ok_or_else(|| LevergedTokenError::OracleError("Price not available".to_string()))?;

        // Calculate price change since last rebalance
        let price_change_pct = if token.last_rebalance_price > 0.0 {
            (underlying_price - token.last_rebalance_price) / token.last_rebalance_price
        } else {
            0.0
        };

        // Calculate PnL
        let pnl = if token.token_type.is_long() {
            token.current_position * price_change_pct
        } else {
            -token.current_position * price_change_pct
        };

        // Update NAV
        let old_nav = token.nav;
        token.nav = (token.nav + pnl / token.total_supply.max(1.0)).max(0.001);
        
        // Management fee accrual (simplified)
        token.nav *= (1.0 - token.fees.management_fee / 365.0);

        token.nav_per_share = token.nav;
        
        // Record price history
        if let Some(history) = self.price_history.get_mut(token_id) {
            history.push(PriceHistory {
                timestamp: Utc::now().timestamp(),
                price: underlying_price,
                nav: token.nav,
                leverage: token.actual_leverage,
            });
        }

        token.updated_at = Utc::now().timestamp();

        Ok(token.nav)
    }

    /// Get token info
    pub fn get_token(&self, token_id: &str) -> Option<&LeveragedToken> {
        self.tokens.get(token_id)
    }

    /// Get user balance
    pub fn get_balance(&self, user_id: &str, token_id: &str) -> Option<&TokenBalance> {
        self.balances.get(&format!("{}_{}", user_id, token_id))
    }

    /// Get all tokens for an underlying asset
    pub fn get_tokens_for_asset(&self, underlying: &str) -> Vec<&LeveragedToken> {
        self.tokens.values()
            .filter(|t| t.underlying_asset == underlying.to_uppercase())
            .collect()
    }

    /// Calculate portfolio value
    pub fn calculate_portfolio_value(&self, user_id: &str) -> f64 {
        let mut total_value = 0.0;
        
        for (key, balance) in &self.balances {
            if key.starts_with(&format!("{}_", user_id)) {
                if let Some(token) = self.tokens.get(&balance.token_id) {
                    total_value += balance.balance * token.nav_per_share;
                    total_value += balance.realized_pnl;
                }
            }
        }
        
        total_value
    }
}

impl Default for LeveragedTokenManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_token() {
        let mut manager = LeveragedTokenManager::new();
        
        let result = manager.create_token(
            "BTC",
            TokenType::Long3x,
            "3x Long Bitcoin",
        );
        
        assert!(result.is_ok());
        let token = result.unwrap();
        assert_eq!(token.target_leverage, 3.0);
    }

    #[test]
    fn test_mint_burn() {
        let mut manager = LeveragedTokenManager::new();
        
        // Create token
        manager.create_token("BTC", TokenType::Long3x, "3x Long BTC").unwrap();
        manager.update_price("BTC", 50000.0);
        
        // Mint tokens
        let (tokens, nav) = manager.mint("user1", "BTC_0", 10000.0).unwrap();
        assert!(tokens > 0.0);
        
        // Burn tokens
        let value = manager.burn("user1", "BTC_0", tokens).unwrap();
        assert!(value > 0.0);
    }

    #[test]
    fn test_nav_update() {
        let mut manager = LeveragedTokenManager::new();
        
        manager.create_token("BTC", TokenType::Long3x, "3x Long BTC").unwrap();
        manager.update_price("BTC", 50000.0);
        manager.mint("user1", "BTC_0", 10000.0).unwrap();
        
        // Simulate price increase
        manager.update_price("BTC", 55000.0); // 10% increase
        
        let new_nav = manager.update_nav("BTC_0").unwrap();
        assert!(new_nav > 1.0); // NAV should increase for long position
    }

    #[test]
    fn test_rebalance() {
        let mut manager = LeveragedTokenManager::new();
        
        manager.create_token("BTC", TokenType::Long3x, "3x Long BTC").unwrap();
        manager.update_price("BTC", 50000.0);
        manager.mint("user1", "BTC_0", 10000.0).unwrap();
        
        // Simulate large price move to trigger rebalance
        manager.update_price("BTC", 30000.0); // 40% drop should trigger rebalance
        
        let result = manager.check_and_rebalance("BTC_0");
        assert!(result.is_ok());
    }
}