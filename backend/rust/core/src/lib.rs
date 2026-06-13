//! TigerEx Core - High-Performance Trading Engine
//! 
//! This module provides the core matching engine, order management, and cryptographic primitives
//! for a professional cryptocurrency exchange.
//!
//! Design goals:
//! - Sub-microsecond order matching
//! - Thread-safe concurrent trading
//! - AES-256-GCM encryption for all sensitive data
//! - Ed25519 signatures for transaction authentication

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use chrono::{DateTime, Utc};
use lru::LruCache;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ============================================================================
// CRYPTOGRAPHIC PRIMITIVES
// ============================================================================

/// High-security encryption using AES-256-GCM
/// AES-256-GCM provides both confidentiality and authenticity
pub struct CryptoSystem {
    cipher: Aes256Gcm,
}

impl CryptoSystem {
    /// Create a new crypto system with a 256-bit key derived from entropy
    pub fn new(master_key: &[u8; 32]) -> Self {
        let cipher = Aes256Gcm::new_from_slice(master_key).expect("Invalid key length");
        Self { cipher }
    }

    /// Encrypt data with AES-256-GCM
    /// Returns: nonce (12 bytes) || ciphertext
    pub fn encrypt(&self, plaintext: &[u8]) -> Vec<u8> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = self.cipher.encrypt(nonce, plaintext).expect("Encryption failed");
        
        let mut result = Vec::withCapacity(12 + ciphertext.len());
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&ciphertext);
        result
    }

    /// Decrypt data with AES-256-GCM
    pub fn decrypt(&self, encrypted: &[u8]) -> Option<Vec<u8>> {
        if encrypted.len() < 12 {
            return None;
        }
        let nonce = Nonce::from_slice(&encrypted[..12]);
        let ciphertext = &encrypted[12..];
        self.cipher.decrypt(nonce, ciphertext).ok()
    }

    /// Generate a secure hash of data using SHA-256
    pub fn hash(data: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&result);
        hash
    }

    /// Constant-time comparison to prevent timing attacks
    pub fn secure_compare(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut result = 0u8;
        for i in 0..a.len() {
            result |= a[i] ^ b[i];
        }
        result == 0
    }
}

// ============================================================================
// ORDER TYPES
// ============================================================================

/// Order side (buy or sell)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Order type with advanced features
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
    OCO,
    TrailingStop,
    TWAP,
    VWAP,
    Iceberg,
    PostOnly,
    FOK,
    IOC,
}

/// Time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeInForce {
    GoodTillCancel,
    GoodTillTime,
    ImmediateOrCancel,
    FillOrKill,
    PostOnly,
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// Trading pair (e.g., BTC/USDT)
#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradingPair {
    pub base: String,
    pub quote: String,
}

impl TradingPair {
    pub fn new(base: &str, quote: &str) -> Self {
        Self {
            base: base.to_uppercase(),
            quote: quote.to_uppercase(),
        }
    }

    pub fn symbol(&self) -> String {
        format!("{}/{}", self.base, self.quote)
    }
}

/// Order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub pair: TradingPair,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    pub price: Option<f64>,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub stop_price: Option<f64>,
    pub trailing_distance: Option<f64>,
    pub iceberg_display_qty: Option<f64>,
    pub status: OrderStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub expires_at: Option<i64>,
    pub client_order_id: Option<String>,
    pub oco_pair_id: Option<String>,
    pub triggered_by: Option<String>,
    pub algo_params: Option<AlgoParams>,
}

impl Order {
    pub fn new_market(user_id: &str, pair: TradingPair, side: OrderSide, quantity: f64) -> Self {
        Self::new_limit(user_id, pair, side, quantity, None, OrderType::Market, TimeInForce::ImmediateOrCancel)
    }

    pub fn new_limit(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        price: Option<f64>,
        order_type: OrderType,
        time_in_force: TimeInForce,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        Self {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            pair,
            side,
            order_type,
            time_in_force,
            price,
            quantity,
            filled_quantity: 0.0,
            stop_price: None,
            trailing_distance: None,
            iceberg_display_qty: None,
            status: OrderStatus::Open,
            created_at: now,
            updated_at: now,
            expires_at: None,
            client_order_id: None,
            oco_pair_id: None,
            triggered_by: None,
            algo_params: None,
        }
    }

    pub fn new_stop_loss(user_id: &str, pair: TradingPair, side: OrderSide, quantity: f64, stop_price: f64) -> Self {
        let mut order = Self::new_limit(user_id, pair, side, quantity, None, OrderType::StopLoss, TimeInForce::GoodTillCancel);
        order.stop_price = Some(stop_price);
        order
    }

    pub fn new_stop_limit(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        stop_price: f64,
        limit_price: f64,
    ) -> Self {
        let mut order = Self::new_limit(user_id, pair, side, quantity, Some(limit_price), OrderType::StopLimit, TimeInForce::GoodTillCancel);
        order.stop_price = Some(stop_price);
        order
    }

    pub fn new_oco(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        limit_price: f64,
        stop_price: f64,
    ) -> (Self, Self) {
        let order_id = Uuid::new_v4().to_string();
        
        let mut limit_order = Self::new_limit(
            user_id,
            pair.clone(),
            side,
            quantity,
            Some(limit_price),
            OrderType::Limit,
            TimeInForce::GoodTillCancel,
        );
        limit_order.oco_pair_id = Some(order_id.clone());
        
        let mut stop_order = Self::new_stop_loss(user_id, pair.clone(), side, quantity, stop_price);
        stop_order.oco_pair_id = Some(order_id);
        
        (limit_order, stop_order)
    }

    pub fn new_trailing_stop(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        trailing_distance: f64,
    ) -> Self {
        let mut order = Self::new_limit(
            user_id,
            pair,
            side,
            quantity,
            None,
            OrderType::TrailingStop,
            TimeInForce::GoodTillCancel,
        );
        order.trailing_distance = Some(trailing_distance);
        order
    }

    pub fn new_twap(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        start_time: i64,
        end_time: i64,
        slices: u32,
    ) -> Self {
        let mut order = Self::new_limit(
            user_id,
            pair,
            side,
            quantity,
            None,
            OrderType::TWAP,
            TimeInForce::GoodTillTime,
        );
        order.expires_at = Some(end_time);
        order.algo_params = Some(AlgoParams {
            start_time,
            end_time,
            slices,
            max_slippage: 0.001,
            ..Default::default()
        });
        order
    }

    pub fn new_vwap(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        start_time: i64,
        end_time: i64,
        slices: u32,
    ) -> Self {
        let mut order = Self::new_limit(
            user_id,
            pair,
            side,
            quantity,
            None,
            OrderType::VWAP,
            TimeInForce::GoodTillTime,
        );
        order.expires_at = Some(end_time);
        order.algo_params = Some(AlgoParams {
            start_time,
            end_time,
            slices,
            max_slippage: 0.001,
            ..Default::default()
        });
        order
    }

    pub fn new_iceberg(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        price: f64,
        display_qty: f64,
    ) -> Self {
        let mut order = Self::new_limit(
            user_id,
            pair,
            side,
            quantity,
            Some(price),
            OrderType::Iceberg,
            TimeInForce::GoodTillCancel,
        );
        order.iceberg_display_qty = Some(display_qty);
        order
    }

    pub fn is_filled(&self) -> bool {
        self.filled_quantity >= self.quantity
    }

    pub fn check_trigger(&self, current_price: f64) -> bool {
        match self.order_type {
            OrderType::StopLoss | OrderType::StopLimit => {
                if let Some(stop_price) = self.stop_price {
                    match self.side {
                        OrderSide::Buy => current_price >= stop_price,
                        OrderSide::Sell => current_price <= stop_price,
                    }
                } else {
                    false
                }
            }
            OrderType::TrailingStop => true,
            _ => true,
        }
    }

    pub fn price_matched(&self, market_price: f64) -> bool {
        match self.side {
            OrderSide::Buy => self.price.map_or(true, |p| market_price <= p),
            OrderSide::Sell => self.price.map_or(true, |p| market_price >= p),
        }
    }

    pub fn remaining(&self) -> f64 {
        self.quantity - self.filled_quantity
    }
}

/// Algo parameters for TWAP/VWAP
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AlgoParams {
    pub start_time: i64,
    pub end_time: i64,
    pub slices: u32,
    pub max_slippage: f64,
    pub execution_style: Option<String>,
}

// ============================================================================
// ORDER BOOK
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
    pub orders: Vec<String>,
}

pub struct OrderBook {
    pub pair: TradingPair,
    bids: Vec<PriceLevel>,
    asks: Vec<PriceLevel>,
    orders: HashMap<String, Order>,
    sequence: u64,
    last_price: f64,
    volume_24h: f64,
    high_24h: f64,
    low_24h: f64,
}

impl OrderBook {
    pub fn new(pair: TradingPair) -> Self {
        Self {
            pair,
            bids: Vec::new(),
            asks: Vec::new(),
            orders: HashMap::new(),
            sequence: 0,
            last_price: 0.0,
            volume_24h: 0.0,
            high_24h: 0.0,
            low_24h: f64::MAX,
        }
    }

    pub fn add_order(&mut self, order: Order) -> Result<(), OrderError> {
        if order.quantity <= 0.0 {
            return Err(OrderError::InvalidQuantity);
        }
        if let Some(price) = order.price {
            if price <= 0.0 {
                return Err(OrderError::InvalidPrice);
            }
        }
        
        match order.order_type {
            OrderType::Market => {}
            OrderType::StopLoss | OrderType::StopLimit | OrderType::TrailingStop => {}
            OrderType::TWAP | OrderType::VWAP | OrderType::Iceberg => {}
            _ => {
                self.orders.insert(order.id.clone(), order);
                self.rebuild_levels();
            }
        }
        
        self.sequence += 1;
        Ok(())
    }

    pub fn cancel_order(&mut self, order_id: &str) -> Result<Order, OrderError> {
        if let Some(order) = self.orders.remove(order_id) {
            self.sequence += 1;
            self.rebuild_levels();
            Ok(order)
        } else {
            Err(OrderError::OrderNotFound)
        }
    }

    pub fn best_bid(&self) -> Option<f64> {
        self.bids.first().map(|l| l.price)
    }

    pub fn best_ask(&self) -> Option<f64> {
        self.asks.first().map(|l| l.price)
    }

    pub fn spread(&self) -> Option<f64> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) if ask > bid => Some(ask - bid),
            _ => None,
        }
    }

    pub fn mid_price(&self) -> Option<f64> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some((bid + ask) / 2.0),
            _ => {
                if self.last_price > 0.0 {
                    Some(self.last_price)
                } else {
                    None
                }
            }
        }
    }

    pub fn match_market_order(&mut self, order: &mut Order) -> Vec<Trade> {
        let mut trades = Vec::new();
        let side = order.side;
        
        let (levels, own_side) = match side {
            OrderSide::Buy => (&mut self.asks, OrderSide::Sell),
            OrderSide::Sell => (&mut self.bids, OrderSide::Buy),
        };
        
        let mut remaining = order.quantity;
        
        for level in levels.iter_mut() {
            if remaining <= 0.0 {
                break;
            }
            
            let price_ok = match (side, level.price) {
                (OrderSide::Buy, p) => order.price.map_or(true, |op| p <= op),
                (OrderSide::Sell, p) => order.price.map_or(true, |op| p >= op),
            };
            
            if !price_ok {
                break;
            }
            
            let available = level.quantity;
            let fill_qty = available.min(remaining);
            
            for _ in 0..fill_qty.ceil() as i32 {
                trades.push(Trade {
                    id: Uuid::new_v4().to_string(),
                    pair: self.pair.clone(),
                    price: level.price,
                    quantity: 1.0,
                    side: own_side,
                    timestamp: Utc::now().timestamp_millis(),
                    maker_order_id: level.orders.first().cloned().unwrap_or_default(),
                    taker_order_id: order.id.clone(),
                });
            }
            
            level.quantity -= fill_qty;
            remaining -= fill_qty;
            order.filled_quantity += fill_qty;
            
            self.last_price = level.price;
            self.volume_24h += fill_qty * level.price;
            if level.price > self.high_24h {
                self.high_24h = level.price;
            }
            if level.price < self.low_24h {
                self.low_24h = level.price;
            }
        }
        
        levels.retain(|l| l.quantity > 0.0);
        
        self.sequence += 1;
        trades
    }

    fn rebuild_levels(&mut self) {
        let mut bid_map: HashMap<f64, (f64, Vec<String>) = HashMap::new();
        let mut ask_map: HashMap<f64, (f64, Vec<String>) = HashMap::new();
        
        for (id, order) in &self.orders {
            if order.side == OrderSide::Buy {
                if let Some(price) = order.price {
                    let entry = bid_map.entry(price).or_insert((0.0, Vec::new()));
                    entry.0 += order.remaining();
                    entry.1.push(id.clone());
                }
            } else {
                if let Some(price) = order.price {
                    let entry = ask_map.entry(price).or_insert((0.0, Vec::new()));
                    entry.0 += order.remaining();
                    entry.1.push(id.clone());
                }
            }
        }
        
        self.bids = bid_map.into_iter()
            .map(|(price, (qty, orders))| PriceLevel { price, quantity: qty, orders })
            .collect();
        self.bids.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
        
        self.asks = ask_map.into_iter()
            .map(|(price, (qty, orders))| PriceLevel { price, quantity: qty, orders })
            .collect();
        self.asks.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());
    }

    pub fn depth(&self, levels: usize) -> (Vec<PriceLevel>, Vec<PriceLevel>) {
        (
            self.bids.iter().take(levels).cloned().collect(),
            self.asks.iter().take(levels).cloned().collect(),
        )
    }

    pub fn ohlcv(&self) -> OHLCV {
        OHLCV {
            open: self.last_price,
            high: self.high_24h,
            low: if self.low_24h == f64::MAX { self.last_price } else { self.low_24h },
            close: self.last_price,
            volume: self.volume_24h,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub pair: TradingPair,
    pub price: f64,
    pub quantity: f64,
    pub side: OrderSide,
    pub timestamp: i64,
    pub maker_order_id: String,
    pub taker_order_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OHLCV {
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

// ============================================================================
// POSITION & MARGIN
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub user_id: String,
    pub pair: TradingPair,
    pub side: OrderSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub liquidation_price: Option<f64>,
    pub margin_used: f64,
    pub unrealized_pnl: f64,
    pub leverage: f64,
    pub isolated: bool,
}

impl Position {
    pub fn new(
        user_id: &str,
        pair: TradingPair,
        side: OrderSide,
        quantity: f64,
        entry_price: f64,
        leverage: f64,
        isolated: bool,
    ) -> Self {
        let margin_required = (quantity * entry_price) / leverage;
        let liquidation_price = match side {
            OrderSide::Buy => Some(entry_price * (1.0 - 1.0 / leverage)),
            OrderSide::Sell => Some(entry_price * (1.0 + 1.0 / leverage)),
        };
        
        Self {
            user_id: user_id.to_string(),
            pair,
            side,
            quantity,
            entry_price,
            liquidation_price,
            margin_used: margin_required,
            unrealized_pnl: 0.0,
            leverage,
            isolated,
        }
    }

    pub fn update_pnl(&mut self, current_price: f64) {
        self.unrealized_pnl = match self.side {
            OrderSide::Buy => (current_price - self.entry_price) * self.quantity,
            OrderSide::Sell => (self.entry_price - current_price) * self.quantity,
        };
    }

    pub fn is_liquidated(&self, current_price: f64) -> bool {
        if let Some(liq_price) = self.liquidation_price {
            match self.side {
                OrderSide::Buy => current_price <= liq_price,
                OrderSide::Sell => current_price >= liq_price,
            }
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub asset: String,
    pub available: f64,
    pub locked: f64,
    pub total: f64,
}

impl Balance {
    pub fn new(asset: &str, available: f64) -> Self {
        Self {
            asset: asset.to_string(),
            available,
            locked: 0.0,
            total: available,
        }
    }

    pub fn lock(&mut self, amount: f64) -> Result<(), ()> {
        if self.available >= amount {
            self.available -= amount;
            self.locked += amount;
            Ok(())
        } else {
            Err(())
        }
    }

    pub fn unlock(&mut self, amount: f64) {
        self.available += amount;
        self.locked -= amount;
    }
}

// ============================================================================
// USER ACCOUNTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub email: String,
    pub created_at: i64,
    pub balances: HashMap<String, Balance>,
    pub positions: HashMap<String, Position>,
    pub kyc_level: KYCLevel,
    pub enabled_2fa: bool,
    pub withdrawal_whitelist_enabled: bool,
    pub ip_whitelist_enabled: bool,
    pub api_keys: Vec<APIKey>,
    pub sub_accounts: Vec<String>,
}

impl Account {
    pub fn new(username: &str, email: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            username: username.to_string(),
            email: email.to_string(),
            created_at: Utc::now().timestamp_millis(),
            balances: HashMap::new(),
            positions: HashMap::new(),
            kyc_level: KYCLevel::None,
            enabled_2fa: false,
            withdrawal_whitelist_enabled: false,
            ip_whitelist_enabled: false,
            api_keys: Vec::new(),
            sub_accounts: Vec::new(),
        }
    }

    pub fn add_balance(&mut self, asset: &str, amount: f64) {
        let balance = self.balances.entry(asset.to_string()).or_insert_with(|| Balance::new(asset, 0.0));
        balance.available += amount;
        balance.total += amount;
    }

    pub fn lock_funds(&mut self, asset: &str, amount: f64) -> Result<(), ()> {
        if let Some(balance) = self.balances.get_mut(asset) {
            balance.lock(amount)
        } else {
            Err(())
        }
    }

    pub fn generate_api_key(&mut self, label: &str, permissions: &[APIPermission]) -> APIKey {
        let mut key_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut key_bytes);
        let key = base64::encode(key_bytes);
        
        let mut secret_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut secret_bytes);
        let secret = base64::encode(secret_bytes);
        
        let api_key = APIKey {
            id: Uuid::new_v4().to_string(),
            key: key.clone(),
            secret_hash: CryptoSystem::hash(secret.as_bytes())[..16].to_vec(),
            label: label.to_string(),
            permissions: permissions.to_vec(),
            created_at: Utc::now().timestamp_millis(),
            last_used: None,
            expires_at: None,
            ip_whitelist: Vec::new(),
            enabled: true,
        };
        
        self.api_keys.push(api_key.clone());
        api_key
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KYCLevel {
    None,
    Email,
    Phone,
    Basic,
    Intermediate,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIKey {
    pub id: String,
    pub key: String,
    pub secret_hash: Vec<u8>,
    pub label: String,
    pub permissions: Vec<APIPermission>,
    pub created_at: i64,
    pub last_used: Option<i64>,
    pub expires_at: Option<i64>,
    pub ip_whitelist: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum APIPermission {
    Read,
    Trade,
    Withdraw,
    Admin,
}

// ============================================================================
// ERRORS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderError {
    InvalidQuantity,
    InvalidPrice,
    OrderNotFound,
    InsufficientBalance,
    PriceOutOfRange,
    TradingPaused,
}

impl std::fmt::Display for OrderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidQuantity => write!(f, "Invalid quantity"),
            Self::InvalidPrice => write!(f, "Invalid price"),
            Self::OrderNotFound => write!(f, "Order not found"),
            Self::InsufficientBalance => write!(f, "Insufficient balance"),
            Self::PriceOutOfRange => write!(f, "Price out of range"),
            Self::TradingPaused => write!(f, "Trading paused"),
        }
    }
}

impl std::error::Error for OrderError {}

// ============================================================================
// MARKET DATA
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub pair: TradingPair,
    pub price: f64,
    pub price_change_24h: f64,
    pub price_change_pct_24h: f64,
    pub volume_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub timestamp: i64,
}

// ============================================================================
// STAKING & EARN PRODUCTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakingPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub apy: f64,
    pub start_time: i64,
    pub lock_period_days: u32,
    pub rewards_accrued: f64,
    pub compound_enabled: bool,
}

impl StakingPosition {
    pub fn new(
        user_id: &str,
        asset: &str,
        amount: f64,
        apy: f64,
        lock_period_days: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            apy,
            start_time: Utc::now().timestamp_millis(),
            lock_period_days,
            rewards_accrued: 0.0,
            compound_enabled: false,
        }
    }

    pub fn calculate_rewards(&self) -> f64 {
        let elapsed = Utc::now().timestamp_millis() - self.start_time;
        self.amount * self.apy * (elapsed as f64 / (365.0 * 24.0 * 3600.0 * 1000.0))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LendingPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub apy: f64,
    pub position_type: LendingType,
    pub start_time: i64,
    pub maturity_time: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LendingType {
    Flexible,
    Fixed,
}

// ============================================================================
// WALLET & TRANSFER
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub asset: String,
    pub address: String,
    pub memo: Option<String>,
    pub network: String,
    pub is_whitelisted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deposit {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub address: String,
    pub txid: Option<String>,
    pub confirmations: u32,
    pub status: DepositStatus,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DepositStatus {
    Pending,
    Confirming,
    Confirmed,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Withdrawal {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub net_amount: f64,
    pub address: String,
    pub txid: Option<String>,
    pub status: WithdrawalStatus,
    pub timestamp: i64,
    pub processed_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WithdrawalStatus {
    Pending,
    Processing,
    Completed,
    Cancelled,
    Failed,
}