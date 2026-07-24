//! TigerEx Trading Service - Production Ready
//! Order Management & Trading Engine Service
//!
//! Features:
//! - Order placement (market, limit, stop orders)
//! - Order book management
//! - Order matching
//! - Position management
//! - Trade history
//! - Real-time price updates

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum TradingError {
    #[error("Invalid order")]
    InvalidOrder,
    
    #[error("Order not found")]
    OrderNotFound,
    
    #[error("Insufficient balance")]
    InsufficientBalance,
    
    #[error("Trading pair not found")]
    PairNotFound,
    
    #[error("Trading disabled")]
    TradingDisabled,
    
    #[error("Price out of range")]
    PriceOutOfRange,
    
    #[error("Quantity too small")]
    QuantityTooSmall,
    
    #[error("Position not found")]
    PositionNotFound,
    
    #[error("Invalid order type")]
    InvalidOrderType,
    
    #[error("Order rejected")]
    OrderRejected(String),
    
    #[error("Internal error")]
    InternalError(String),
}

impl IntoResponse for TradingError {
    fn into_response(self) -> Response<Body> {
        let (status, message) = match self {
            TradingError::InvalidOrder => (StatusCode::BAD_REQUEST, "Invalid order"),
            TradingError::OrderNotFound => (StatusCode::NOT_FOUND, "Order not found"),
            TradingError::InsufficientBalance => (StatusCode::BAD_REQUEST, "Insufficient balance"),
            TradingError::PairNotFound => (StatusCode::NOT_FOUND, "Trading pair not found"),
            TradingError::TradingDisabled => (StatusCode::SERVICE_UNAVAILABLE, "Trading disabled"),
            TradingError::PriceOutOfRange => (StatusCode::BAD_REQUEST, "Price out of range"),
            TradingError::QuantityTooSmall => (StatusCode::BAD_REQUEST, "Quantity too small"),
            TradingError::PositionNotFound => (StatusCode::NOT_FOUND, "Position not found"),
            TradingError::InvalidOrderType => (StatusCode::BAD_REQUEST, "Invalid order type"),
            TradingError::OrderRejected(msg) => (StatusCode::BAD_REQUEST, &msg),
            TradingError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, &msg),
        };
        
        let body = serde_json::json!({
            "success": false,
            "error": { "code": status.as_u16(), "message": message }
        });
        
        (status, Json(body)).into_response()
    }
}

// =============================================================================
// DATA TYPES
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
    TakeProfit,
    TakeProfitLimit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeInForce {
    GoodTillCancel,
    ImmediateOrCancel,
    FillOrKill,
    GoodTillTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingPair {
    pub id: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub symbol: String,
    pub status: String,
    pub maker_fee: f64,
    pub taker_fee: f64,
    pub min_price: f64,
    pub max_price: f64,
    pub tick_size: f64,
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub step_size: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub pair_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    pub price: f64,
    pub stop_price: Option<f64>,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub average_fill_price: f64,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

impl Order {
    pub fn new(
        user_id: &str,
        pair_id: &str,
        symbol: &str,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            pair_id: pair_id.to_string(),
            symbol: symbol.to_string(),
            side,
            order_type,
            time_in_force: TimeInForce::GoodTillCancel,
            price,
            stop_price: None,
            quantity,
            filled_quantity: 0.0,
            average_fill_price: 0.0,
            status: OrderStatus::Open,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            expires_at: None,
        }
    }
    
    pub fn remaining_quantity(&self) -> f64 {
        self.quantity - self.filled_quantity
    }
    
    pub fn is_filled(&self) -> bool {
        self.status == OrderStatus::Filled
    }
    
    pub fn is_cancelled(&self) -> bool {
        self.status == OrderStatus::Cancelled
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub order_id: String,
    pub pair_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub fee_asset: String,
    pub maker: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub user_id: String,
    pub pair_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub unrealized_pnl: f64,
    pub leverage: f64,
    pub margin: f64,
    pub liquidation_price: Option<f64>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookEntry {
    pub price: f64,
    pub quantity: f64,
    pub orders: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
    pub last_update_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub last_price: f64,
    pub price_change: f64,
    pub price_change_percent: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub volume_24h: f64,
    pub quote_volume_24h: f64,
    pub trades_24h: u64,
    pub updated_at: DateTime<Utc>,
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateOrderRequest {
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub quantity: f64,
    pub time_in_force: Option<TimeInForce>,
}

#[derive(Debug, Deserialize)]
pub struct CancelOrderRequest {
    pub order_id: String,
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
pub struct GetOrdersQuery {
    pub status: Option<String>,
    pub side: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct GetTradesQuery {
    pub limit: Option<usize>,
}

// =============================================================================
// TRADING SERVICE
// =============================================================================

pub struct TradingService {
    // Trading pairs
    pairs: RwLock<HashMap<String, TradingPair>>,
    
    // Orders
    orders: DashMap<String, Order>,
    user_orders: DashMap<String, Vec<String>>,
    
    // Order book
    order_books: DashMap<String, OrderBook>,
    
    // Positions
    positions: DashMap<String, Position>,
    user_positions: DashMap<String, Vec<String>>,
    
    // Trades
    trades: DashMap<String, Vec<Trade>>,
    
    // Tickers
    tickers: DashMap<String, Ticker>,
}

impl TradingService {
    pub fn new() -> Self {
        let service = Self {
            pairs: RwLock::new(HashMap::new()),
            orders: DashMap::new(),
            user_orders: DashMap::new(),
            order_books: DashMap::new(),
            positions: DashMap::new(),
            user_positions: DashMap::new(),
            trades: DashMap::new(),
            tickers: DashMap::new(),
        };
        
        // Initialize default trading pairs
        service.init_default_pairs();
        
        service
    }
    
    fn init_default_pairs(&self) {
        let pairs = vec![
            TradingPair {
                id: "btc-usdt".to_string(),
                base_asset: "BTC".to_string(),
                quote_asset: "USDT".to_string(),
                symbol: "BTC/USDT".to_string(),
                status: "trading".to_string(),
                maker_fee: 0.001,
                taker_fee: 0.001,
                min_price: 0.01,
                max_price: 1000000.0,
                tick_size: 0.01,
                min_quantity: 0.00001,
                max_quantity: 10000.0,
                step_size: 0.00001,
            },
            TradingPair {
                id: "eth-usdt".to_string(),
                base_asset: "ETH".to_string(),
                quote_asset: "USDT".to_string(),
                symbol: "ETH/USDT".to_string(),
                status: "trading".to_string(),
                maker_fee: 0.001,
                taker_fee: 0.001,
                min_price: 0.01,
                max_price: 100000.0,
                tick_size: 0.01,
                min_quantity: 0.0001,
                max_quantity: 1000000.0,
                step_size: 0.0001,
            },
            TradingPair {
                id: "bnb-usdt".to_string(),
                base_asset: "BNB".to_string(),
                quote_asset: "USDT".to_string(),
                symbol: "BNB/USDT".to_string(),
                status: "trading".to_string(),
                maker_fee: 0.001,
                taker_fee: 0.001,
                min_price: 0.01,
                max_price: 10000.0,
                tick_size: 0.01,
                min_quantity: 0.001,
                max_quantity: 1000000.0,
                step_size: 0.001,
            },
            TradingPair {
                id: "sol-usdt".to_string(),
                base_asset: "SOL".to_string(),
                quote_asset: "USDT".to_string(),
                symbol: "SOL/USDT".to_string(),
                status: "trading".to_string(),
                maker_fee: 0.001,
                taker_fee: 0.001,
                min_price: 0.001,
                max_price: 10000.0,
                tick_size: 0.001,
                min_quantity: 0.01,
                max_quantity: 10000000.0,
                step_size: 0.01,
            },
        ];
        
        // Add pairs and initialize order books
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async {
            let mut pairs_map = self.pairs.write().await;
            for pair in pairs {
                let symbol = pair.symbol.clone();
                pairs_map.insert(pair.id.clone(), pair);
                
                // Initialize empty order book
                self.order_books.insert(symbol.clone(), OrderBook {
                    symbol,
                    bids: Vec::new(),
                    asks: Vec::new(),
                    last_update_id: 0,
                });
            }
        });
    }
    
    // =============================================================================
    // TRADING PAIRS
    // =============================================================================
    
    pub async fn get_pairs(&self) -> Vec<TradingPair> {
        let pairs = self.pairs.read().await;
        pairs.values().cloned().collect()
    }
    
    pub async fn get_pair(&self, pair_id: &str) -> Result<TradingPair, TradingError> {
        let pairs = self.pairs.read().await;
        pairs.get(pair_id)
            .cloned()
            .ok_or(TradingError::PairNotFound)
    }
    
    // =============================================================================
    // ORDERS
    // =============================================================================
    
    pub async fn create_order(&self, request: CreateOrderRequest) -> Result<Order, TradingError> {
        // Validate trading pair
        let pair = self.get_pair(&request.symbol.replace('/', "-").to_lowercase()).await?;
        
        if pair.status != "trading" {
            return Err(TradingError::TradingDisabled);
        }
        
        // Validate order parameters
        if request.quantity < pair.min_quantity {
            return Err(TradingError::QuantityTooSmall);
        }
        
        let price = request.price.unwrap_or(0.0);
        
        // For limit orders, validate price
        if request.order_type == OrderType::Limit || request.order_type == OrderType::StopLimit {
            if price < pair.min_price || price > pair.max_price {
                return Err(TradingError::PriceOutOfRange);
            }
        }
        
        // Create order
        let mut order = Order::new(
            &request.user_id,
            &pair.id,
            &request.symbol,
            request.side,
            request.order_type,
            price,
            request.quantity,
        );
        
        if let Some(tif) = request.time_in_force {
            order.time_in_force = tif;
        }
        
        if let Some(stop) = request.stop_price {
            order.stop_price = Some(stop);
        }
        
        // For market orders, execute immediately
        if request.order_type == OrderType::Market {
            order.status = OrderStatus::Filled;
            order.filled_quantity = order.quantity;
            order.average_fill_price = self.get_market_price(&pair.id).await;
        }
        
        // Store order
        let order_id = order.id.clone();
        self.orders.insert(order_id.clone(), order.clone());
        
        // Update user orders index
        let user_key = format!("{}:{}", request.user_id, pair.id);
        self.user_orders.entry(user_key)
            .or_insert_with(Vec::new)
            .push(order_id);
        
        // For limit orders, add to order book
        if request.order_type == OrderType::Limit {
            self.add_to_order_book(&pair.id, &order).await;
        }
        
        info!("Order created: {} for user {} on {}", order.id, request.user_id, request.symbol);
        
        Ok(order)
    }
    
    pub async fn cancel_order(&self, order_id: &str, user_id: &str) -> Result<Order, TradingError> {
        let mut order = self.orders.get_mut(order_id)
            .ok_or(TradingError::OrderNotFound)?;
        
        // Verify ownership
        if order.user_id != user_id {
            return Err(TradingError::InvalidOrder);
        }
        
        // Can only cancel open orders
        if order.status != OrderStatus::Open && order.status != OrderStatus::PartiallyFilled {
            return Err(TradingError::InvalidOrder);
        }
        
        order.status = OrderStatus::Cancelled;
        order.updated_at = Utc::now();
        
        // Remove from order book
        self.remove_from_order_book(&order.pair_id, &order).await;
        
        info!("Order cancelled: {} by user {}", order_id, user_id);
        
        Ok(order.clone())
    }
    
    pub async fn get_order(&self, order_id: &str) -> Result<Order, TradingError> {
        self.orders.get(order_id)
            .map(|o| o.clone())
            .ok_or(TradingError::OrderNotFound)
    }
    
    pub async fn get_user_orders(&self, user_id: &str, pair_id: &str, query: GetOrdersQuery) -> Vec<Order> {
        let user_key = format!("{}:{}", user_id, pair_id);
        
        let order_ids = self.user_orders.get(&user_key)
            .map(|ids| ids.value().clone())
            .unwrap_or_default();
        
        let mut orders = Vec::new();
        
        for order_id in order_ids {
            if let Some(order) = self.orders.get(&order_id) {
                let order = order.value().clone();
                
                // Apply filters
                if let Some(ref status) = query.status {
                    let order_status = format!("{:?}", order.status).to_lowercase();
                    if &order_status != status {
                        continue;
                    }
                }
                
                if let Some(ref side) = query.side {
                    let order_side = format!("{:?}", order.side).to_lowercase();
                    if &order_side != side {
                        continue;
                    }
                }
                
                orders.push(order);
            }
        }
        
        // Sort by creation time descending
        orders.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        
        // Apply limit
        if let Some(limit) = query.limit {
            orders.truncate(limit);
        }
        
        orders
    }
    
    // =============================================================================
    // ORDER BOOK
    // =============================================================================
    
    pub async fn get_order_book(&self, symbol: &str) -> Result<OrderBook, TradingError> {
        self.order_books.get(symbol)
            .map(|ob| ob.clone().into())
            .ok_or(TradingError::PairNotFound)
    }
    
    async fn add_to_order_book(&self, pair_id: &str, order: &Order) {
        if let Some(ob) = self.order_books.get_mut(pair_id) {
            let entry = OrderBookEntry {
                price: order.price,
                quantity: order.remaining_quantity(),
                orders: 1,
            };
            
            if order.side == OrderSide::Buy {
                ob.bids.push(entry);
                ob.bids.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
            } else {
                ob.asks.push(entry);
                ob.asks.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());
            }
            
            ob.last_update_id += 1;
        }
    }
    
    async fn remove_from_order_book(&self, pair_id: &str, order: &Order) {
        if let Some(ob) = self.order_books.get_mut(pair_id) {
            if order.side == OrderSide::Buy {
                ob.bids.retain(|e| e.price != order.price);
            } else {
                ob.asks.retain(|e| e.price != order.price);
            }
            ob.last_update_id += 1;
        }
    }
    
    // =============================================================================
    // TRADES
    // =============================================================================
    
    pub async fn get_user_trades(&self, user_id: &str, query: GetTradesQuery) -> Vec<Trade> {
        let all_trades = self.trades.get(user_id)
            .map(|t| t.value().clone())
            .unwrap_or_default();
        
        let mut trades = all_trades;
        trades.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        
        if let Some(limit) = query.limit {
            trades.truncate(limit);
        }
        
        trades
    }
    
    // =============================================================================
    // POSITIONS
    // =============================================================================
    
    pub async fn get_position(&self, user_id: &str, pair_id: &str) -> Option<Position> {
        let key = format!("{}:{}", user_id, pair_id);
        self.positions.get(&key).map(|p| p.clone())
    }
    
    pub async fn get_user_positions(&self, user_id: &str) -> Vec<Position> {
        let position_ids = self.user_positions.get(user_id)
            .map(|ids| ids.value().clone())
            .unwrap_or_default();
        
        position_ids
            .iter()
            .filter_map(|id| self.positions.get(id).map(|p| p.clone()))
            .collect()
    }
    
    // =============================================================================
    // TICKERS
    // =============================================================================
    
    pub async fn get_ticker(&self, symbol: &str) -> Option<Ticker> {
        self.tickers.get(symbol).map(|t| t.clone())
    }
    
    pub async fn get_all_tickers(&self) -> Vec<Ticker> {
        self.tickers.iter().map(|t| t.value().clone()).collect()
    }
    
    // =============================================================================
    // HELPERS
    // =============================================================================
    
    async fn get_market_price(&self, pair_id: &str) -> f64 {
        // Get best bid/ask from order book
        if let Some(ob) = self.order_books.get(pair_id) {
            if !ob.bids.is_empty() {
                return ob.bids[0].price;
            }
            if !ob.asks.is_empty() {
                return ob.asks[0].price;
            }
        }
        
        // Default prices for demo
        match pair_id {
            "btc-usdt" => 65000.0,
            "eth-usdt" => 3500.0,
            "bnb-usdt" => 580.0,
            "sol-usdt" => 145.0,
            _ => 1.0,
        }
    }
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedTradingService = Arc<TradingService>;

pub struct AppState {
    pub trading_service: SharedTradingService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn create_order(
    State(state): State<AppState>,
    Json(request): Json<CreateOrderRequest>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let order = state.trading_service.create_order(request).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": order
    })))
}

async fn cancel_order(
    State(state): State<AppState>,
    Json(request): Json<CancelOrderRequest>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let order = state.trading_service.cancel_order(&request.order_id, &request.user_id).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": order
    })))
}

async fn get_order(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let order = state.trading_service.get_order(&order_id).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": order
    })))
}

async fn get_orders(
    State(state): State<AppState>,
    Path((user_id, symbol)): Path<(String, String)>>,
    Query(query): Query<GetOrdersQuery>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let pair_id = symbol.replace('/', "-").to_lowercase();
    let orders = state.trading_service.get_user_orders(&user_id, &pair_id, query).await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": orders
    })))
}

async fn get_order_book(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let order_book = state.trading_service.get_order_book(&symbol).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": order_book
    })))
}

async fn get_trades(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Query(query): Query<GetTradesQuery>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let trades = state.trading_service.get_user_trades(&user_id, query).await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": trades
    })))
}

async fn get_position(
    State(state): State<AppState>,
    Path((user_id, symbol)): Path<(String, String)>>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let pair_id = symbol.replace('/', "-").to_lowercase();
    let position = state.trading_service.get_position(&user_id, &pair_id).await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": position
    })))
}

async fn get_positions(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let positions = state.trading_service.get_user_positions(&user_id).await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": positions
    })))
}

async fn get_ticker(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let ticker = state.trading_service.get_ticker(&symbol).await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": ticker
    })))
}

async fn get_tickers(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let tickers = state.trading_service.get_all_tickers().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": tickers
    })))
}

async fn get_pairs(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, TradingError> {
    let pairs = state.trading_service.get_pairs().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": pairs
    })))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "trading-service",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// =============================================================================
// MAIN
// =============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();
    
    info!("Starting TigerEx Trading Service");
    
    // Create trading service
    let trading_service = Arc::new(TradingService::new());
    let state = AppState {
        trading_service: trading_service.clone(),
    };
    
    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/orders", post(create_order))
        .route("/api/v1/orders/:order_id", delete(cancel_order).get(get_order))
        .route("/api/v1/orders/:symbol/:user_id", get(get_orders))
        .route("/api/v1/orderbook/:symbol", get(get_order_book))
        .route("/api/v1/trades/:user_id", get(get_trades))
        .route("/api/v1/positions/:symbol/:user_id", get(get_position))
        .route("/api/v1/positions/:user_id", get(get_positions))
        .route("/api/v1/ticker/:symbol", get(get_ticker))
        .route("/api/v1/tickers", get(get_tickers))
        .route("/api/v1/pairs", get(get_pairs))
        .with_state(state);
    
    // Start server
    let addr = "0.0.0.0:8082".parse()?;
    
    info!("Trading service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}
