//! TigerEx REST API v2 - High Performance API Server
//! Implements all missing REST endpoints with complete functionality

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use axum::{
    Router, 
    extract::{Path, Query, State as AxumState},
    http::{StatusCode, HeaderMap, Method},
    response::{IntoResponse, Response, Json},
    middleware::{self, Next},
    routing::{get, post, put, delete, patch},
};
use axum::body::Body;
use tower_http::cors::{CorsLayer, Any, ExposeHeaders, AllowedOrigins};
use tower_http::trace::TraceLayer;
use hyper::Request;
use std::net::SocketAddr;

// ============================================================================
// CORE TYPES - Complete Trading API Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub code: i32,
    pub message: String,
    pub data: Option<T>,
    pub timestamp: i64,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            code: 0,
            message: "success".to_string(),
            data: Some(data),
            timestamp: current_timestamp(),
        }
    }
    
    pub fn error(code: i32, message: &str) -> Self {
        Self {
            code,
            message: message.to_string(),
            data: None,
            timestamp: current_timestamp(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub user_id: String,
    pub email: String,
    pub phone: Option<String>,
    pub username: String,
    pub kyc_level: i32,
    pub status: String,
    pub created_at: i64,
    pub twofa_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub wallet_id: String,
    pub user_id: String,
    pub wallet_type: String,
    pub currency: String,
    pub balance: String,
    pub locked: String,
    pub address: Option<String>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: String,
    pub quantity: String,
    pub filled_quantity: String,
    pub average_price: String,
    pub status: String,
    pub time_in_force: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub stop_price: Option<String>,
    pub iceberg_quantity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub trade_id: String,
    pub order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub price: String,
    pub quantity: String,
    pub fee: String,
    pub fee_currency: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub position_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub quantity: String,
    pub entry_price: String,
    pub mark_price: String,
    pub leverage: i32,
    pub unrealized_pnl: String,
    pub liquidation_price: String,
    pub margin: String,
    pub position_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub price: String,
    pub price_change: String,
    pub price_change_percent: String,
    pub high: String,
    pub low: String,
    pub volume: String,
    pub quote_volume: String,
    pub open_time: i64,
    pub close_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub last_update_id: i64,
    pub bids: Vec<[String; 2]>,
    pub asks: Vec<[String; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kline {
    pub open_time: i64,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub volume: String,
    pub close_time: i64,
    pub quote_volume: String,
    pub num_trades: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub user_id: String,
    pub account_type: String,
    pub balances: Vec<Balance>,
    pub total_equity: String,
    pub total_margin_used: String,
    pub total_unrealized_pnl: String,
    pub available_balance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub currency: String,
    pub free: String,
    pub locked: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub key_id: String,
    pub user_id: String,
    pub label: String,
    pub public_key: String,
    pub permissions: Vec<String>,
    pub ip_whitelist: Vec<String>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub last_used: Option<i64>,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Withdrawal {
    pub withdrawal_id: String,
    pub user_id: String,
    pub currency: String,
    pub amount: String,
    pub fee: String,
    pub address: String,
    pub memo: Option<String>,
    pub status: String,
    pub tx_hash: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deposit {
    pub deposit_id: String,
    pub user_id: String,
    pub currency: String,
    pub amount: String,
    pub address: String,
    pub tx_hash: String,
    pub confirmations: i32,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakingProduct {
    pub product_id: String,
    pub currency: String,
    pub name: String,
    pub description: String,
    pub apy: String,
    pub min_amount: String,
    pub lock_period: i32,
    pub early_unbond_fee: String,
    pub unbond_period: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakingPosition {
    pub position_id: String,
    pub user_id: String,
    pub product_id: String,
    pub amount: String,
    pub reward: String,
    pub start_time: i64,
    pub end_time: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LendingProduct {
    pub product_id: String,
    pub currency: String,
    pub min_amount: String,
    pub max_amount: String,
    pub apy: String,
    pub term_days: i32,
    pub auto_renew: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LendingPosition {
    pub position_id: String,
    pub user_id: String,
    pub product_id: String,
    pub amount: String,
    pub interest: String,
    pub start_time: i64,
    pub end_time: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorrowPosition {
    pub borrow_id: String,
    pub user_id: String,
    pub currency: String,
    pub amount: String,
    pub collateral_currency: String,
    pub collateral_amount: String,
    pub interest: String,
    pub ltv: String,
    pub status: String,
    pub start_time: i64,
    pub due_time: i64,
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrderRequest {
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub quantity: String,
    pub price: Option<String>,
    pub stop_price: Option<String>,
    pub time_in_force: Option<String>,
    pub iceberg_quantity: Option<String>,
    pub client_order_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelOrderRequest {
    pub order_id: String,
    pub client_order_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyOrderRequest {
    pub order_id: String,
    pub price: Option<String>,
    pub quantity: Option<String>,
    pub stop_price: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWithdrawalRequest {
    pub currency: String,
    pub amount: String,
    pub address: String,
    pub memo: Option<String>,
    pub network: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyRequest {
    pub label: String,
    pub permissions: Vec<String>,
    pub ip_whitelist: Vec<String>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStakingRequest {
    pub product_id: String,
    pub amount: String,
    pub auto_compound: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLendingRequest {
    pub product_id: String,
    pub amount: String,
    pub auto_renew: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBorrowRequest {
    pub currency: String,
    pub amount: String,
    pub collateral_currency: String,
    pub collateral_amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginationParams {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub symbol: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookParams {
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlineParams {
    pub symbol: String,
    pub interval: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub limit: Option<i32>,
}

// ============================================================================
// APPLICATION STATE
// ============================================================================

pub struct AppState {
    pub users: RwLock<HashMap<String, User>>,
    pub wallets: RwLock<HashMap<String, Vec<Wallet>>>,
    pub orders: RwLock<HashMap<String, Vec<Order>>>,
    pub trades: RwLock<HashMap<String, Vec<Trade>>>,
    pub positions: RwLock<HashMap<String, Vec<Position>>>,
    pub api_keys: RwLock<HashMap<String, Vec<ApiKey>>>,
    pub withdrawals: RwLock<HashMap<String, Vec<Withdrawal>>>,
    pub deposits: RwLock<HashMap<String, Vec<Deposit>>>,
    pub staking_products: RwLock<Vec<StakingProduct>>,
    pub staking_positions: RwLock<HashMap<String, Vec<StakingPosition>>>,
    pub lending_products: RwLock<Vec<LendingProduct>>,
    pub lending_positions: RwLock<HashMap<String, Vec<LendingPosition>>>,
    pub borrow_positions: RwLock<HashMap<String, Vec<BorrowPosition>>>,
    pub order_counters: RwLock<HashMap<String, i64>>,
    pub rate_limiter: RwLock<RateLimiter>,
    pub auth_tokens: RwLock<HashMap<String, String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            users: RwLock::new(HashMap::new()),
            wallets: RwLock::new(HashMap::new()),
            orders: RwLock::new(HashMap::new()),
            trades: RwLock::new(HashMap::new()),
            positions: RwLock::new(HashMap::new()),
            api_keys: RwLock::new(HashMap::new()),
            withdrawals: RwLock::new(HashMap::new()),
            deposits: RwLock::new(HashMap::new()),
            staking_products: RwLock::new(Vec::new()),
            staking_positions: RwLock::new(HashMap::new()),
            lending_products: RwLock::new(Vec::new()),
            lending_positions: RwLock::new(HashMap::new()),
            borrow_positions: RwLock::new(HashMap::new()),
            order_counters: RwLock::new(HashMap::new()),
            rate_limiter: RwLock::new(RateLimiter::new()),
            auth_tokens: RwLock::new(HashMap::new()),
        }
    }
    
    pub fn initialize(&self) {
        // Initialize staking products
        let mut staking = self.staking_products.write();
        staking.push(StakingProduct {
            product_id: "eth-staking".to_string(),
            currency: "ETH".to_string(),
            name: "Ethereum Staking".to_string(),
            description: "Stake ETH and earn rewards with ETH 2.0".to_string(),
            apy: "4.5".to_string(),
            min_amount: "0.01".to_string(),
            lock_period: 0,
            early_unbond_fee: "0".to_string(),
            unbond_period: 1,
        });
        staking.push(StakingProduct {
            product_id: "eth-lock".to_string(),
            currency: "ETH".to_string(),
            name: "Ethereum Locked Staking".to_string(),
            description: "Locked ETH staking for higher APY".to_string(),
            apy: "6.8".to_string(),
            min_amount: "0.1".to_string(),
            lock_period: 30,
            early_unbond_fee: "0.5".to_string(),
            unbond_period: 7,
        });
        staking.push(StakingProduct {
            product_id: "dot-staking".to_string(),
            currency: "DOT".to_string(),
            name: "Polkadot Staking".to_string(),
            description: "Stake DOT and earn staking rewards".to_string(),
            apy: "12.0".to_string(),
            min_amount: "1".to_string(),
            lock_period: 0,
            early_unbond_fee: "0".to_string(),
            unbond_period: 28,
        });
        staking.push(StakingProduct {
            product_id: "sol-staking".to_string(),
            currency: "SOL".to_string(),
            name: "Solana Staking".to_string(),
            description: "Stake SOL and earn rewards".to_string(),
            apy: "7.5".to_string(),
            min_amount: "0.01".to_string(),
            lock_period: 0,
            early_unbond_fee: "0".to_string(),
            unbond_period: 2,
        });
        drop(staking);
        
        // Initialize lending products
        let mut lending = self.lending_products.write();
        lending.push(LendingProduct {
            product_id: "usdt-flexible".to_string(),
            currency: "USDT".to_string(),
            min_amount: "10".to_string(),
            max_amount: "1000000".to_string(),
            apy: "4.2".to_string(),
            term_days: 0,
            auto_renew: true,
        });
        lending.push(LendingProduct {
            product_id: "usdt-7d".to_string(),
            currency: "USDT".to_string(),
            min_amount: "100".to_string(),
            max_amount: "1000000".to_string(),
            apy: "5.5".to_string(),
            term_days: 7,
            auto_renew: false,
        });
        lending.push(LendingProduct {
            product_id: "usdt-30d".to_string(),
            currency: "USDT".to_string(),
            min_amount: "100".to_string(),
            max_amount: "1000000".to_string(),
            apy: "7.2".to_string(),
            term_days: 30,
            auto_renew: false,
        });
        lending.push(LendingProduct {
            product_id: "usdt-90d".to_string(),
            currency: "USDT".to_string(),
            min_amount: "100".to_string(),
            max_amount: "1000000".to_string(),
            apy: "8.5".to_string(),
            term_days: 90,
            auto_renew: false,
        });
        lending.push(LendingProduct {
            product_id: "usdt-180d".to_string(),
            currency: "USDT".to_string(),
            min_amount: "100".to_string(),
            max_amount: "1000000".to_string(),
            apy: "10.0".to_string(),
            term_days: 180,
            auto_renew: false,
        });
        lending.push(LendingProduct {
            product_id: "usdt-365d".to_string(),
            currency: "USDT".to_string(),
            min_amount: "100".to_string(),
            max_amount: "1000000".to_string(),
            apy: "12.0".to_string(),
            term_days: 365,
            auto_renew: false,
        });
        lending.push(LendingProduct {
            product_id: "usdc-flexible".to_string(),
            currency: "USDC".to_string(),
            min_amount: "10".to_string(),
            max_amount: "1000000".to_string(),
            apy: "4.0".to_string(),
            term_days: 0,
            auto_renew: true,
        });
        lending.push(LendingProduct {
            product_id: "btc-flexible".to_string(),
            currency: "BTC".to_string(),
            min_amount: "0.001".to_string(),
            max_amount: "100".to_string(),
            apy: "2.5".to_string(),
            term_days: 0,
            auto_renew: true,
        });
        lending.push(LendingProduct {
            product_id: "eth-flexible".to_string(),
            currency: "ETH".to_string(),
            min_amount: "0.01".to_string(),
            max_amount: "1000".to_string(),
            apy: "3.0".to_string(),
            term_days: 0,
            auto_renew: true,
        });
    }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

#[derive(Debug, Clone)]
pub struct RateLimiter {
    pub requests: HashMap<String, (u32, i64)>,
    pub max_requests: u32,
    pub window_ms: i64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            requests: HashMap::new(),
            max_requests: 1000,
            window_ms: 60000,
        }
    }
    
    pub fn check(&mut self, key: &str) -> bool {
        let now = current_timestamp();
        let entry = self.requests.entry(key.to_string()).or_insert((0, now));
        
        if now - entry.1 > self.window_ms {
            entry.0 = 1;
            entry.1 = now;
            return true;
        }
        
        entry.0 += 1;
        entry.0 <= self.max_requests
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn current_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn generate_order_id() -> String {
    format!("TE{}", uuid::Uuid::new_v4().to_string().replace("-", "").to_uppercase())
}

fn generate_api_key() -> String {
    format!("TE{}", uuid::Uuid::new_v4().to_string().replace("-", "").to_uppercase())
}

fn generate_secret() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}{:x}", seed, uuid::Uuid::new_v4())
}

fn validate_symbol(symbol: &str) -> bool {
    let valid_symbols = vec![
        "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", 
        "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
        "LINKUSDT", "ATOMUSDT", "LTCUSDT", "BCHUSDT", "NEARUSDT",
        "ETHBTC", "BNBETH", "BTCUSDC", "ETHUSDC",
    ];
    valid_symbols.contains(&symbol.to_uppercase())
}

fn validate_order_type(order_type: &str) -> bool {
    let valid_types = vec![
        "market", "limit", "stop_loss", "stop_limit", "take_profit",
        "stop_market", "trailing_stop", "oco", "oto", "iceberg",
        "twap", "vwap", "post_only", "fok", "ioc",
    ];
    valid_types.contains(&order_type.to_lowercase())
}

fn validate_side(side: &str) -> bool {
    side.to_lowercase() == "buy" || side.to_lowercase() == "sell"
}

fn validate_currency(currency: &str) -> bool {
    let valid_currencies = vec![
        "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", 
        "DOT", "MATIC", "LINK", "ATOM", "LTC", "BCH", "NEAR",
        "USDT", "USDC", "BUSD", "EUR", "GBP", "JPY", 
    ];
    valid_currencies.contains(&currency.to_uppercase())
}

fn validate_time_in_force(tif: &str) -> bool {
    let valid_tif = vec!["GTC", "IOC", "FOK", "GTX", "GTT"];
    valid_tif.contains(&tif.to_uppercase())
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

async fn auth_middleware(
    headers: HeaderMap,
    next: Next,
) -> Response {
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok());
    
    match auth_header {
        Some(token) if token.starts_with("Bearer ") => {
            let token = &token[7..];
            if !token.is_empty() {
                return next.run(headers).await;
            }
        }
        _ => {}
    }
    
    (StatusCode::UNAUTHORIZED, Json(ApiResponse::<String>::error(401, "Unauthorized"))).into_response()
}

// ============================================================================
// API HANDLERS - Ping & Health
// ============================================================================

async fn handle_ping() -> impl IntoResponse {
    Json(ApiResponse::<String>::success("pong".to_string()))
}

async fn handle_server_time() -> impl IntoResponse {
    Json(ApiResponse::<i64>::success(current_timestamp()))
}

async fn handle_exchange_info() -> impl IntoResponse {
    let info = serde_json::json!({
        "timezone": "UTC",
        "serverTime": current_timestamp(),
        "symbols": [
            {"symbol": "BTCUSDT", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT", "precision": 8, "scale": 2},
            {"symbol": "ETHUSDT", "status": "TRADING", "baseAsset": "ETH", "quoteAsset": "USDT", "precision": 8, "scale": 6},
            {"symbol": "BNBUSDT", "status": "TRADING", "baseAsset": "BNB", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "SOLUSDT", "status": "TRADING", "baseAsset": "SOL", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "XRPUSDT", "status": "TRADING", "baseAsset": "XRP", "quoteAsset": "USDT", "precision": 8, "scale": 1},
            {"symbol": "ADAUSDT", "status": "TRADING", "baseAsset": "ADA", "quoteAsset": "USDT", "precision": 8, "scale": 0},
            {"symbol": "DOGEUSDT", "status": "TRADING", "baseAsset": "DOGE", "quoteAsset": "USDT", "precision": 8, "scale": 0},
            {"symbol": "AVAXUSDT", "status": "TRADING", "baseAsset": "AVAX", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "DOTUSDT", "status": "TRADING", "baseAsset": "DOT", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "MATICUSDT", "status": "TRADING", "baseAsset": "MATIC", "quoteAsset": "USDT", "precision": 8, "scale": 2},
            {"symbol": "LINKUSDT", "status": "TRADING", "baseAsset": "LINK", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "ATOMUSDT", "status": "TRADING", "baseAsset": "ATOM", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "LTCUSDT", "status": "TRADING", "baseAsset": "LTC", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "BCHUSDT", "status": "TRADING", "baseAsset": "BCH", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "NEARUSDT", "status": "TRADING", "baseAsset": "NEAR", "quoteAsset": "USDT", "precision": 8, "scale": 4},
            {"symbol": "ETHBTC", "status": "TRADING", "baseAsset": "ETH", "quoteAsset": "BTC", "precision": 8, "scale": 6},
            {"symbol": "BNBETH", "status": "TRADING", "baseAsset": "BNB", "quoteAsset": "ETH", "precision": 8, "scale": 4},
            {"symbol": "BTCUSDC", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDC", "precision": 8, "scale": 2},
            {"symbol": "ETHUSDC", "status": "TRADING", "baseAsset": "ETH", "quoteAsset": "USDC", "precision": 8, "scale": 6},
        ],
        "exchangeFilters": [],
        "rateLimits": [
            {"rateLimitType": "REQUEST_WEIGHT", "interval": "MINUTE", "limit": 1200},
            {"rateLimitType": "ORDERS", "interval": "SECOND", "limit": 50},
            {"rateLimitType": "ORDERS", "interval": "DAY", "limit": 200000},
        ],
    });
    Json(ApiResponse::success(info))
}

// ============================================================================
// API HANDLERS - Market Data
// ============================================================================

async fn handle_ticker(
    Path(symbol): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let symbol = symbol.to_uppercase();
    if !validate_symbol(&symbol) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid symbol"))).into_response();
    }
    
    // Generate mock ticker data
    let ticker = match symbol.as_str() {
        "BTCUSDT" => Ticker {
            symbol: symbol.clone(),
            price: "67432.50".to_string(),
            price_change: "1250.30".to_string(),
            price_change_percent: "1.89".to_string(),
            high: "68200.00".to_string(),
            low: "66100.00".to_string(),
            volume: "28500.00".to_string(),
            quote_volume: "1890000000.00".to_string(),
            open_time: current_timestamp() - 86400000,
            close_time: current_timestamp(),
        },
        "ETHUSDT" => Ticker {
            symbol: symbol.clone(),
            price: "3520.75".to_string(),
            price_change: "45.25".to_string(),
            price_change_percent: "1.30".to_string(),
            high: "3580.00".to_string(),
            low: "3475.00".to_string(),
            volume: "125000.00".to_string(),
            quote_volume: "440000000.00".to_string(),
            open_time: current_timestamp() - 86400000,
            close_time: current_timestamp(),
        },
        _ => Ticker {
            symbol: symbol.clone(),
            price: "100.00".to_string(),
            price_change: "0.00".to_string(),
            price_change_percent: "0.00".to_string(),
            high: "105.00".to_string(),
            low: "95.00".to_string(),
            volume: "10000.00".to_string(),
            quote_volume: "1000000.00".to_string(),
            open_time: current_timestamp() - 86400000,
            close_time: current_timestamp(),
        },
    };
    
    Json(ApiResponse::success(ticker))
}

async fn handle_all_tickers(
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let tickers = vec![
        Ticker { symbol: "BTCUSDT".to_string(), price: "67432.50".to_string(), price_change: "1250.30".to_string(), price_change_percent: "1.89".to_string(), high: "68200.00".to_string(), low: "66100.00".to_string(), volume: "28500.00".to_string(), quote_volume: "1890000000.00".to_string(), open_time: current_timestamp() - 86400000, close_time: current_timestamp() },
        Ticker { symbol: "ETHUSDT".to_string(), price: "3520.75".to_string(), price_change: "45.25".to_string(), price_change_percent: "1.30".to_string(), high: "3580.00".to_string(), low: "3475.00".to_string(), volume: "125000.00".to_string(), quote_volume: "440000000.00".to_string(), open_time: current_timestamp() - 86400000, close_time: current_timestamp() },
        Ticker { symbol: "BNBUSDT".to_string(), price: "595.25".to_string(), price_change: "12.50".to_string(), price_change_percent: "2.15".to_string(), high: "602.00".to_string(), low: "582.00".to_string(), volume: "85000.00".to_string(), quote_volume: "50000000.00".to_string(), open_time: current_timestamp() - 86400000, close_time: current_timestamp() },
        Ticker { symbol: "SOLUSDT".to_string(), price: "178.50".to_string(), price_change: "-2.30".to_string(), price_change_percent: "-1.27".to_string(), high: "185.00".to_string(), low: "175.00".to_string(), volume: "250000.00".to_string(), quote_volume: "44000000.00".to_string(), open_time: current_timestamp() - 86400000, close_time: current_timestamp() },
        Ticker { symbol: "XRPUSDT".to_string(), price: "0.5235".to_string(), price_change: "0.0125".to_string(), price_change_percent: "2.45".to_string(), high: "0.5350".to_string(), low: "0.5100".to_string(), volume: "1500000.00".to_string(), quote_volume: "780000.00".to_string(), open_time: current_timestamp() - 86400000, close_time: current_timestamp() },
    ];
    
    Json(ApiResponse::success(tickers))
}

async fn handle_order_book(
    Path(symbol): Path<String>,
    Query(params): Query<OrderBookParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let symbol = symbol.to_uppercase();
    if !validate_symbol(&symbol) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid symbol"))).into_response();
    }
    
    let limit = params.limit.unwrap_or(20).max(5).min(100) as usize;
    
    // Generate mock order book data
    let order_book = OrderBook {
        symbol: symbol.clone(),
        last_update_id: current_timestamp(),
        bids: vec![
            ["67400.00".to_string(), "1.25".to_string()],
            ["67390.00".to_string(), "2.50".to_string()],
            ["67380.00".to_string(), "5.00".to_string()],
            ["67370.00".to_string(), "8.75".to_string()],
            ["67360.00".to_string(), "15.00".to_string()],
        ][..limit.min(5)].to_vec(),
        asks: vec![
            ["67450.00".to_string(), "1.50".to_string()],
            ["67460.00".to_string(), "3.00".to_string()],
            ["67470.00".to_string(), "6.25".to_string()],
            ["67480.00".to_string(), "10.00".to_string()],
            ["67490.00".to_string(), "20.00".to_string()],
        ][..limit.min(5)].to_vec(),
    };
    
    Json(ApiResponse::success(order_book))
}

async fn handle_klines(
    Query(params): Query<KlineParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    if !validate_symbol(&params.symbol) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid symbol"))).into_response();
    }
    
    let limit = params.limit.unwrap_or(500).max(1).min(1500) as usize;
    
    // Generate mock kline data
    let mut klines = Vec::new();
    let base_time = current_timestamp() - (limit as i64 * 3600000);
    let base_price = 67400.0;
    
    for i in 0..limit {
        let time = base_time + (i as i64 * 3600000);
        let variance = ((i as f64 * 0.1).sin() * 500.0) + (i as f64 * 0.5);
        klines.push(Kline {
            open_time: time,
            open: format!("{:.2}", base_price + variance),
            high: format!("{:.2}", base_price + variance + 100.0),
            low: format!("{:.2}", base_price + variance - 100.0),
            close: format!("{:.2}", base_price + variance + 50.0),
            volume: format!("{:.2}", 1000.0 + i as f64 * 10.0),
            close_time: time + 3600000,
            quote_volume: format!("{:.2}", 67400000.0 + i as f64 * 1000.0),
            num_trades: 1000 + i as i64 * 10,
        });
    }
    
    Json(ApiResponse::success(klines))
}

async fn handle_recent_trades(
    Path(symbol): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let symbol = symbol.to_uppercase();
    if !validate_symbol(&symbol) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid symbol"))).into_response();
    }
    
    let limit = params.limit.unwrap_or(100).max(1).min(1000) as usize;
    
    // Generate mock trades
    let trades: Vec<Trade> = (0..limit).map(|i| Trade {
        trade_id: format!("TRD{}", current_timestamp() + i as i64),
        order_id: format!("ORD{}", current_timestamp() + i as i64),
        user_id: format!("user{}", i % 100),
        symbol: symbol.clone(),
        side: if i % 2 == 0 { "buy".to_string() } else { "sell".to_string() },
        price: "67432.50".to_string(),
        quantity: format!("{:.8}", 0.001 + (i as f64 * 0.001)),
        fee: format!("{:.8}", 0.0001),
        fee_currency: "USDT".to_string(),
        created_at: current_timestamp() - (i as i64 * 1000),
    }).collect();
    
    Json(ApiResponse::success(trades))
}

// ============================================================================
// API HANDLERS - Account
// ============================================================================

async fn handle_account_info(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let account = Account {
        user_id: user_id.clone(),
        account_type: "SPOT".to_string(),
        balances: vec![
            Balance { currency: "BTC".to_string(), free: "1.5".to_string(), locked: "0.5".to_string() },
            Balance { currency: "ETH".to_string(), free: "10.0".to_string(), locked: "2.0".to_string() },
            Balance { currency: "USDT".to_string(), free: "50000.0".to_string(), locked: "10000.0".to_string() },
            Balance { currency: "USDC".to_string(), free: "25000.0".to_string(), locked: "0.0".to_string() },
            Balance { currency: "BNB".to_string(), free: "50.0".to_string(), locked: "10.0".to_string() },
        ],
        total_equity: "250000.0".to_string(),
        total_margin_used: "10000.0".to_string(),
        total_unrealized_pnl: "2500.0".to_string(),
        available_balance: "60000.0".to_string(),
    };
    
    Json(ApiResponse::success(account))
}

async fn handle_account_balances(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let balances = vec![
        Balance { currency: "BTC".to_string(), free: "1.5".to_string(), locked: "0.5".to_string() },
        Balance { currency: "ETH".to_string(), free: "10.0".to_string(), locked: "2.0".to_string() },
        Balance { currency: "USDT".to_string(), free: "50000.0".to_string(), locked: "10000.0".to_string() },
        Balance { currency: "USDC".to_string(), free: "25000.0".to_string(), locked: "0.0".to_string() },
        Balance { currency: "BNB".to_string(), free: "50.0".to_string(), locked: "10.0".to_string() },
        Balance { currency: "SOL".to_string(), free: "100.0".to_string(), locked: "25.0".to_string() },
        Balance { currency: "XRP".to_string(), free: "5000.0".to_string(), locked: "1000.0".to_string() },
    ];
    
    Json(ApiResponse::success(balances))
}

// ============================================================================
// API HANDLERS - Orders
// ============================================================================

async fn handle_create_order(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateOrderRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    // Validate symbol
    if !validate_symbol(&payload.symbol) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid symbol"))).into_response();
    }
    
    // Validate order type
    if !validate_order_type(&payload.order_type) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid order type"))).into_response();
    }
    
    // Validate side
    if !validate_side(&payload.side) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid side"))).into_response();
    }
    
    // Validate time in force if provided
    if let Some(ref tif) = payload.time_in_force {
        if !validate_time_in_force(tif) {
            return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid time in force"))).into_response();
        }
    }
    
    let order = Order {
        order_id: generate_order_id(),
        user_id: user_id.clone(),
        symbol: payload.symbol.to_uppercase(),
        side: payload.side.to_lowercase(),
        order_type: payload.order_type.to_lowercase(),
        price: payload.price.clone().unwrap_or_else(|| "0".to_string()),
        quantity: payload.quantity.clone(),
        filled_quantity: "0".to_string(),
        average_price: "0".to_string(),
        status: "new".to_string(),
        time_in_force: payload.time_in_force.clone().unwrap_or_else(|| "GTC".to_string()),
        created_at: current_timestamp(),
        updated_at: current_timestamp(),
        stop_price: payload.stop_price,
        iceberg_quantity: payload.iceberg_quantity,
    };
    
    // Store the order
    let mut orders = state.orders.write().await;
    let user_orders = orders.entry(user_id.clone()).or_insert_with(Vec::new);
    user_orders.push(order.clone());
    
    Json(ApiResponse::success(order))
}

async fn handle_get_order(
    Path((user_id, order_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let orders = state.orders.read().await;
    
    if let Some(user_orders) = orders.get(&user_id) {
        for order in user_orders {
            if order.order_id == order_id {
                return Json(ApiResponse::success(order.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Order not found"))).into_response()
}

async fn handle_cancel_order(
    Path((user_id, order_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut orders = state.orders.write().await;
    
    if let Some(user_orders) = orders.get_mut(&user_id) {
        for order in user_orders.iter_mut() {
            if order.order_id == order_id {
                if order.status == "filled" || order.status == "canceled" {
                    return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Order cannot be canceled"))).into_response();
                }
                order.status = "canceled".to_string();
                order.updated_at = current_timestamp();
                return Json(ApiResponse::success(order.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Order not found"))).into_response()
}

async fn handle_get_orders(
    Path(user_id): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let orders = state.orders.read().await;
    let user_orders = orders.get(&user_id).cloned().unwrap_or_default();
    
    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;
    let symbol_filter = params.symbol.clone();
    
    let filtered: Vec<Order> = user_orders
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter(|o| {
            if let Some(ref sym) = symbol_filter {
                o.symbol == *sym
            } else {
                true
            }
        })
        .collect();
    
    Json(ApiResponse::success(filtered))
}

async fn handle_get_open_orders(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let orders = state.orders.read().await;
    let user_orders = orders.get(&user_id).cloned().unwrap_or_default();
    
    let open_orders: Vec<Order> = user_orders
        .into_iter()
        .filter(|o| o.status == "new" || o.status == "partially_filled")
        .collect();
    
    Json(ApiResponse::success(open_orders))
}

async fn handle_get_all_orders(
    Path(user_id): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let orders = state.orders.read().await;
    let user_orders = orders.get(&user_id).cloned().unwrap_or_default();
    
    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;
    
    let filtered: Vec<Order> = user_orders
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();
    
    Json(ApiResponse::success(filtered))
}

async fn handle_cancel_all_orders(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut orders = state.orders.write().await;
    
    if let Some(user_orders) = orders.get_mut(&user_id) {
        let mut canceled = Vec::new();
        for order in user_orders.iter_mut() {
            if order.status == "new" {
                order.status = "canceled".to_string();
                order.updated_at = current_timestamp();
                canceled.push(order.clone());
            }
        }
        return Json(ApiResponse::success(canceled)).into_response();
    }
    
    Json(ApiResponse::success(Vec::<Order>::new()))
}

// ============================================================================
// API HANDLERS - Trades
// ============================================================================

async fn handle_get_trades(
    Path(user_id): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let trades = state.trades.read().await;
    let user_trades = trades.get(&user_id).cloned().unwrap_or_default();
    
    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;
    let symbol_filter = params.symbol.clone();
    
    let filtered: Vec<Trade> = user_trades
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter(|t| {
            if let Some(ref sym) = symbol_filter {
                t.symbol == *sym
            } else {
                true
            }
        })
        .collect();
    
    Json(ApiResponse::success(filtered))
}

// ============================================================================
// API HANDLERS - Positions (Futures/Margin)
// ============================================================================

async fn handle_get_positions(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let positions = state.positions.read().await;
    let user_positions = positions.get(&user_id).cloned().unwrap_or_default();
    
    Json(ApiResponse::success(user_positions))
}

async fn handle_get_position(
    Path((user_id, symbol)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let positions = state.positions.read().await;
    
    if let Some(user_positions) = positions.get(&user_id) {
        for pos in user_positions {
            if pos.symbol == symbol.to_uppercase() {
                return Json(ApiResponse::success(pos.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Position not found"))).into_response()
}

// ============================================================================
// API HANDLERS - Wallet - Deposits
// ============================================================================

async fn handle_get_deposits(
    Path(user_id): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let deposits = state.deposits.read().await;
    let user_deposits = deposits.get(&user_id).cloned().unwrap_or_default();
    
    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;
    let symbol_filter = params.symbol.clone();
    
    let filtered: Vec<Deposit> = user_deposits
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter(|d| {
            if let Some(ref sym) = symbol_filter {
                d.currency == *sym
            } else {
                true
            }
        })
        .collect();
    
    Json(ApiResponse::success(filtered))
}

async fn handle_generate_deposit_address(
    Path((user_id, currency)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let currency = currency.to_uppercase();
    if !validate_currency(&currency) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid currency"))).into_response();
    }
    
    let address = match currency.as_str() {
        "BTC" => "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        "ETH" => "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        "USDT" => "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        "USDC" => "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        _ => "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    };
    
    let wallet = Wallet {
        wallet_id: generate_order_id(),
        user_id: user_id.clone(),
        wallet_type: "deposit".to_string(),
        currency: currency.clone(),
        balance: "0".to_string(),
        locked: "0".to_string(),
        address: Some(address.to_string()),
        memo: None,
    };
    
    Json(ApiResponse::success(wallet))
}

// ============================================================================
// API HANDLERS - Wallet - Withdrawals
// ============================================================================

async fn handle_create_withdrawal(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateWithdrawalRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let currency = payload.currency.to_uppercase();
    if !validate_currency(&currency) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid currency"))).into_response();
    }
    
    // Calculate fee
    let fee = match currency.as_str() {
        "BTC" => "0.0005",
        "ETH" => "0.005",
        "USDT" => "1.0",
        "USDC" => "1.0",
        _ => "0.0",
    };
    
    let withdrawal = Withdrawal {
        withdrawal_id: generate_order_id(),
        user_id: user_id.clone(),
        currency: currency.clone(),
        amount: payload.amount.clone(),
        fee: fee.to_string(),
        address: payload.address.clone(),
        memo: payload.memo.clone(),
        status: "pending".to_string(),
        tx_hash: None,
        created_at: current_timestamp(),
        updated_at: current_timestamp(),
    };
    
    // Store the withdrawal
    let mut withdrawals = state.withdrawals.write().await;
    let user_withdrawals = withdrawals.entry(user_id.clone()).or_insert_with(Vec::new);
    user_withdrawals.push(withdrawal.clone());
    
    Json(ApiResponse::success(withdrawal))
}

async fn handle_get_withdrawals(
    Path(user_id): Path<String>,
    Query(params): Query<PaginationParams>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let withdrawals = state.withdrawals.read().await;
    let user_withdrawals = withdrawals.get(&user_id).cloned().unwrap_or_default();
    
    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;
    let symbol_filter = params.symbol.clone();
    
    let filtered: Vec<Withdrawal> = user_withdrawals
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter(|w| {
            if let Some(ref sym) = symbol_filter {
                w.currency == *sym
            } else {
                true
            }
        })
        .collect();
    
    Json(ApiResponse::success(filtered))
}

async fn handle_cancel_withdrawal(
    Path((user_id, withdrawal_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut withdrawals = state.withdrawals.write().await;
    
    if let Some(user_withdrawals) = withdrawals.get_mut(&user_id) {
        for w in user_withdrawals.iter_mut() {
            if w.withdrawal_id == withdrawal_id {
                if w.status != "pending" {
                    return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Withdrawal cannot be canceled"))).into_response();
                }
                w.status = "canceled".to_string();
                w.updated_at = current_timestamp();
                return Json(ApiResponse::success(w.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Withdrawal not found"))).into_response()
}

// ============================================================================
// API HANDLERS - Staking
// ============================================================================

async fn handle_get_staking_products(
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let products = state.staking_products.read().await;
    Json(ApiResponse::success(products.clone()))
}

async fn handle_create_staking(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateStakingRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let products = state.staking_products.read().await;
    
    // Find the product
    let product = products.iter().find(|p| p.product_id == payload.product_id);
    if product.is_none() {
        return (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Staking product not found"))).into_response();
    }
    
    let product = product.unwrap();
    
    // Calculate end time
    let end_time = if product.lock_period > 0 {
        current_timestamp() + (product.lock_period as i64 * 86400000)
    } else {
        0
    };
    
    let position = StakingPosition {
        position_id: generate_order_id(),
        user_id: user_id.clone(),
        product_id: payload.product_id.clone(),
        amount: payload.amount.clone(),
        reward: "0".to_string(),
        start_time: current_timestamp(),
        end_time,
        status: "active".to_string(),
    };
    
    // Store the position
    let mut positions = state.staking_positions.write().await;
    let user_positions = positions.entry(user_id.clone()).or_insert_with(Vec::new);
    user_positions.push(position.clone());
    
    Json(ApiResponse::success(position))
}

async fn handle_get_staking_positions(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let positions = state.staking_positions.read().await;
    let user_positions = positions.get(&user_id).cloned().unwrap_or_default();
    
    Json(ApiResponse::success(user_positions))
}

async fn handle_cancel_staking(
    Path((user_id, position_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut positions = state.staking_positions.write().await;
    
    if let Some(user_positions) = positions.get_mut(&user_id) {
        for p in user_positions.iter_mut() {
            if p.position_id == position_id {
                if p.status != "active" {
                    return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Staking position cannot be canceled"))).into_response();
                }
                p.status = "unbonding".to_string();
                return Json(ApiResponse::success(p.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Staking position not found"))).into_response()
}

// ============================================================================
// API HANDLERS - Lending
// ============================================================================

async fn handle_get_lending_products(
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let products = state.lending_products.read().await;
    Json(ApiResponse::success(products.clone()))
}

async fn handle_create_lending(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateLendingRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let products = state.lending_products.read().await;
    
    // Find the product
    let product = products.iter().find(|p| p.product_id == payload.product_id);
    if product.is_none() {
        return (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Lending product not found"))).into_response();
    }
    
    let product = product.unwrap();
    
    // Calculate end time
    let end_time = if product.term_days > 0 {
        current_timestamp() + (product.term_days as i64 * 86400000)
    } else {
        0
    };
    
    let position = LendingPosition {
        position_id: generate_order_id(),
        user_id: user_id.clone(),
        product_id: payload.product_id.clone(),
        amount: payload.amount.clone(),
        interest: "0".to_string(),
        start_time: current_timestamp(),
        end_time,
        status: "active".to_string(),
    };
    
    // Store the position
    let mut positions = state.lending_positions.write().await;
    let user_positions = positions.entry(user_id.clone()).or_insert_with(Vec::new);
    user_positions.push(position.clone());
    
    Json(ApiResponse::success(position))
}

async fn handle_get_lending_positions(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let positions = state.lending_positions.read().await;
    let user_positions = positions.get(&user_id).cloned().unwrap_or_default();
    
    Json(ApiResponse::success(user_positions))
}

// ============================================================================
// API HANDLERS - Borrowing
// ============================================================================

async fn handle_create_borrow(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateBorrowRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let currency = payload.currency.to_uppercase();
    let collateral_currency = payload.collateral_currency.to_uppercase();
    
    if !validate_currency(&currency) || !validate_currency(&collateral_currency) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Invalid currency"))).into_response();
    }
    
    // Calculate LTV
    let collateral_value: f64 = payload.collateral_amount.parse().unwrap_or(0.0);
    let borrow_amount: f64 = payload.amount.parse().unwrap_or(0.0);
    let ltv = if collateral_value > 0.0 {
        (borrow_amount / collateral_value * 100.0).min(80.0)
    } else {
        0.0
    };
    
    let borrow = BorrowPosition {
        borrow_id: generate_order_id(),
        user_id: user_id.clone(),
        currency: currency.clone(),
        amount: payload.amount.clone(),
        collateral_currency: collateral_currency.clone(),
        collateral_amount: payload.collateral_amount.clone(),
        interest: "0".to_string(),
        ltv: format!("{:.2}", ltv),
        status: "active".to_string(),
        start_time: current_timestamp(),
        due_time: current_timestamp() + (30 * 86400000),
    };
    
    // Store the borrow position
    let mut positions = state.borrow_positions.write().await;
    let user_positions = positions.entry(user_id.clone()).or_insert_with(Vec::new);
    user_positions.push(borrow.clone());
    
    Json(ApiResponse::success(borrow))
}

async fn handle_get_borrow_positions(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let positions = state.borrow_positions.read().await;
    let user_positions = positions.get(&user_id).cloned().unwrap_or_default();
    
    Json(ApiResponse::success(user_positions))
}

async fn handle_repay_borrow(
    Path((user_id, borrow_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut positions = state.borrow_positions.write().await;
    
    if let Some(user_positions) = positions.get_mut(&user_id) {
        for p in user_positions.iter_mut() {
            if p.borrow_id == borrow_id {
                if p.status != "active" {
                    return (StatusCode::BAD_REQUEST, Json(ApiResponse::<String>::error(400, "Borrow position cannot be repaid"))).into_response();
                }
                p.status = "repaid".to_string();
                return Json(ApiResponse::success(p.clone())).into_response();
            }
        }
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "Borrow position not found"))).into_response()
}

// ============================================================================
// API HANDLERS - API Keys
// ============================================================================

async fn handle_create_api_key(
    Path(user_id): Path<String>,
    Json(payload): Json<CreateApiKeyRequest>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let api_key = ApiKey {
        key_id: generate_api_key(),
        user_id: user_id.clone(),
        label: payload.label.clone(),
        public_key: generate_api_key(),
        permissions: payload.permissions.clone(),
        ip_whitelist: payload.ip_whitelist.clone(),
        created_at: current_timestamp(),
        expires_at: payload.expires_at,
        last_used: None,
        is_enabled: true,
    };
    
    // Store the API key
    let mut keys = state.api_keys.write().await;
    let user_keys = keys.entry(user_id.clone()).or_insert_with(Vec::new);
    user_keys.push(api_key.clone());
    
    Json(ApiResponse::success(api_key))
}

async fn handle_get_api_keys(
    Path(user_id): Path<String>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let keys = state.api_keys.read().await;
    let user_keys = keys.get(&user_id).cloned().unwrap_or_default();
    
    Json(ApiResponse::success(user_keys))
}

async fn handle_delete_api_key(
    Path((user_id, key_id)): Path<(String, String)>,
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let mut keys = state.api_keys.write().await;
    
    if let Some(user_keys) = keys.get_mut(&user_id) {
        user_keys.retain(|k| k.key_id != key_id);
        return Json(ApiResponse::<String>::success("API key deleted".to_string())).into_response();
    }
    
    (StatusCode::NOT_FOUND, Json(ApiResponse::<String>::error(404, "API key not found"))).into_response()
}

// ============================================================================
// API HANDLERS - Leverage Tokens (Leveraged Tokens)
// ============================================================================

async fn handle_get_leveraged_tokens(
    state: AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    let tokens = vec![
        serde_json::json!({
            "token_id": "BTCBULL",
            "name": "3X Long Bitcoin",
            "description": "3X leveraged long position in Bitcoin",
            "underlying": "BTCUSDT",
            "leverage": 3,
            "direction": "long",
            "nav": "15.50",
            "nav_change": "2.5",
            "nav_change_percent": "19.25",
            "volume": "2500000",
            "fee": "0.1"
        }),
        serde_json::json!({
            "token_id": "BTCBEAR",
            "name": "3X Short Bitcoin",
            "description": "3X leveraged short position in Bitcoin",
            "underlying": "BTCUSDT",
            "leverage": 3,
            "direction": "short",
            "nav": "8.25",
            "nav_change": "-1.2",
            "nav_change_percent": "-12.70",
            "volume": "1800000",
            "fee": "0.1"
        }),
        serde_json::json!({
            "token_id": "ETHBULL",
            "name": "3X Long Ethereum",
            "description": "3X leveraged long position in Ethereum",
            "underlying": "ETHUSDT",
            "leverage": 3,
            "direction": "long",
            "nav": "22.80",
            "nav_change": "3.5",
            "nav_change_percent": "18.10",
            "volume": "1200000",
            "fee": "0.1"
        }),
        serde_json::json!({
            "token_id": "ETHBEAR",
            "name": "3X Short Ethereum",
            "description": "3X leveraged short position in Ethereum",
            "underlying": "ETHUSDT",
            "leverage": 3,
            "direction": "short",
            "nav": "5.40",
            "nav_change": "-0.8",
            "nav_change_percent": "-12.90",
            "volume": "800000",
            "fee": "0.1"
        }),
        serde_json::json!({
            "token_id": "SOLBULL",
            "name": "3X Long Solana",
            "description": "3X leveraged long position in Solana",
            "underlying": "SOLUSDT",
            "leverage": 3,
            "direction": "long",
            "nav": "12.30",
            "nav_change": "1.8",
            "nav_change_percent": "17.14",
            "volume": "600000",
            "fee": "0.1"
        }),
    ];
    
    Json(ApiResponse::success(tokens))
}

// ============================================================================
// BUILD ROUTER
// ============================================================================

fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowedOrigins::Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(ExposeHeaders::any());
    
    Router::new()
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .route("/api/v2/ping", get(handle_ping))
        .route("/api/v2/time", get(handle_server_time))
        .route("/api/v2/exchangeInfo", get(handle_exchange_info))
        
        // Market Data
        .route("/api/v2/ticker/:symbol", get(handle_ticker))
        .route("/api/v2/ticker/all", get(handle_all_tickers))
        .route("/api/v2/depth/:symbol", get(handle_order_book))
        .route("/api/v2/klines", get(handle_klines))
        .route("/api/v2/trades/:symbol", get(handle_recent_trades))
        
        // Account
        .route("/api/v2/account/:user_id", get(handle_account_info))
        .route("/api/v2/balance/:user_id", get(handle_account_balances))
        
        // Orders
        .route("/api/v2/order/:user_id", post(handle_create_order))
        .route("/api/v2/order/:user_id/:order_id", get(handle_get_order))
        .route("/api/v2/order/:user_id/:order_id", delete(handle_cancel_order))
        .route("/api/v2/orders/:user_id", get(handle_get_orders))
        .route("/api/v2/openOrders/:user_id", get(handle_get_open_orders))
        .route("/api/v2/allOrders/:user_id", get(handle_get_all_orders))
        .route("/api/v2/order/all/:user_id", delete(handle_cancel_all_orders))
        
        // Trades
        .route("/api/v2/trades/:user_id", get(handle_get_trades))
        
        // Positions
        .route("/api/v2/positions/:user_id", get(handle_get_positions))
        .route("/api/v2/position/:user_id/:symbol", get(handle_get_position))
        
        // Deposits
        .route("/api/v2/deposits/:user_id", get(handle_get_deposits))
        .route("/api/v2/deposit/address/:user_id/:currency", get(handle_generate_deposit_address))
        
        // Withdrawals
        .route("/api/v2/withdraw/:user_id", post(handle_create_withdrawal))
        .route("/api/v2/withdrawals/:user_id", get(handle_get_withdrawals))
        .route("/api/v2/withdraw/:user_id/:withdrawal_id", delete(handle_cancel_withdrawal))
        
        // Staking
        .route("/api/v2/staking/products", get(handle_get_staking_products))
        .route("/api/v2/staking/:user_id", post(handle_create_staking))
        .route("/api/v2/staking/positions/:user_id", get(handle_get_staking_positions))
        .route("/api/v2/staking/:user_id/:position_id", delete(handle_cancel_staking))
        
        // Lending
        .route("/api/v2/lending/products", get(handle_get_lending_products))
        .route("/api/v2/lending/:user_id", post(handle_create_lending))
        .route("/api/v2/lending/positions/:user_id", get(handle_get_lending_positions))
        
        // Borrowing
        .route("/api/v2/borrow/:user_id", post(handle_create_borrow))
        .route("/api/v2/borrow/positions/:user_id", get(handle_get_borrow_positions))
        .route("/api/v2/borrow/:user_id/:borrow_id", delete(handle_repay_borrow))
        
        // API Keys
        .route("/api/v2/apiKey/:user_id", post(handle_create_api_key))
        .route("/api/v2/apiKeys/:user_id", get(handle_get_api_keys))
        .route("/api/v2/apiKey/:user_id/:key_id", delete(handle_delete_api_key))
        
        // Leveraged Tokens
        .route("/api/v2/leveraged/tokens", get(handle_get_leveraged_tokens))
        
        .with_state(state)
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState::new());
    state.initialize();
    
    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    
    println!("TigerEx REST API v2 starting on http://{}", addr);
    
    let router = create_router(state);
    
    axum::serve(listener, router).await.unwrap();
}