//! Constants Module - Rust Implementation
//! 
//! Trading constants and configuration values

use serde::{Serialize, Deserialize};

// ============================================================================
// TRADING CONSTANTS
// ============================================================================

/// Supported trading pairs
pub const TRADING_PAIRS: &[&str] = &[
    "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT",
    "ADA/USDT", "DOGE/USDT", "DOT/USDT", "MATIC/USDT", "LTC/USDT",
];

/// Supported assets
pub const SUPPORTED_ASSETS: &[&str] = &[
    "BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "ADA", 
    "DOGE", "DOT", "MATIC", "LTC", "AVAX", "LINK", "UNI",
];

/// Networks for deposits/withdrawals
pub const NETWORKS: &[&str] = &[
    "Bitcoin", "Ethereum", "BNB Smart Chain", "Solana", "Polygon",
    "Avalanche", "Arbitrum", "Optimism", "Base", "Linea",
];

// ============================================================================
// TRADING PARAMETERS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TradingParams {
    pub min_order_size: f64,
    pub max_order_size: f64,
    pub min_price: f64,
    pub max_price: f64,
    pub price_precision: u8,
    pub quantity_precision: u8,
}

impl Default for TradingParams {
    fn default() -> Self {
        Self {
            min_order_size: 0.00001,
            max_order_size: 1_000_000.0,
            min_price: 0.00000001,
            max_price: 999_999_999.0,
            price_precision: 2,
            quantity_precision: 6,
        }
    }
}

impl TradingParams {
    pub fn for_pair(symbol: &str) -> Self {
        match symbol {
            "BTC/USDT" => Self {
                min_order_size: 0.00001,
                max_order_size: 1000.0,
                price_precision: 2,
                quantity_precision: 6,
                ..Default::default()
            },
            "ETH/USDT" => Self {
                min_order_size: 0.0001,
                max_order_size: 10000.0,
                price_precision: 2,
                quantity_precision: 5,
                ..Default::default()
            },
            _ => Self::default(),
        }
    }
}

// ============================================================================
// FEE STRUCTURE
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeTier {
    pub volume_usd: f64,
    pub maker_fee: f64,
    pub taker_fee: f64,
}

pub const FEE_TIERS: &[FeeTier] = &[
    FeeTier { volume_usd: 0.0, maker_fee: 0.001, taker_fee: 0.001 },
    FeeTier { volume_usd: 100_000.0, maker_fee: 0.0008, taker_fee: 0.0008 },
    FeeTier { volume_usd: 1_000_000.0, maker_fee: 0.0006, taker_fee: 0.0006 },
    FeeTier { volume_usd: 10_000_000.0, maker_fee: 0.0004, taker_fee: 0.0005 },
    FeeTier { volume_usd: 100_000_000.0, maker_fee: 0.0, taker_fee: 0.0004 },
];

// ============================================================================
// LEVERAGE OPTIONS
// ============================================================================

pub const LEVERAGE_OPTIONS: &[f64] = &[1.0, 2.0, 3.0, 5.0, 10.0, 20.0, 25.0, 50.0, 75.0, 100.0];

pub const MAX_LEVERAGE: f64 = 125.0;

// ============================================================================
// TIME IN FORCE
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC, // Immediate Or Cancel
    FOK, // Fill Or Kill
}

// ============================================================================
// ORDER LIMITS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderLimits {
    pub max_orders_per_user: u32,
    pub max_open_orders: u32,
    pub max_conditionals_per_user: u32,
}

impl Default for OrderLimits {
    fn default() -> Self {
        Self {
            max_orders_per_user: 200,
            max_open_orders: 20,
            max_conditionals_per_user: 50,
        }
    }
}

// ============================================================================
// RISK LIMITS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_daily_loss: f64,
    pub max_position_size: f64,
    pub max_open_positions: u32,
    pub maintenance_margin_ratio: f64,
    pub partial_liquidation_ratio: f64,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_daily_loss: 100_000.0,
            max_position_size: 1_000_000.0,
            max_open_positions: 20,
            maintenance_margin_ratio: 0.005,
            partial_liquidation_ratio: 0.01,
        }
    }
}

// ============================================================================
// WITHDRAWAL LIMITS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalLimits {
    pub min_withdrawal: f64,
    pub max_withdrawal: f64,
    pub daily_limit: f64,
    pub monthly_limit: f64,
}

impl Default for WithdrawalLimits {
    fn default() -> Self {
        Self {
            min_withdrawal: 10.0,
            max_withdrawal: 1_000_000.0,
            daily_limit: 10_000_000.0,
            monthly_limit: 100_000_000.0,
        }
    }
}

// ============================================================================
// NETWORK FEES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkFee {
    pub network: String,
    pub symbol: String,
    pub withdraw_fee: f64,
    pub deposit_enabled: bool,
    pub withdraw_enabled: bool,
    pubconfirmations: u32,
}

impl NetworkFee {
    pub const fn btc() -> Self {
        Self {
            network: "Bitcoin".to_string(),
            symbol: "BTC".to_string(),
            withdraw_fee: 0.0005,
            deposit_enabled: true,
            withdraw_enabled: true,
            confirmations: 1,
        }
    }

    pub const fn eth() -> Self {
        Self {
            network: "Ethereum".to_string(),
            symbol: "ETH".to_string(),
            withdraw_fee: 0.005,
            deposit_enabled: true,
            withdraw_enabled: true,
            confirmations: 12,
        }
    }

    pub const fn usdt() -> Self {
        Self {
            network: "Ethereum".to_string(),
            symbol: "USDT".to_string(),
            withdraw_fee: 10.0,
            deposit_enabled: true,
            withdraw_enabled: true,
            confirmations: 19,
        }
    }
}

// ============================================================================
// API CONFIGURATION  
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIConfig {
    pub rate_limit: u32,
    pub rate_limit_burst: u32,
    pub timeout_ms: u32,
    pub max_request_size: usize,
}

impl Default for APIConfig {
    fn default() -> Self {
        Self {
            rate_limit: 1200,
            rate_limit_burst: 10,
            timeout_ms: 30000,
            max_request_size: 1_048_576,
        }
    }
}

// ============================================================================
// WEBSOCKET CONFIGURATION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSConfig {
    pub max_connections: u32,
    pub ping_interval_ms: u32,
    pub max_message_size: usize,
}

impl Default for WSConfig {
    fn default() -> Self {
        Self {
            max_connections: 100_000,
            ping_interval_ms: 30000,
            max_message_size: 1_048_576,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trading_params() {
        let params = TradingParams::for_pair("BTC/USDT");
        assert!(params.min_order_size > 0.0);
    }

    #[test]
    fn test_fee_tiers() {
        assert!(FEE_TIERS.len() > 0);
        assert!(FEE_TIERS[0].maker_fee < FEE_TIERS[1].maker_fee);
    }

    #[test]
    fn test_leverage_options() {
        assert!(LEVERAGE_OPTIONS.contains(&10.0));
        assert!(LEVERAGE_OPTIONS.contains(&100.0));
    }
}