//! TigerEx Lending Protocol - Production-Grade Decentralized Lending
//! Supports flexible/fixed lending, borrowing, collateral management, and liquidation

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum LendingError {
    #[error("Insufficient collateral: {0}")]
    InsufficientCollateral(String),
    #[error("Insufficient liquidity: {0}")]
    InsufficientLiquidity(String),
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),
    #[error("Position under collateralized: {0}")]
    UnderCollateralized(String),
    #[error("Borrow limit exceeded: {0}")]
    BorrowLimitExceeded(String),
    #[error("Asset not supported: {0}")]
    AssetNotSupported(String),
    #[error("Interest calculation error: {0}")]
    InterestError(String),
    #[error("Liquidation blocked: {0}")]
    LiquidationBlocked(String),
}

impl Serialize for LendingError {
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

const SECONDS_PER_YEAR: f64 = 365.25 * 24.0 * 3600.0;
const LIQUIDATION_THRESHOLD: f64 = 1.25; // 125% collateral ratio
const LIQUIDATION_BONUS: f64 = 0.05; // 5% bonus for liquidators
const MIN_COLLATERAL_RATIO: f64 = 1.10; // 110% minimum
const GRACE_PERIOD_SECONDS: i64 = 3600; // 1 hour

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Asset configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetConfig {
    pub asset: String,
    pub symbol: String,
    pub decimals: u8,
    pub is_collateral: bool,
    pub is_borrowable: bool,
    pub loan_to_value: f64,          // LTV ratio (0.1 = 10%)
    pub liquidation_threshold: f64,   // Liquidation threshold
    pub borrow_rate: f64,            // Annual borrow rate
    pub lend_rate: f64,             // Annual lend rate
    pub min_borrow: f64,
    pub max_borrow: f64,
    pub flash_loan_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LendingPool {
    pub asset: String,
    pub total_supplied: f64,
    pub total_borrowed: f64,
    pub supply_rate: f64,
    pub borrow_rate: f64,
    pub utilization_ratio: f64,
    pub supply_balance: f64,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLendingPosition {
    pub user_id: String,
    pub asset: String,
    pub supplied_amount: f64,
    pub accrued_supply_interest: f64,
    pub collateral_value: f64,
    pub borrowed_amount: f64,
    pub accrued_borrow_interest: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorrowPosition {
    pub position_id: String,
    pub user_id: String,
    pub asset: String,
    pub collateral_assets: Vec<CollateralAsset>,
    pub borrowed_amount: f64,
    pub interest_accrued: f64,
    pub health_factor: f64,
    pub liquidation_threshold: f64,
    pub status: PositionStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollateralAsset {
    pub asset: String,
    pub amount: f64,
    pub value_usd: f64,
    pub collateral_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositionStatus {
    Active,
    LiquidationPending,
    Liquidated,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Liquidation {
    pub liquidation_id: String,
    pub position_id: String,
    pub user_id: String,
    pub liquidator: String,
    pub collateral_asset: String,
    pub collateral_amount: f64,
    pub debt_asset: String,
    pub debt_paid: f64,
    pub bonus: f64,
    pub price: f64,
    pub executed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterestAccrual {
    pub user_id: String,
    pub asset: String,
    pub principal: f64,
    pub interest_rate: f64,
    pub accrued_interest: f64,
    pub last_accrual: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LendingStats {
    pub total_supply_usd: f64,
    pub total_borrow_usd: f64,
    pub total_collateral_usd: f64,
    pub utilization_ratio: f64,
    pub avg_supply_rate: f64,
    pub avg_borrow_rate: f64,
    pub active_positions: u64,
    pub liquidations_24h: u64,
}

// ============================================================================
// PRICE ORACLE (Simplified)
// ============================================================================

pub struct PriceOracle {
    prices: HashMap<String, f64>,
}

impl PriceOracle {
    pub fn new() -> Self {
        let mut prices = HashMap::new();
        // Initial prices (in production, fetch from oracle)
        prices.insert("BTC".to_string(), 50000.0);
        prices.insert("ETH".to_string(), 3000.0);
        prices.insert("USDT".to_string(), 1.0);
        prices.insert("USDC".to_string(), 1.0);
        prices.insert("BNB".to_string(), 400.0);
        prices.insert("SOL".to_string(), 100.0);
        prices.insert("XRP".to_string(), 0.5);
        prices.insert("ADA".to_string(), 0.35);
        prices.insert("DOGE".to_string(), 0.08);
        prices.insert("AVAX".to_string(), 35.0);
        
        PriceOracle { prices }
    }

    pub fn get_price(&self, asset: &str) -> f64 {
        self.prices.get(asset.to_uppercase()).copied().unwrap_or(1.0)
    }

    pub fn get_value_usd(&self, asset: &str, amount: f64) -> f64 {
        amount * self.get_price(asset)
    }

    pub fn set_price(&mut self, asset: &str, price: f64) {
        self.prices.insert(asset.to_uppercase(), price);
    }
}

impl Default for PriceOracle {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// LENDING PROTOCOL
// ============================================================================

pub struct LendingProtocol {
    pools: HashMap<String, LendingPool>,
    user_positions: HashMap<String, UserLendingPosition>,
    borrow_positions: HashMap<String, BorrowPosition>,
    liquidations: Vec<Liquidation>,
    config: HashMap<String, AssetConfig>,
    oracle: PriceOracle,
}

impl LendingProtocol {
    pub fn new() -> Self {
        let mut config = HashMap::new();

        // BTC configuration
        config.insert("BTC".to_string(), AssetConfig {
            asset: "BTC".to_string(),
            symbol: "BTC".to_string(),
            decimals: 8,
            is_collateral: true,
            is_borrowable: true,
            loan_to_value: 0.70, // 70% LTV
            liquidation_threshold: 1.30, // 130%
            borrow_rate: 0.05, // 5% APY
            lend_rate: 0.02, // 2% APY
            min_borrow: 0.001,
            max_borrow: 10000.0,
            flash_loan_enabled: false,
        });

        // ETH configuration
        config.insert("ETH".to_string(), AssetConfig {
            asset: "ETH".to_string(),
            symbol: "ETH".to_string(),
            decimals: 18,
            is_collateral: true,
            is_borrowable: true,
            loan_to_value: 0.75,
            liquidation_threshold: 1.25,
            borrow_rate: 0.06,
            lend_rate: 0.03,
            min_borrow: 0.01,
            max_borrow: 50000.0,
            flash_loan_enabled: true,
        });

        // USDT configuration
        config.insert("USDT".to_string(), AssetConfig {
            asset: "USDT".to_string(),
            symbol: "USDT".to_string(),
            decimals: 6,
            is_collateral: false,
            is_borrowable: true,
            loan_to_value: 1.00,
            liquidation_threshold: 1.00,
            borrow_rate: 0.12,
            lend_rate: 0.08,
            min_borrow: 1.0,
            max_borrow: 1000000.0,
            flash_loan_enabled: true,
        });

        // USDC configuration
        config.insert("USDC".to_string(), AssetConfig {
            asset: "USDC".to_string(),
            symbol: "USDC".to_string(),
            decimals: 6,
            is_collateral: true,
            is_borrowable: true,
            loan_to_value: 0.90,
            liquidation_threshold: 1.10,
            borrow_rate: 0.10,
            lend_rate: 0.06,
            min_borrow: 1.0,
            max_borrow: 1000000.0,
            flash_loan_enabled: true,
        });

        // BNB configuration
        config.insert("BNB".to_string(), AssetConfig {
            asset: "BNB".to_string(),
            symbol: "BNB".to_string(),
            decimals: 18,
            is_collateral: true,
            is_borrowable: true,
            loan_to_value: 0.60,
            liquidation_threshold: 1.40,
            borrow_rate: 0.07,
            lend_rate: 0.04,
            min_borrow: 0.1,
            max_borrow: 10000.0,
            flash_loan_enabled: false,
        });

        let oracle = PriceOracle::new();
        let pools = HashMap::new();
        let user_positions = HashMap::new();
        let borrow_positions = HashMap::new();
        let liquidations = Vec::new();

        LendingProtocol {
            pools,
            user_positions,
            borrow_positions,
            liquidations,
            config,
            oracle,
        }
    }

    // =========================================================================
    // POOL OPERATIONS
    // =========================================================================

    /// Initialize a lending pool for an asset
    pub fn init_pool(&mut self, asset: &str) -> Result<LendingPool, LendingError> {
        let config = self.config.get(asset)
            .ok_or_else(|| LendingError::AssetNotSupported(asset.to_string()))?;

        let pool = LendingPool {
            asset: asset.to_string(),
            total_supplied: 0.0,
            total_borrowed: 0.0,
            supply_rate: config.lend_rate,
            borrow_rate: config.borrow_rate,
            utilization_ratio: 0.0,
            supply_balance: 0.0,
            last_updated: Utc::now().timestamp(),
        };

        self.pools.insert(asset.to_string(), pool.clone());
        Ok(pool)
    }

    /// Get pool info
    pub fn get_pool(&self, asset: &str) -> Option<&LendingPool> {
        self.pools.get(asset)
    }

    /// Calculate interest rates based on utilization
    fn calculate_rates(&self, asset: &str, utilization: f64) -> (f64, f64) {
        let config = self.config.get(asset)
            .expect("Asset not found");

        // Utilization-based interest rate model
        let base_borrow_rate = config.borrow_rate;
        let base_supply_rate = config.lend_rate;

        // Increase borrow rate as utilization increases
        let borrow_rate = if utilization < 0.5 {
            base_borrow_rate * (0.5 + utilization)
        } else {
            base_borrow_rate * (1.0 + (utilization - 0.5) * 2.0)
        };

        // Supply rate is proportional to borrow rate and utilization
        let supply_rate = if borrow_rate > 0.0 && utilization > 0.0 {
            borrow_rate * utilization * 0.7 // 70% to suppliers
        } else {
            base_supply_rate
        };

        (supply_rate, borrow_rate)
    }

    // =========================================================================
    // LENDING OPERATIONS
    // =========================================================================

    /// Supply assets to lending pool (lend)
    pub fn supply(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<UserLendingPosition, LendingError> {
        if amount <= 0.0 {
            return Err(LendingError::InvalidAmount("Amount must be positive".to_string()));
        }

        // Initialize pool if not exists
        if !self.pools.contains_key(asset) {
            self.init_pool(asset)?;
        }

        let pool = self.pools.get_mut(asset).unwrap();
        let config = self.config.get(asset).unwrap();

        // Update pool
        pool.total_supplied += amount;
        pool.supply_balance += amount;
        pool.utilization_ratio = if pool.total_supplied > 0.0 {
            pool.total_borrowed / pool.total_supplied
        } else {
            0.0
        };

        // Update rates
        let (supply_rate, borrow_rate) = self.calculate_rates(asset, pool.utilization_ratio);
        pool.supply_rate = supply_rate;
        pool.borrow_rate = borrow_rate;
        pool.last_updated = Utc::now().timestamp();

        // Update user position
        let position_key = format!("{}_{}", user_id, asset);
        let now = Utc::now().timestamp();

        if let Some(position) = self.user_positions.get_mut(&position_key) {
            position.supplied_amount += amount;
            position.updated_at = now;
        } else {
            let position = UserLendingPosition {
                user_id: user_id.to_string(),
                asset: asset.to_string(),
                supplied_amount: amount,
                accrued_supply_interest: 0.0,
                collateral_value: 0.0,
                borrowed_amount: 0.0,
                accrued_borrow_interest: 0.0,
                created_at: now,
                updated_at: now,
            };
            self.user_positions.insert(position_key, position.clone());
            return Ok(position);
        }

        Ok(self.user_positions.get(&position_key).unwrap().clone())
    }

    /// Withdraw supplied assets
    pub fn withdraw(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<f64, LendingError> {
        if amount <= 0.0 {
            return Err(LendingError::InvalidAmount("Amount must be positive".to_string()));
        }

        let position_key = format!("{}_{}", user_id, asset);
        let position = self.user_positions.get_mut(&position_key)
            .ok_or_else(|| LendingError::InvalidAmount("No position found".to_string()))?;

        // Check if user has borrowed against this asset
        let borrow_key = format!("{}_{}", user_id, asset);
        if let Some(borrow_pos) = self.borrow_positions.get(&borrow_key) {
            let collateral_value = self.oracle.get_value_usd(asset, borrow_pos.collateral_assets.iter().find(|c| c.asset == asset).map(|c| c.amount).unwrap_or(0.0));
            
            // Calculate max withdrawable considering borrowed amount
            let max_withdrawable = position.supplied_amount + position.accrued_supply_interest - collateral_value;
            
            if amount > max_withdrawable {
                return Err(LendingError::InsufficientCollateral(
                    format!("Cannot withdraw {} - would violate collateral requirements", amount)
                ));
            }
        }

        // Update pool
        if let Some(pool) = self.pools.get_mut(asset) {
            let withdraw_amount = amount.min(position.supplied_amount + position.accrued_supply_interest);
            pool.total_supplied = (pool.total_supplied - withdraw_amount).max(0.0);
            pool.supply_balance = (pool.supply_balance - withdraw_amount).max(0.0);
            pool.utilization_ratio = if pool.total_supplied > 0.0 {
                pool.total_borrowed / pool.total_supplied
            } else {
                0.0
            };
        }

        // Update position
        position.supplied_amount = (position.supplied_amount - amount).max(0.0);
        position.updated_at = Utc::now().timestamp();

        Ok(amount)
    }

    // =========================================================================
    // BORROWING OPERATIONS
    // =========================================================================

    /// Borrow assets using collateral
    pub fn borrow(
        &mut self,
        user_id: &str,
        borrow_asset: &str,
        collateral_assets: Vec<(String, f64)>,
        amount: f64,
    ) -> Result<BorrowPosition, LendingError> {
        if amount <= 0.0 {
            return Err(LendingError::InvalidAmount("Amount must be positive".to_string()));
        }

        let config = self.config.get(borrow_asset)
            .ok_or_else(|| LendingError::AssetNotSupported(borrow_asset.to_string()))?;

        if !config.is_borrowable {
            return Err(LendingError::AssetNotSupported(format!("{} is not borrowable", borrow_asset)));
        }

        // Calculate total collateral value
        let mut total_collateral_usd = 0.0;
        let mut collateral_list = Vec::new();

        for (asset, amt) in &collateral_assets {
            let asset_config = self.config.get(asset)
                .ok_or_else(|| LendingError::AssetNotSupported(asset.to_string()))?;

            if !asset_config.is_collateral {
                return Err(LendingError::InvalidAmount(format!("{} is not a valid collateral", asset)));
            }

            let value_usd = self.oracle.get_value_usd(asset, *amt);
            total_collateral_usd += value_usd;

            collateral_list.push(CollateralAsset {
                asset: asset.to_string(),
                amount: *amt,
                value_usd,
                collateral_ratio: asset_config.loan_to_value,
            });
        }

        // Calculate max borrowable
        let mut max_borrowable = 0.0;
        for c in &collateral_list {
            let asset_config = self.config.get(&c.asset).unwrap();
            max_borrowable += c.value_usd * asset_config.loan_to_value;
        }

        if amount > max_borrowable {
            return Err(LendingError::BorrowLimitExceeded(
                format!("Maximum borrowable: {}, requested: {}", max_borrowable, amount)
            ));
        }

        // Initialize pool if not exists
        if !self.pools.contains_key(borrow_asset) {
            self.init_pool(borrow_asset)?;
        }

        // Check liquidity
        let pool = self.pools.get(borrow_asset).unwrap();
        if pool.supply_balance < amount {
            return Err(LendingError::InsufficientLiquidity(
                format!("Insufficient liquidity in pool: available {}", pool.supply_balance)
            ));
        }

        // Update pool
        let pool = self.pools.get_mut(borrow_asset).unwrap();
        pool.total_borrowed += amount;
        pool.utilization_ratio = if pool.total_supplied > 0.0 {
            pool.total_borrowed / pool.total_supplied
        } else {
            1.0
        };

        // Update rates
        let (supply_rate, borrow_rate) = self.calculate_rates(borrow_asset, pool.utilization_ratio);
        pool.supply_rate = supply_rate;
        pool.borrow_rate = borrow_rate;
        pool.last_updated = Utc::now().timestamp();

        // Create borrow position
        let now = Utc::now().timestamp();
        let position_id = format!("pos_{}_{}_{}", user_id, borrow_asset, now);

        let health_factor = total_collateral_usd / (amount * self.oracle.get_price(borrow_asset));

        let position = BorrowPosition {
            position_id: position_id.clone(),
            user_id: user_id.to_string(),
            asset: borrow_asset.to_string(),
            collateral_assets: collateral_list,
            borrowed_amount: amount,
            interest_accrued: 0.0,
            health_factor,
            liquidation_threshold: config.liquidation_threshold,
            status: PositionStatus::Active,
            created_at: now,
            updated_at: now,
        };

        self.borrow_positions.insert(position_id, position.clone());
        
        Ok(position)
    }

    /// Repay borrowed amount
    pub fn repay(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<f64, LendingError> {
        if amount <= 0.0 {
            return Err(LendingError::InvalidAmount("Amount must be positive".to_string()));
        }

        let position_key = format!("{}_{}", user_id, asset);
        let position = self.borrow_positions.get_mut(&position_key)
            .ok_or_else(|| LendingError::InvalidAmount("No borrow position found".to_string()))?;

        // Calculate repayment
        let total_debt = position.borrowed_amount + position.interest_accrued;
        let repay_amount = amount.min(total_debt);

        // Update pool
        if let Some(pool) = self.pools.get_mut(asset) {
            pool.total_borrowed = (pool.total_borrowed - repay_amount).max(0.0);
            pool.utilization_ratio = if pool.total_supplied > 0.0 {
                pool.total_borrowed / pool.total_supplied
            } else {
                0.0
            };
        }

        // Update position
        if repay_amount >= total_debt {
            position.status = PositionStatus::Closed;
            position.borrowed_amount = 0.0;
            position.interest_accrued = 0.0;
        } else if repay_amount >= position.borrowed_amount {
            position.interest_accrued -= (repay_amount - position.borrowed_amount).max(0.0);
            position.borrowed_amount = 0.0;
        } else {
            position.borrowed_amount -= repay_amount;
        }

        position.updated_at = Utc::now().timestamp();

        Ok(repay_amount)
    }

    // =========================================================================
    // COLLATERAL MANAGEMENT
    // =========================================================================

    /// Add collateral to existing position
    pub fn add_collateral(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<BorrowPosition, LendingError> {
        let position_key = format!("{}_{}", user_id, asset);
        let position = self.borrow_positions.get_mut(&position_key)
            .ok_or_else(|| LendingError::InvalidAmount("No borrow position found".to_string()))?;

        // Add collateral
        let value_usd = self.oracle.get_value_usd(&position.asset, amount);
        
        if let Some(c) = position.collateral_assets.iter_mut().find(|c| c.asset == position.asset) {
            c.amount += amount;
            c.value_usd += value_usd;
        } else {
            position.collateral_assets.push(CollateralAsset {
                asset: position.asset.clone(),
                amount,
                value_usd,
                collateral_ratio: self.config.get(&position.asset).map(|c| c.loan_to_value).unwrap_or(0.7),
            });
        }

        // Recalculate health factor
        let collateral_value: f64 = position.collateral_assets.iter().map(|c| c.value_usd).sum();
        let debt_value = position.borrowed_amount * self.oracle.get_price(&position.asset);
        
        position.health_factor = if debt_value > 0.0 {
            collateral_value / debt_value
        } else {
            f64::MAX
        };

        position.updated_at = Utc::now().timestamp();

        Ok(position.clone())
    }

    /// Remove collateral from position
    pub fn remove_collateral(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<BorrowPosition, LendingError> {
        let position_key = format!("{}_{}", user_id, asset);
        let position = self.borrow_positions.get_mut(&position_key)
            .ok_or_else(|| LendingError::InvalidAmount("No borrow position found".to_string()))?;

        // Calculate current health factor before removal
        let current_collateral: f64 = position.collateral_assets.iter()
            .filter(|c| c.asset == asset)
            .map(|c| c.value_usd)
            .sum();

        let debt_value = position.borrowed_amount * self.oracle.get_price(&position.asset);
        
        // Check if removal would undercollateralize
        let removal_value = self.oracle.get_value_usd(asset, amount);
        let new_collateral = current_collateral - removal_value;
        
        if debt_value > 0.0 && new_collateral / debt_value < MIN_COLLATERAL_RATIO {
            return Err(LendingError::InsufficientCollateral(
                "Removal would violate minimum collateral ratio".to_string()
            ));
        }

        // Remove collateral
        if let Some(c) = position.collateral_assets.iter_mut().find(|c| c.asset == asset) {
            c.amount = (c.amount - amount).max(0.0);
            c.value_usd = (c.value_usd - removal_value).max(0.0);
        }

        // Recalculate health factor
        let collateral_value: f64 = position.collateral_assets.iter().map(|c| c.value_usd).sum();
        position.health_factor = if debt_value > 0.0 {
            collateral_value / debt_value
        } else {
            f64::MAX
        };

        position.updated_at = Utc::now().timestamp();

        Ok(position.clone())
    }

    // =========================================================================
    // LIQUIDATION
    // =========================================================================

    /// Check if position can be liquidated
    pub fn can_liquidate(&self, user_id: &str, asset: &str) -> bool {
        let position_key = format!("{}_{}", user_id, asset);
        
        if let Some(position) = self.borrow_positions.get(&position_key) {
            return position.health_factor < LIQUIDATION_THRESHOLD && 
                   position.status == PositionStatus::Active;
        }
        
        false
    }

    /// Liquidate undercollateralized position
    pub fn liquidate(
        &mut self,
        user_id: &str,
        asset: &str,
        liquidator_id: &str,
    ) -> Result<Liquidation, LendingError> {
        let position_key = format!("{}_{}", user_id, asset);
        let position = self.borrow_positions.get(&position_key)
            .ok_or_else(|| LendingError::InvalidAmount("Position not found".to_string()))?;

        if !self.can_liquidate(user_id, asset) {
            return Err(LendingError::LiquidationBlocked("Position cannot be liquidated".to_string()));
        }

        let debt_value = position.borrowed_amount * self.oracle.get_price(&position.asset);
        
        // Find collateral to liquidate (prefer highest value)
        let mut collateral_to_liquidate = None;
        let mut max_value = 0.0;
        
        for c in &position.collateral_assets {
            if c.value_usd > max_value {
                max_value = c.value_usd;
                collateral_to_liquidate = Some(c.clone());
            }
        }

        let collateral = collateral_to_liquidate.ok_or_else(|| 
            LendingError::LiquidationBlocked("No collateral found".to_string()))?;

        // Calculate liquidation amounts
        let debt_paid = position.borrowed_amount.min(max_value / (1.0 + LIQUIDATION_BONUS));
        let bonus = debt_paid * LIQUIDATION_BONUS;
        let collateral_amount = (debt_paid + bonus) / self.oracle.get_price(&collateral.asset);

        // Update pool - reduce debt
        if let Some(pool) = self.pools.get_mut(asset) {
            pool.total_borrowed = (pool.total_borrowed - debt_paid).max(0.0);
            pool.utilization_ratio = if pool.total_supplied > 0.0 {
                pool.total_borrowed / pool.total_supplied
            } else {
                0.0
            };
        }

        // Update position
        position.borrowed_amount = (position.borrowed_amount - debt_paid).max(0.0);
        
        if let Some(c) = position.collateral_assets.iter_mut().find(|c| c.asset == collateral.asset) {
            c.amount = (c.amount - collateral_amount).max(0.0);
            c.value_usd = (c.value_usd - debt_paid - bonus).max(0.0);
        }

        // Recalculate health factor
        let collateral_value: f64 = position.collateral_assets.iter().map(|c| c.value_usd).sum();
        let new_debt_value = position.borrowed_amount * self.oracle.get_price(asset);
        
        if position.borrowed_amount > 0.0 {
            position.health_factor = collateral_value / new_debt_value;
        } else {
            position.health_factor = f64::MAX;
            position.status = PositionStatus::Closed;
        }

        position.updated_at = Utc::now().timestamp();

        // Create liquidation record
        let liquidation = Liquidation {
            liquidation_id: format!("liq_{}_{}", user_id, Utc::now().timestamp_millis()),
            position_id: position.position_id.clone(),
            user_id: user_id.to_string(),
            liquidator: liquidator_id.to_string(),
            collateral_asset: collateral.asset,
            collateral_amount,
            debt_asset: asset.to_string(),
            debt_paid,
            bonus,
            price: self.oracle.get_price(&collateral.asset),
            executed_at: Utc::now().timestamp(),
        };

        self.liquidations.push(liquidation.clone());

        Ok(liquidation)
    }

    // =========================================================================
    // INTEREST ACCRUAL
    // =========================================================================

    /// Accrue interest for all positions
    pub fn accrue_interest(&mut self, seconds: i64) {
        let seconds_f = seconds as f64 / SECONDS_PER_YEAR;

        // Accrue supply interest
        for position in self.user_positions.values_mut() {
            if position.supplied_amount > 0.0 {
                let pool = self.pools.get(&position.asset);
                if let Some(p) = pool {
                    position.accrued_supply_interest += 
                        position.supplied_amount * p.supply_rate * seconds_f;
                }
            }
        }

        // Accrue borrow interest
        for position in self.borrow_positions.values_mut() {
            if position.borrowed_amount > 0.0 {
                let pool = self.pools.get(&position.asset);
                if let Some(p) = pool {
                    position.interest_accrued += 
                        position.borrowed_amount * p.borrow_rate * seconds_f;
                }
            }
        }
    }

    // =========================================================================
    // QUERY OPERATIONS
    // =========================================================================

    /// Get user lending position
    pub fn get_lending_position(&self, user_id: &str, asset: &str) -> Option<&UserLendingPosition> {
        self.user_positions.get(&format!("{}_{}", user_id, asset))
    }

    /// Get user borrow position
    pub fn get_borrow_position(&self, user_id: &str, asset: &str) -> Option<&BorrowPosition> {
        self.borrow_positions.get(&format!("{}_{}", user_id, asset))
    }

    /// Get all positions for user
    pub fn get_user_positions(&self, user_id: &str) -> Vec<&BorrowPosition> {
        self.borrow_positions.values()
            .filter(|p| p.user_id == user_id)
            .collect()
    }

    /// Get protocol statistics
    pub fn get_stats(&self) -> LendingStats {
        let mut total_supply_usd = 0.0;
        let mut total_borrow_usd = 0.0;
        let mut total_collateral_usd = 0.0;

        for pool in self.pools.values() {
            total_supply_usd += pool.total_supplied * self.oracle.get_price(&pool.asset);
            total_borrow_usd += pool.total_borrowed * self.oracle.get_price(&pool.asset);
        }

        for position in self.borrow_positions.values() {
            total_collateral_usd += position.collateral_assets.iter()
                .map(|c| c.value_usd)
                .sum::<f64>();
        }

        let total_supply = self.pools.values().map(|p| p.total_supplied).sum::<f64>();
        let total_borrow = self.pools.values().map(|p| p.total_borrowed).sum::<f64>();

        let utilization_ratio = if total_supply > 0.0 {
            total_borrow / total_supply
        } else {
            0.0
        };

        LendingStats {
            total_supply_usd,
            total_borrow_usd,
            total_collateral_usd,
            utilization_ratio,
            avg_supply_rate: self.pools.values().map(|p| p.supply_rate).sum::<f64>() as f64 / 
                self.pools.len().max(1) as f64,
            avg_borrow_rate: self.pools.values().map(|p| p.borrow_rate).sum::<f64>() as f64 /
                self.pools.len().max(1) as f64,
            active_positions: self.borrow_positions.values()
                .filter(|p| p.status == PositionStatus::Active)
                .count() as u64,
            liquidations_24h: self.liquidations.len() as u64,
        }
    }

    /// Get liquidation history
    pub fn get_liquidations(&self, limit: usize) -> Vec<&Liquidation> {
        self.liquidations.iter().rev().take(limit).collect()
    }
}

impl Default for LendingProtocol {
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
    fn test_supply_and_withdraw() {
        let mut protocol = LendingProtocol::new();
        
        // Supply
        let result = protocol.supply("user1", "USDT", 1000.0);
        assert!(result.is_ok());
        
        // Withdraw
        let result = protocol.withdraw("user1", "USDT", 500.0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_borrow_with_collateral() {
        let mut protocol = LendingProtocol::new();
        
        // Supply collateral (ETH)
        protocol.supply("user1", "ETH", 10.0).unwrap();
        
        // Borrow USDT using ETH as collateral
        let result = protocol.borrow(
            "user1",
            "USDT",
            vec![("ETH".to_string(), 10.0)],
            15000.0, // Borrow $15,000 (within 70% of $30,000 = $21,000)
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_liquidation() {
        let mut protocol = LendingProtocol::new();
        
        // Setup: Supply ETH, borrow USDT
        protocol.supply("user1", "ETH", 1.0).unwrap();
        let borrow = protocol.borrow(
            "user1",
            "USDT",
            vec![("ETH".to_string(), 1.0)],
            2500.0, // Borrow $2,500 against $30,000 ETH = 120% health
        ).unwrap();
        
        // Manually set health factor low to trigger liquidation
        // (in real scenario, price would drop)
        let position = protocol.borrow_positions.get_mut(&format!("{}_{}", "user1", "USDT")).unwrap();
        position.health_factor = 1.0; // Below threshold
        
        // Liquidate
        let result = protocol.liquidate("user1", "USDT", "liquidator1");
        assert!(result.is_ok());
    }

    #[test]
    fn test_interest_accrual() {
        let mut protocol = LendingProtocol::new();
        
        protocol.supply("user1", "USDT", 1000.0).unwrap();
        protocol.supply("user2", "ETH", 1.0).unwrap();
        
        // Accrue 1 year of interest
        protocol.accrue_interest(365 * 24 * 3600);
        
        let position = protocol.get_lending_position("user1", "USDT").unwrap();
        assert!(position.accrued_supply_interest > 0.0);
    }

    #[test]
    fn test_pool_rates() {
        let mut protocol = LendingProtocol::new();
        
        // Initially low utilization
        protocol.supply("user1", "USDT", 10000.0).unwrap();
        
        // High utilization after borrowing
        protocol.borrow("user2", "USDT", vec![("BTC".to_string(), 0.5)], 5000.0).unwrap();
        
        let pool = protocol.get_pool("USDT").unwrap();
        assert!(pool.borrow_rate > pool.supply_rate);
    }
}