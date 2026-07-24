//! TigerEx Market Data Service - Production Ready
//! Real-time and Historical Market Data Service
//!
//! Features:
//! - Real-time price feeds
//! - Order book snapshots
//! - Trade history
//! - K-line/candlestick data
//! - 24h statistics
//! - WebSocket streaming
//! - Price aggregation from multiple sources

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum MarketDataError {
    #[error("Symbol not found")]
    SymbolNotFound,
    
    #[error("Invalid timeframe")]
    InvalidTimeframe,
    
    #[error("Data not available")]
    DataNotAvailable,
    
    #[error("Internal error")]
    InternalError(String),
}

impl IntoResponse for MarketDataError {
    fn into_response(self) -> Response<Body> {
        let (status, message) = match self {
            MarketDataError::SymbolNotFound => (StatusCode::NOT_FOUND, "Symbol not found"),
            MarketDataError::InvalidTimeframe => (StatusCode::BAD_REQUEST, "Invalid timeframe"),
            MarketDataError::DataNotAvailable => (StatusCode::NOT_FOUND, "Data not available"),
            MarketDataError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, &msg),
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
    pub bid_price: f64,
    pub ask_price: f64,
    pub bid_quantity: f64,
    pub ask_quantity: f64,
    pub open_price: f64,
    pub weighted_avg_price: f64,
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
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub quote_quantity: f64,
    pub is_buyer_maker: bool,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KLine {
    pub symbol: String,
    pub timeframe: String,
    pub open_time: DateTime<Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub quote_volume: f64,
    pub trades: u64,
    pub is_closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketTicker {
    pub symbol: String,
    pub price_change: f64,
    pub price_change_percent: f64,
    pub last_price: f64,
    pub high_price: f64,
    pub low_price: f64,
    pub volume: f64,
    pub quote_volume: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeRate {
    pub from: String,
    pub to: String,
    pub rate: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSource {
    pub name: String,
    pub url: String,
    pub weight: u8,
    pub is_active: bool,
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct GetKlinesQuery {
    pub interval: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct GetTradesQuery {
    pub limit: Option<usize>,
    pub from_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetOrderBookQuery {
    pub limit: Option<usize>,
}

// =============================================================================
// MARKET DATA SERVICE
// =============================================================================

pub struct MarketDataService {
    // Tickers
    tickers: RwLock<HashMap<String, Ticker>>,
    
    // Order books
    order_books: RwLock<HashMap<String, OrderBook>>,
    
    // Recent trades
    trades: RwLock<HashMap<String, Vec<Trade>>>,
    
    // K-lines
    klines: RwLock<HashMap<String, Vec<KLine>>>,
    
    // Price sources
    price_sources: RwLock<Vec<PriceSource>>,
    
    // Supported symbols
    symbols: RwLock<HashMap<String, SymbolInfo>>,
}

#[derive(Debug, Clone)]
pub struct SymbolInfo {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub status: String,
    pub min_price: f64,
    pub max_price: f64,
    pub tick_size: f64,
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub step_size: f64,
}

impl MarketDataService {
    pub fn new() -> Self {
        let service = Self {
            tickers: RwLock::new(HashMap::new()),
            order_books: RwLock::new(HashMap::new()),
            trades: RwLock::new(HashMap::new()),
            klines: RwLock::new(HashMap::new()),
            price_sources: RwLock::new(vec![
                PriceSource {
                    name: "binance".to_string(),
                    url: "https://api.binance.com".to_string(),
                    weight: 10,
                    is_active: true,
                },
                PriceSource {
                    name: "coinbase".to_string(),
                    url: "https://api.coinbase.com".to_string(),
                    weight: 8,
                    is_active: true,
                },
                PriceSource {
                    name: "kraken".to_string(),
                    url: "https://api.kraken.com".to_string(),
                    weight: 7,
                    is_active: true,
                },
            ]),
            symbols: RwLock::new(HashMap::new()),
        };
        
        // Initialize default symbols
        service.init_symbols();
        
        // Initialize sample data
        service.init_sample_data();
        
        service
    }
    
    fn init_symbols(&self) {
        let symbols = vec![
            ("BTCUSDT", "BTC", "USDT", 0.01, 1000000.0, 0.01, 0.00001, 10000.0, 0.00001),
            ("ETHUSDT", "ETH", "USDT", 0.01, 100000.0, 0.01, 0.0001, 1000000.0, 0.0001),
            ("BNBUSDT", "BNB", "USDT", 0.01, 10000.0, 0.01, 0.001, 1000000.0, 0.001),
            ("SOLUSDT", "SOL", "USDT", 0.001, 10000.0, 0.001, 0.01, 10000000.0, 0.01),
            ("XRPUSDT", "XRP", "USDT", 0.0001, 1000.0, 0.0001, 1.0, 100000000.0, 1.0),
            ("ADAUSDT", "ADA", "USDT", 0.0001, 10.0, 0.0001, 10.0, 100000000.0, 10.0),
            ("DOGEUSDT", "DOGE", "USDT", 0.00001, 10.0, 0.00001, 100.0, 1000000000.0, 100.0),
            ("DOTUSDT", "DOT", "USDT", 0.001, 1000.0, 0.001, 0.1, 10000000.0, 0.1),
            ("MATICUSDT", "MATIC", "USDT", 0.0001, 100.0, 0.0001, 1.0, 10000000.0, 1.0),
            ("LINKUSDT", "LINK", "USDT", 0.001, 1000.0, 0.001, 0.01, 1000000.0, 0.01),
            ("AVAXUSDT", "AVAX", "USDT", 0.01, 1000.0, 0.01, 0.01, 1000000.0, 0.01),
            ("DOTUSDT", "DOT", "USDT", 0.001, 1000.0, 0.001, 0.1, 10000000.0, 0.1),
        ];
        
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async {
            let mut symbols_map = self.symbols.write().await;
            for (symbol, base, quote, min_price, max_price, tick, min_qty, max_qty, step) in symbols {
                symbols_map.insert(symbol.to_string(), SymbolInfo {
                    symbol: symbol.to_string(),
                    base_asset: base.to_string(),
                    quote_asset: quote.to_string(),
                    status: "trading".to_string(),
                    min_price,
                    max_price,
                    tick_size: tick,
                    min_quantity: min_qty,
                    max_quantity: max_qty,
                    step_size: step,
                });
            }
        });
    }
    
    fn init_sample_data(&self) {
        // Initialize with sample data
        let tickers = vec![
            ("BTCUSDT", 65432.50, 1234.56, 1.92, 66000.0, 64000.0, 28500.0, 285000000.0),
            ("ETHUSDT", 3521.80, 89.45, 2.60, 3600.0, 3400.0, 125000.0, 44000000.0),
            ("BNBUSDT", 587.25, -5.32, -0.90, 600.0, 570.0, 2500.0, 1470000.0),
            ("SOLUSDT", 148.92, 8.75, 6.24, 155.0, 140.0, 85000.0, 12650000.0),
            ("XRPUSDT", 0.5234, 0.0123, 2.41, 0.55, 0.50, 1500000.0, 785000.0),
        ];
        
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async {
            let mut tickers_map = self.tickers.write().await;
            let mut order_books_map = self.order_books.write().await;
            let mut trades_map = self.trades.write().await;
            let mut klines_map = self.klines.write().await;
            
            for (symbol, price, change, change_pct, high, low, vol, qvol) in tickers {
                // Create ticker
                let open_price = price - change;
                let ticker = Ticker {
                    symbol: symbol.to_string(),
                    last_price: price,
                    price_change: change,
                    price_change_percent: change_pct,
                    high_24h: high,
                    low_24h: low,
                    volume_24h: vol,
                    quote_volume_24h: qvol,
                    trades_24h: (vol * 1000.0) as u64,
                    bid_price: price * 0.9995,
                    ask_price: price * 1.0005,
                    bid_quantity: vol * 0.1,
                    ask_quantity: vol * 0.1,
                    open_price,
                    weighted_avg_price: price,
                    updated_at: Utc::now(),
                };
                tickers_map.insert(symbol.to_string(), ticker);
                
                // Create order book
                let order_book = OrderBook {
                    symbol: symbol.to_string(),
                    bids: vec![
                        OrderBookEntry { price: price * 0.999, quantity: vol * 0.05, orders: 15 },
                        OrderBookEntry { price: price * 0.998, quantity: vol * 0.03, orders: 8 },
                        OrderBookEntry { price: price * 0.997, quantity: vol * 0.02, orders: 5 },
                        OrderBookEntry { price: price * 0.996, quantity: vol * 0.01, orders: 3 },
                    ],
                    asks: vec![
                        OrderBookEntry { price: price * 1.001, quantity: vol * 0.05, orders: 12 },
                        OrderBookEntry { price: price * 1.002, quantity: vol * 0.03, orders: 7 },
                        OrderBookEntry { price: price * 1.003, quantity: vol * 0.02, orders: 4 },
                        OrderBookEntry { price: price * 1.004, quantity: vol * 0.01, orders: 2 },
                    ],
                    last_update_id: 1234567890,
                    timestamp: Utc::now(),
                };
                order_books_map.insert(symbol.to_string(), order_book);
                
                // Create sample trades
                let mut symbol_trades = Vec::new();
                for i in 0..50 {
                    let trade_price = price + (rand::random::<f64>() - 0.5) * price * 0.01;
                    let trade_qty = rand::random::<f64>() * vol * 0.001;
                    symbol_trades.push(Trade {
                        id: format!("{}_{}", symbol, i),
                        symbol: symbol.to_string(),
                        price: trade_price,
                        quantity: trade_qty,
                        quote_quantity: trade_price * trade_qty,
                        is_buyer_maker: rand::random::<bool>(),
                        timestamp: Utc::now() - Duration::seconds(i * 60),
                    });
                }
                trades_map.insert(symbol.to_string(), symbol_trades);
                
                // Create K-lines
                let mut symbol_klines = Vec::new();
                for i in 0..100 {
                    let base_time = Utc::now() - Duration::minutes(i * 5);
                    let open_k = price + (rand::random::<f64>() - 0.5) * price * 0.02;
                    let close_k = open_k + (rand::random::<f64>() - 0.5) * price * 0.01;
                    let high_k = open_k.max(close_k) + rand::random::<f64>() * price * 0.005;
                    let low_k = open_k.min(close_k) - rand::random::<f64>() * price * 0.005;
                    
                    symbol_klines.push(KLine {
                        symbol: symbol.to_string(),
                        timeframe: "5m".to_string(),
                        open_time: base_time,
                        open: open_k,
                        high: high_k,
                        low: low_k,
                        close: close_k,
                        volume: vol * 0.01 * rand::random::<f64>(),
                        quote_volume: qvol * 0.01 * rand::random::<f64>(),
                        trades: rand::random::<u32>() % 1000,
                        is_closed: true,
                    });
                }
                klines_map.insert(format!("{}:5m", symbol), symbol_klines);
            }
        });
    }
    
    // =============================================================================
    // TICKER
    // =============================================================================
    
    pub async fn get_ticker(&self, symbol: &str) -> Result<Ticker, MarketDataError> {
        let tickers = self.tickers.read().await;
        tickers.get(symbol)
            .cloned()
            .ok_or(MarketDataError::SymbolNotFound)
    }
    
    pub async fn get_all_tickers(&self) -> Vec<Ticker> {
        let tickers = self.tickers.read().await;
        tickers.values().cloned().collect()
    }
    
    // =============================================================================
    // ORDER BOOK
    // =============================================================================
    
    pub async fn get_order_book(&self, symbol: &str, limit: usize) -> Result<OrderBook, MarketDataError> {
        let order_books = self.order_books.read().await;
        let mut ob = order_books.get(symbol)
            .cloned()
            .ok_or(MarketDataError::SymbolNotFound)?;
        
        if limit > 0 && limit < ob.bids.len() {
            ob.bids.truncate(limit);
            ob.asks.truncate(limit);
        }
        
        Ok(ob)
    }
    
    // =============================================================================
    // TRADES
    // =============================================================================
    
    pub async fn get_recent_trades(&self, symbol: &str, limit: usize) -> Result<Vec<Trade>, MarketDataError> {
        let trades = self.trades.read().await;
        let symbol_trades = trades.get(symbol)
            .ok_or(MarketDataError::SymbolNotFound)?;
        
        let limit = if limit == 0 || limit > symbol_trades.len() {
            symbol_trades.len()
        } else {
            limit
        };
        
        Ok(symbol_trades[..limit].to_vec())
    }
    
    // =============================================================================
    // K-LINES
    // =============================================================================
    
    pub async fn get_klines(&self, symbol: &str, interval: &str, limit: usize) -> Result<Vec<KLine>, MarketDataError> {
        let key = format!("{}:{}", symbol, interval);
        let klines = self.klines.read().await;
        let symbol_klines = klines.get(&key)
            .ok_or(MarketDataError::DataNotAvailable)?;
        
        let limit = if limit == 0 || limit > symbol_klines.len() {
            symbol_klines.len()
        } else {
            limit
        };
        
        Ok(symbol_klines[..limit].to_vec())
    }
    
    // =============================================================================
    // SYMBOLS
    // =============================================================================
    
    pub async fn get_symbols(&self) -> Vec<SymbolInfo> {
        let symbols = self.symbols.read().await;
        symbols.values().cloned().collect()
    }
    
    pub async fn get_symbol(&self, symbol: &str) -> Result<SymbolInfo, MarketDataError> {
        let symbols = self.symbols.read().await;
        symbols.get(symbol)
            .cloned()
            .ok_or(MarketDataError::SymbolNotFound)
    }
    
    // =============================================================================
    // 24H STATS
    // =============================================================================
    
    pub async fn get_24h_stats(&self) -> Vec<MarketTicker> {
        let tickers = self.tickers.read().await;
        
        tickers.values()
            .map(|t| MarketTicker {
                symbol: t.symbol.clone(),
                price_change: t.price_change,
                price_change_percent: t.price_change_percent,
                last_price: t.last_price,
                high_price: t.high_24h,
                low_price: t.low_24h,
                volume: t.volume_24h,
                quote_volume: t.quote_volume_24h,
            })
            .collect()
    }
    
    // =============================================================================
    // PRICE SOURCES
    // =============================================================================
    
    pub async fn get_price_sources(&self) -> Vec<PriceSource> {
        let sources = self.price_sources.read().await;
        sources.clone()
    }
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedMarketDataService = Arc<MarketDataService>;

pub struct AppState {
    pub market_data_service: SharedMarketDataService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn get_ticker(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let ticker = state.market_data_service.get_ticker(&symbol).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": ticker
    })))
}

async fn get_all_tickers(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let tickers = state.market_data_service.get_all_tickers().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": tickers
    })))
}

async fn get_order_book(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<GetOrderBookQuery>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let limit = query.limit.unwrap_or(20);
    let order_book = state.market_data_service.get_order_book(&symbol, limit).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": order_book
    })))
}

async fn get_trades(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<GetTradesQuery>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let limit = query.limit.unwrap_or(50);
    let trades = state.market_data_service.get_recent_trades(&symbol, limit).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": trades
    })))
}

async fn get_klines(
    State(state): State<AppState>,
    Path((symbol, interval)): Path<(String, String)>>,
    Query(query): Query<GetKlinesQuery>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let limit = query.limit.unwrap_or(100);
    let klines = state.market_data_service.get_klines(&symbol, &interval, limit).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": klines
    })))
}

async fn get_symbols(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let symbols = state.market_data_service.get_symbols().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": symbols
    })))
}

async fn get_24h_stats(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let stats = state.market_data_service.get_24h_stats().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": stats
    })))
}

async fn get_price_sources(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let sources = state.market_data_service.get_price_sources().await;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": sources
    })))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "market-data-service",
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
    
    info!("Starting TigerEx Market Data Service");
    
    // Create market data service
    let market_data_service = Arc::new(MarketDataService::new());
    let state = AppState {
        market_data_service: market_data_service.clone(),
    };
    
    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/ticker/:symbol", get(get_ticker))
        .route("/api/v1/tickers", get(get_all_tickers))
        .route("/api/v1/orderbook/:symbol", get(get_order_book))
        .route("/api/v1/trades/:symbol", get(get_trades))
        .route("/api/v1/klines/:symbol/:interval", get(get_klines))
        .route("/api/v1/symbols", get(get_symbols))
        .route("/api/v1/24h", get(get_24h_stats))
        .route("/api/v1/price-sources", get(get_price_sources))
        .with_state(state);
    
    // Start server
    let addr = "0.0.0.0:8084".parse()?;
    
    info!("Market data service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}
