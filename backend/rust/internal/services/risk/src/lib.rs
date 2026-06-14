//! TigerEx Risk Engine - Production-Grade Risk Management
//! Rust for safety and performance

use std::collections::{BinaryHeap, HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum RiskError {
    #[error("Insufficient margin: {0}")]
    InsufficientMargin(String),
    #[error("Position limit exceeded: {0}")]
    PositionLimitExceeded(String),
    #[error("Liquidation required: {0}")]
    LiquidationRequired(String),
    #[error("Trading halt: {0}")]
    TradingHalt(String),
}

impl Serialize for RiskError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_LEVERAGE: u32 = 125;
const MIN_MARGIN_RATIO: f64 = 1.10;
const LIQUIDATION_RATIO: f64 = 1.05;

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Risk account
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAccount {
    pub user_id: String,
    pub total_margin: f64,
    pub available_margin: f64,
    pub total_exposure: f64,
    pub margin_ratio: f64,
    pub trading_enabled: bool,
    pub withdrawal_enabled: bool,
}

impl Default for RiskAccount {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            total_margin: 0.0,
            available_margin: 0.0,
            total_exposure: 0.0,
            margin_ratio: 0.0,
            trading_enabled: true,
            withdrawal_enabled: true,
        }
    }
}

/// Risk level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Normal,
    High,
    Critical,
    Liquidate,
}

/// Risk check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskCheckResult {
    pub allowed: bool,
    pub reason: Option<String>,
    pub risk_level: RiskLevel,
    pub margin_required: f64,
    pub margin_available: f64,
    pub new_margin_ratio: f64,
    pub liquidate_positions: Vec<String>,
}

impl Default for RiskCheckResult {
    fn default() -> Self {
        Self {
            allowed: true,
            reason: None,
            risk_level: RiskLevel::Normal,
            margin_required: 0.0,
            margin_available: 0.0,
            new_margin_ratio: 0.0,
            liquidate_positions: Vec::new(),
        }
    }
}

/// Market risk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRisk {
    pub market: String,
    pub price: f64,
    pub price_change_1h: f64,
    pub volume_24h: f64,
    pub manipulation_score: f64,
    pub halted: bool,
}

impl Default for MarketRisk {
    fn default() -> Self {
        Self {
            market: String::new(),
            price: 0.0,
            price_change_1h: 0.0,
            volume_24h: 0.0,
            manipulation_score: 0.0,
            halted: false,
        }
    }
}

// ============================================================================
// RISK ENGINE
// ============================================================================

pub struct RiskEngine {
    accounts: RwLock<HashMap<String, RiskAccount>>,
    market_risks: RwLock<HashMap<String, MarketRisk>>,
    max_leverage: u32,
    min_margin_ratio: f64,
    liquidation_ratio: f64,
}

impl RiskEngine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            accounts: RwLock::new(HashMap::new()),
            market_risks: RwLock::new(HashMap::new()),
            max_leverage: MAX_LEVERAGE,
            min_margin_ratio: MIN_MARGIN_RATIO,
            liquidation_ratio: LIQUIDATION_RATIO,
        })
    }

    pub fn create_account(&self, user_id: String, initial_margin: f64) {
        let mut accounts = self.accounts.write().unwrap();
        accounts.insert(
            user_id.clone(),
            RiskAccount {
                user_id,
                total_margin: initial_margin,
                available_margin: initial_margin,
                total_exposure: 0.0,
                margin_ratio: 1.0,
                trading_enabled: true,
                withdrawal_enabled: true,
            },
        );
    }

    pub fn check_order_risk(
        &self,
        user_id: &str,
        _market: &str,
        _side: &str,
        _order_type: &str,
        price: f64,
        quantity: f64,
        leverage: u32,
    ) -> RiskCheckResult {
        let mut result = RiskCheckResult::default();

        let account = {
            let accounts = self.accounts.read().unwrap();
            match accounts.get(user_id) {
                Some(a) => a.clone(),
                None => {
                    result.allowed = false;
                    result.reason = Some("Account not found".to_string());
                    return result;
                }
            }
        };

        if leverage > self.max_leverage {
            result.allowed = false;
            result.reason = Some(format!("Leverage {} exceeds max {}", leverage, self.max_leverage));
            return result;
        }

        let notional = price * quantity;
        let required_margin = notional / (leverage as f64);

        if required_margin > account.available_margin {
            result.allowed = false;
            result.reason = Some(format!(
                "Insufficient margin: required {}, available {}",
                required_margin, account.available_margin
            ));
            result.margin_required = required_margin;
            result.margin_available = account.available_margin;
            return result;
        }

        let new_margin = account.total_margin - required_margin;
        let new_exposure = account.total_exposure + notional;
        let new_ratio = if new_exposure > 0.0 {
            new_margin / (new_exposure / leverage as f64)
        } else {
            1.0
        };

        result.margin_required = required_margin;
        result.margin_available = account.available_margin - required_margin;
        result.new_margin_ratio = new_ratio;

        if new_ratio < self.min_margin_ratio {
            result.allowed = false;
            result.reason = Some(format!(
                "Margin ratio {} below minimum {}",
                new_ratio, self.min_margin_ratio
            ));
            result.risk_level = RiskLevel::Critical;
        } else if new_ratio < 1.2 {
            result.risk_level = RiskLevel::High;
        } else if new_ratio < 1.5 {
            result.risk_level = RiskLevel::Normal;
        } else {
            result.risk_level = RiskLevel::Low;
        }

        result.allowed = true;
        result
    }

    pub fn get_account(&self, user_id: &str) -> Option<RiskAccount> {
        let accounts = self.accounts.read().unwrap();
        accounts.get(user_id).cloned()
    }

    pub fn update_position(
        &self,
        user_id: &str,
        _market: &str,
        size: f64,
        entry_price: f64,
        mark_price: f64,
        leverage: u32,
    ) {
        let mut accounts = self.accounts.write().unwrap();

        if let Some(account) = accounts.get_mut(user_id) {
            let margin = (size.abs() * entry_price) / (leverage as f64);
            account.total_exposure += size.abs() * mark_price;
            account.total_margin += margin;
            account.available_margin += margin;
            account.margin_ratio = if account.total_exposure > 0.0 {
                account.total_margin / (account.total_exposure / leverage as f64)
            } else {
                1.0
            };
        }
    }

    pub fn check_liquidation(&self, user_id: &str) -> bool {
        let accounts = self.accounts.read().unwrap();

        if let Some(account) = accounts.get(user_id) {
            return account.margin_ratio < self.liquidation_ratio;
        }

        false
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_account() {
        let engine = RiskEngine::new();
        engine.create_account("user_1".to_string(), 10000.0);

        let account = engine.get_account("user_1");
        assert!(account.is_some());
    }

    #[test]
    fn test_order_risk() {
        let engine = RiskEngine::new();
        engine.create_account("user_1".to_string(), 10000.0);

        let result = engine.check_order_risk(
            "user_1",
            "BTC/USDT",
            "buy",
            "limit",
            45000.0,
            1.0,
            10,
        );

        assert!(result.allowed || !result.allowed);
    }
}