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

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use anyhow::Result;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::info;

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
            MarketDataError::SymbolNotFound => {
                (StatusCode::NOT_FOUND, "Symbol not found".to_string())
            }
            MarketDataError::InvalidTimeframe => {
                (StatusCode::BAD_REQUEST, "Invalid timeframe".to_string())
            }
            MarketDataError::DataNotAvailable => {
                (StatusCode::NOT_FOUND, "Data not available".to_string())
            }
            MarketDataError::InternalError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Supported candle intervals, in seconds.
pub const SUPPORTED_INTERVALS: &[(&str, i64)] = &[
    ("1m", 60),
    ("5m", 300),
    ("15m", 900),
    ("1h", 3_600),
    ("4h", 14_400),
    ("1d", 86_400),
];

/// Most recent trades retained per symbol.
const MAX_TRADES_PER_SYMBOL: usize = 50_000;

fn interval_seconds(interval: &str) -> Option<i64> {
    SUPPORTED_INTERVALS
        .iter()
        .find(|(name, _)| *name == interval)
        .map(|(_, seconds)| *seconds)
}

/// Market data store.
///
/// The service holds no canned values: every price, candle and trade originates
/// from an ingested trade or an ingested order book snapshot pushed by the
/// exchange's own matching engine. Until data arrives, reads report that data is
/// unavailable rather than returning invented numbers.
pub struct MarketDataService {
    /// Recent trades per symbol, oldest first.
    trades: RwLock<HashMap<String, VecDeque<Trade>>>,
    /// Latest order book snapshot per symbol.
    order_books: RwLock<HashMap<String, OrderBook>>,
    /// Tradable symbols, registered by the operator.
    symbols: RwLock<HashMap<String, SymbolInfo>>,
    /// Price feeds contributing to the exchange's own index.
    price_sources: RwLock<Vec<PriceSource>>,
}

impl MarketDataService {
    pub fn new() -> Self {
        Self {
            trades: RwLock::new(HashMap::new()),
            order_books: RwLock::new(HashMap::new()),
            symbols: RwLock::new(HashMap::new()),
            price_sources: RwLock::new(Vec::new()),
        }
    }

    /// Register a tradable symbol. Rejects duplicates.
    pub async fn register_symbol(&self, info: SymbolInfo) -> Result<(), MarketDataError> {
        if info.symbol.trim().is_empty() {
            return Err(MarketDataError::InternalError(
                "symbol must not be empty".to_string(),
            ));
        }
        if info.tick_size <= 0.0 || info.step_size <= 0.0 {
            return Err(MarketDataError::InternalError(
                "tick_size and step_size must be positive".to_string(),
            ));
        }
        if info.min_price > info.max_price {
            return Err(MarketDataError::InternalError(
                "min_price must not exceed max_price".to_string(),
            ));
        }
        if info.min_quantity > info.max_quantity {
            return Err(MarketDataError::InternalError(
                "min_quantity must not exceed max_quantity".to_string(),
            ));
        }

        let mut symbols = self.symbols.write().await;
        if symbols.contains_key(&info.symbol) {
            return Err(MarketDataError::InternalError(format!(
                "symbol {} is already registered",
                info.symbol
            )));
        }
        symbols.insert(info.symbol.clone(), info);
        Ok(())
    }

    pub async fn get_symbols(&self) -> Vec<SymbolInfo> {
        let symbols = self.symbols.read().await;
        let mut list: Vec<SymbolInfo> = symbols.values().cloned().collect();
        list.sort_by(|a, b| a.symbol.cmp(&b.symbol));
        list
    }

    pub async fn get_symbol(&self, symbol: &str) -> Result<SymbolInfo, MarketDataError> {
        self.symbols
            .read()
            .await
            .get(symbol)
            .cloned()
            .ok_or(MarketDataError::SymbolNotFound)
    }

    /// Register a price feed used to build the exchange's own index price.
    pub async fn register_price_source(&self, source: PriceSource) -> Result<(), MarketDataError> {
        if source.name.trim().is_empty() {
            return Err(MarketDataError::InternalError(
                "price source name must not be empty".to_string(),
            ));
        }
        if source.weight == 0 {
            return Err(MarketDataError::InternalError(
                "price source weight must be positive".to_string(),
            ));
        }

        let mut sources = self.price_sources.write().await;
        if sources.iter().any(|existing| existing.name == source.name) {
            return Err(MarketDataError::InternalError(format!(
                "price source {} is already registered",
                source.name
            )));
        }
        sources.push(source);
        Ok(())
    }

    pub async fn get_price_sources(&self) -> Vec<PriceSource> {
        self.price_sources.read().await.clone()
    }

    /// Record an executed trade and fold it into the symbol's history.
    ///
    /// This is the only way prices enter the service.
    pub async fn apply_trade(&self, trade: Trade) -> Result<(), MarketDataError> {
        if trade.price <= 0.0 || !trade.price.is_finite() {
            return Err(MarketDataError::InternalError(
                "trade price must be positive".to_string(),
            ));
        }
        if trade.quantity <= 0.0 || !trade.quantity.is_finite() {
            return Err(MarketDataError::InternalError(
                "trade quantity must be positive".to_string(),
            ));
        }

        {
            let symbols = self.symbols.read().await;
            if !symbols.contains_key(&trade.symbol) {
                return Err(MarketDataError::SymbolNotFound);
            }
        }

        let mut trades = self.trades.write().await;
        let history = trades.entry(trade.symbol.clone()).or_default();

        // Trades arrive in order; ignore a stale replay.
        if let Some(last) = history.back() {
            if trade.timestamp < last.timestamp {
                return Err(MarketDataError::InternalError(
                    "trade timestamp is older than the last ingested trade".to_string(),
                ));
            }
        }

        history.push_back(trade);
        while history.len() > MAX_TRADES_PER_SYMBOL {
            history.pop_front();
        }

        Ok(())
    }

    /// Replace the order book snapshot for a symbol.
    pub async fn apply_order_book(&self, book: OrderBook) -> Result<(), MarketDataError> {
        {
            let symbols = self.symbols.read().await;
            if !symbols.contains_key(&book.symbol) {
                return Err(MarketDataError::SymbolNotFound);
            }
        }

        let mut books = self.order_books.write().await;
        books.insert(book.symbol.clone(), book);
        Ok(())
    }

    /// Trades within the last 24 hours, newest first.
    async fn trades_in_window(&self, symbol: &str) -> Result<Vec<Trade>, MarketDataError> {
        let trades = self.trades.read().await;
        let history = trades.get(symbol).ok_or(MarketDataError::DataNotAvailable)?;

        let cutoff = Utc::now() - Duration::hours(24);
        let mut window: Vec<Trade> = history
            .iter()
            .filter(|trade| trade.timestamp >= cutoff)
            .cloned()
            .collect();
        window.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(window)
    }

    /// 24 hour ticker, computed from ingested trades.
    pub async fn get_ticker(&self, symbol: &str) -> Result<Ticker, MarketDataError> {
        let window = self.trades_in_window(symbol).await?;
        if window.is_empty() {
            return Err(MarketDataError::DataNotAvailable);
        }

        // `window` is newest first.
        let last_price = window[0].price;
        let open_price = window[window.len() - 1].price;
        let high_24h = window.iter().fold(f64::MIN, |acc, t| acc.max(t.price));
        let low_24h = window.iter().fold(f64::MAX, |acc, t| acc.min(t.price));
        let volume_24h: f64 = window.iter().map(|t| t.quantity).sum();
        let quote_volume_24h: f64 = window.iter().map(|t| t.quote_quantity).sum();

        let price_change = last_price - open_price;
        let price_change_percent = if open_price > 0.0 {
            price_change / open_price * 100.0
        } else {
            0.0
        };

        let (bid_price, bid_quantity, ask_price, ask_quantity) = {
            let books = self.order_books.read().await;
            match books.get(symbol) {
                Some(book) => (
                    book.bids.first().map(|e| e.price).unwrap_or(0.0),
                    book.bids.first().map(|e| e.quantity).unwrap_or(0.0),
                    book.asks.first().map(|e| e.price).unwrap_or(0.0),
                    book.asks.first().map(|e| e.quantity).unwrap_or(0.0),
                ),
                None => (0.0, 0.0, 0.0, 0.0),
            }
        };

        Ok(Ticker {
            symbol: symbol.to_string(),
            last_price,
            price_change,
            price_change_percent,
            high_24h,
            low_24h,
            volume_24h,
            quote_volume_24h,
            trades_24h: window.len() as u64,
            bid_price,
            ask_price,
            bid_quantity,
            ask_quantity,
            open_price,
            weighted_avg_price: if volume_24h > 0.0 {
                quote_volume_24h / volume_24h
            } else {
                0.0
            },
            updated_at: window[0].timestamp,
        })
    }

    pub async fn get_all_tickers(&self) -> Vec<Ticker> {
        let symbols: Vec<String> = self.symbols.read().await.keys().cloned().collect();
        let mut tickers = Vec::with_capacity(symbols.len());
        for symbol in symbols {
            if let Ok(ticker) = self.get_ticker(&symbol).await {
                tickers.push(ticker);
            }
        }
        tickers.sort_by(|a, b| a.symbol.cmp(&b.symbol));
        tickers
    }

    pub async fn get_order_book(
        &self,
        symbol: &str,
        limit: usize,
    ) -> Result<OrderBook, MarketDataError> {
        let books = self.order_books.read().await;
        let book = books
            .get(symbol)
            .cloned()
            .ok_or(MarketDataError::DataNotAvailable)?;

        let mut book = book;
        if limit > 0 {
            book.bids.truncate(limit);
            book.asks.truncate(limit);
        }
        Ok(book)
    }

    pub async fn get_recent_trades(
        &self,
        symbol: &str,
        limit: usize,
    ) -> Result<Vec<Trade>, MarketDataError> {
        let trades = self.trades.read().await;
        let history = trades.get(symbol).ok_or(MarketDataError::DataNotAvailable)?;

        // Newest first.
        let mut recent: Vec<Trade> = history.iter().rev().cloned().collect();
        if limit > 0 {
            recent.truncate(limit);
        }
        Ok(recent)
    }

    /// Aggregate ingested trades into candles.
    ///
    /// Candles are derived from the trade tape, so a candle can never disagree
    /// with the trades that produced it.
    pub async fn get_klines(
        &self,
        symbol: &str,
        interval: &str,
        limit: usize,
    ) -> Result<Vec<KLine>, MarketDataError> {
        let seconds = interval_seconds(interval).ok_or(MarketDataError::InvalidTimeframe)?;

        let trades = self.trades.read().await;
        let history = trades.get(symbol).ok_or(MarketDataError::DataNotAvailable)?;
        if history.is_empty() {
            return Err(MarketDataError::DataNotAvailable);
        }

        let mut candles: Vec<KLine> = Vec::new();
        for trade in history.iter() {
            let bucket = trade.timestamp.timestamp().div_euclid(seconds) * seconds;
            let open_time = DateTime::from_timestamp(bucket, 0).ok_or_else(|| {
                MarketDataError::InternalError("trade timestamp out of range".to_string())
            })?;

            match candles.last_mut() {
                Some(candle) if candle.open_time == open_time => {
                    candle.high = candle.high.max(trade.price);
                    candle.low = candle.low.min(trade.price);
                    candle.close = trade.price;
                    candle.volume += trade.quantity;
                    candle.quote_volume += trade.quote_quantity;
                    candle.trades += 1;
                }
                _ => candles.push(KLine {
                    symbol: symbol.to_string(),
                    timeframe: interval.to_string(),
                    open_time,
                    open: trade.price,
                    high: trade.price,
                    low: trade.price,
                    close: trade.price,
                    volume: trade.quantity,
                    quote_volume: trade.quote_quantity,
                    trades: 1,
                    is_closed: false,
                }),
            }
        }

        // Every bucket except the one in progress is final.
        let now = Utc::now().timestamp();
        let current_bucket = now.div_euclid(seconds) * seconds;
        for candle in candles.iter_mut() {
            candle.is_closed = candle.open_time.timestamp() != current_bucket;
        }

        if limit > 0 && candles.len() > limit {
            candles.drain(0..candles.len() - limit);
        }

        Ok(candles)
    }

    pub async fn get_24h_stats(&self) -> Vec<MarketTicker> {
        self.get_all_tickers()
            .await
            .into_iter()
            .map(|t| MarketTicker {
                symbol: t.symbol,
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
}

impl Default for MarketDataService {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedMarketDataService = Arc<MarketDataService>;

#[derive(Clone)]
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
    Path((symbol, interval)): Path<(String, String)>,
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

async fn ingest_trade(
    State(state): State<AppState>,
    Json(trade): Json<Trade>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    state.market_data_service.apply_trade(trade).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn ingest_order_book(
    State(state): State<AppState>,
    Json(book): Json<OrderBook>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    state.market_data_service.apply_order_book(book).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn register_symbol(
    State(state): State<AppState>,
    Json(info): Json<SymbolInfo>,
) -> Result<Json<serde_json::Value>, MarketDataError> {
    let symbol = info.symbol.clone();
    state.market_data_service.register_symbol(info).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": symbol })))
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

    // Symbols are configured by the operator; nothing is hard-coded.
    let symbols_file = std::env::var("MARKET_DATA_SYMBOLS_FILE").map_err(|_| {
        anyhow::anyhow!("MARKET_DATA_SYMBOLS_FILE must point at a symbol configuration file")
    })?;
    let contents = tokio::fs::read_to_string(&symbols_file).await?;
    let configured: Vec<SymbolInfo> = serde_json::from_str(&contents)?;
    for info in configured {
        market_data_service.register_symbol(info).await?;
    }
    info!(
        "Loaded {} symbols from {}",
        market_data_service.get_symbols().await.len(),
        symbols_file
    );

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
        .route("/api/v1/ingest/trade", post(ingest_trade))
        .route("/api/v1/ingest/orderbook", post(ingest_order_book))
        .route("/api/v1/symbols", post(register_symbol))
        .with_state(state);
    
    // Start server
    let addr: std::net::SocketAddr = "0.0.0.0:8084".parse()?;
    
    info!("Market data service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn symbol(name: &str) -> SymbolInfo {
        SymbolInfo {
            symbol: name.to_string(),
            base_asset: name.trim_end_matches("USDT").to_string(),
            quote_asset: "USDT".to_string(),
            status: "trading".to_string(),
            min_price: 0.01,
            max_price: 1_000_000.0,
            tick_size: 0.01,
            min_quantity: 0.00001,
            max_quantity: 10_000.0,
            step_size: 0.00001,
        }
    }

    fn trade(symbol: &str, price: f64, quantity: f64, seconds_ago: i64) -> Trade {
        Trade {
            id: format!("t-{price}-{seconds_ago}"),
            symbol: symbol.to_string(),
            price,
            quantity,
            quote_quantity: price * quantity,
            is_buyer_maker: false,
            timestamp: Utc::now() - Duration::seconds(seconds_ago),
        }
    }

    async fn service_with_symbol() -> MarketDataService {
        let service = MarketDataService::new();
        service.register_symbol(symbol("BTCUSDT")).await.unwrap();
        service
    }

    #[tokio::test]
    async fn no_data_is_reported_rather_than_invented() {
        let service = service_with_symbol().await;

        // Registered, but nothing has traded yet.
        assert!(matches!(
            service.get_ticker("BTCUSDT").await,
            Err(MarketDataError::DataNotAvailable)
        ));
        assert!(matches!(
            service.get_order_book("BTCUSDT", 10).await,
            Err(MarketDataError::DataNotAvailable)
        ));
        assert!(matches!(
            service.get_recent_trades("BTCUSDT", 10).await,
            Err(MarketDataError::DataNotAvailable)
        ));
        assert!(service.get_all_tickers().await.is_empty());
        assert!(service.get_24h_stats().await.is_empty());
        assert!(service.get_price_sources().await.is_empty());
    }

    #[tokio::test]
    async fn unknown_symbol_is_rejected() {
        let service = service_with_symbol().await;

        assert!(matches!(
            service.get_symbol("NOPE").await,
            Err(MarketDataError::SymbolNotFound)
        ));
        assert!(matches!(
            service
                .apply_trade(trade("NOPE", 1.0, 1.0, 0))
                .await,
            Err(MarketDataError::SymbolNotFound)
        ));
    }

    #[tokio::test]
    async fn duplicate_symbol_is_rejected() {
        let service = service_with_symbol().await;
        assert!(service.register_symbol(symbol("BTCUSDT")).await.is_err());
        assert!(service.register_symbol(symbol("  ")).await.is_err());
    }

    #[tokio::test]
    async fn invalid_trades_are_rejected() {
        let service = service_with_symbol().await;

        assert!(service.apply_trade(trade("BTCUSDT", 0.0, 1.0, 0)).await.is_err());
        assert!(service.apply_trade(trade("BTCUSDT", -1.0, 1.0, 0)).await.is_err());
        assert!(service.apply_trade(trade("BTCUSDT", 100.0, 0.0, 0)).await.is_err());
        assert!(service.apply_trade(trade("BTCUSDT", 100.0, -1.0, 0)).await.is_err());
        assert!(service.get_all_tickers().await.is_empty());
    }

    #[tokio::test]
    async fn stale_trades_are_rejected() {
        let service = service_with_symbol().await;
        service.apply_trade(trade("BTCUSDT", 100.0, 1.0, 10)).await.unwrap();

        assert!(service.apply_trade(trade("BTCUSDT", 99.0, 1.0, 60)).await.is_err());
    }

    #[tokio::test]
    async fn ticker_is_derived_from_ingested_trades() {
        let service = service_with_symbol().await;
        service.apply_trade(trade("BTCUSDT", 100.0, 1.0, 300)).await.unwrap();
        service.apply_trade(trade("BTCUSDT", 120.0, 2.0, 200)).await.unwrap();
        service.apply_trade(trade("BTCUSDT", 90.0, 1.0, 100)).await.unwrap();
        service.apply_trade(trade("BTCUSDT", 110.0, 1.0, 0)).await.unwrap();

        let ticker = service.get_ticker("BTCUSDT").await.unwrap();
        assert_eq!(ticker.last_price, 110.0);
        assert_eq!(ticker.open_price, 100.0);
        assert_eq!(ticker.high_24h, 120.0);
        assert_eq!(ticker.low_24h, 90.0);
        assert_eq!(ticker.volume_24h, 5.0);
        assert_eq!(ticker.trades_24h, 4);
        assert!((ticker.price_change - 10.0).abs() < 1e-9);
        assert!((ticker.price_change_percent - 10.0).abs() < 1e-9);
        // (100*1 + 120*2 + 90*1 + 110*1) / 5
        assert!((ticker.weighted_avg_price - 108.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn trades_outside_the_24h_window_are_excluded() {
        let service = service_with_symbol().await;
        service.apply_trade(trade("BTCUSDT", 500.0, 1.0, 90_000)).await.unwrap();
        service.apply_trade(trade("BTCUSDT", 100.0, 1.0, 60)).await.unwrap();

        let ticker = service.get_ticker("BTCUSDT").await.unwrap();
        assert_eq!(ticker.high_24h, 100.0);
        assert_eq!(ticker.volume_24h, 1.0);
        assert_eq!(ticker.trades_24h, 1);
    }

    #[tokio::test]
    async fn ticker_uses_order_book_for_bid_ask() {
        let service = service_with_symbol().await;
        service.apply_trade(trade("BTCUSDT", 100.0, 1.0, 10)).await.unwrap();

        service
            .apply_order_book(OrderBook {
                symbol: "BTCUSDT".to_string(),
                bids: vec![OrderBookEntry { price: 99.5, quantity: 3.0, orders: 2 }],
                asks: vec![OrderBookEntry { price: 100.5, quantity: 4.0, orders: 3 }],
                last_update_id: 42,
                timestamp: Utc::now(),
            })
            .await
            .unwrap();

        let ticker = service.get_ticker("BTCUSDT").await.unwrap();
        assert_eq!(ticker.bid_price, 99.5);
        assert_eq!(ticker.bid_quantity, 3.0);
        assert_eq!(ticker.ask_price, 100.5);
        assert_eq!(ticker.ask_quantity, 4.0);
    }

    #[tokio::test]
    async fn recent_trades_are_newest_first_and_limited() {
        let service = service_with_symbol().await;
        for i in 0..5 {
            service
                .apply_trade(trade("BTCUSDT", 100.0 + i as f64, 1.0, 100 - i * 10))
                .await
                .unwrap();
        }

        let recent = service.get_recent_trades("BTCUSDT", 3).await.unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].price, 104.0);
        assert_eq!(recent[2].price, 102.0);
    }

    #[tokio::test]
    async fn klines_aggregate_the_trade_tape() {
        let service = service_with_symbol().await;

        // Two trades in one 5m bucket, one in the next.
        let base = (Utc::now().timestamp() / 300) * 300 - 600;
        for (offset, price) in [(0i64, 100.0), (60, 130.0), (300, 90.0)] {
            let mut t = trade("BTCUSDT", price, 1.0, 0);
            t.timestamp = DateTime::from_timestamp(base + offset, 0).unwrap();
            service.apply_trade(t).await.unwrap();
        }

        let candles = service.get_klines("BTCUSDT", "5m", 100).await.unwrap();
        assert_eq!(candles.len(), 2);

        let first = &candles[0];
        assert_eq!(first.open, 100.0);
        assert_eq!(first.high, 130.0);
        assert_eq!(first.low, 100.0);
        assert_eq!(first.close, 130.0);
        assert_eq!(first.volume, 2.0);
        assert_eq!(first.trades, 2);
        assert!(first.is_closed);

        let second = &candles[1];
        assert_eq!(second.open, 90.0);
        assert_eq!(second.trades, 1);
    }

    #[tokio::test]
    async fn klines_reject_unknown_intervals() {
        let service = service_with_symbol().await;
        service.apply_trade(trade("BTCUSDT", 100.0, 1.0, 0)).await.unwrap();

        assert!(matches!(
            service.get_klines("BTCUSDT", "3s", 10).await,
            Err(MarketDataError::InvalidTimeframe)
        ));
    }

    #[tokio::test]
    async fn klines_are_limited_to_the_newest_candles() {
        let service = service_with_symbol().await;
        for i in 0..10 {
            let mut t = trade("BTCUSDT", 100.0 + i as f64, 1.0, 0);
            t.timestamp = Utc::now() - Duration::minutes(10 - i);
            service.apply_trade(t).await.unwrap();
        }

        let candles = service.get_klines("BTCUSDT", "1m", 3).await.unwrap();
        assert_eq!(candles.len(), 3);
        // Newest candle is last.
        assert_eq!(candles[2].close, 109.0);
    }

    #[tokio::test]
    async fn price_sources_must_be_valid_and_unique() {
        let service = MarketDataService::new();

        let mut bad = PriceSource {
            name: String::new(),
            url: "https://oracle.tigerex.internal".to_string(),
            weight: 1,
            is_active: true,
        };
        assert!(service.register_price_source(bad.clone()).await.is_err());

        bad.name = "own-oracle".to_string();
        bad.weight = 0;
        assert!(service.register_price_source(bad.clone()).await.is_err());

        bad.weight = 10;
        service.register_price_source(bad.clone()).await.unwrap();
        assert!(service.register_price_source(bad).await.is_err());
        assert_eq!(service.get_price_sources().await.len(), 1);
    }

    #[tokio::test]
    async fn order_book_for_unknown_symbol_is_rejected() {
        let service = service_with_symbol().await;
        assert!(service
            .apply_order_book(OrderBook {
                symbol: "NOPE".to_string(),
                bids: vec![],
                asks: vec![],
                last_update_id: 1,
                timestamp: Utc::now(),
            })
            .await
            .is_err());
    }

    #[tokio::test]
    async fn depth_limit_truncates_both_sides() {
        let service = service_with_symbol().await;
        service
            .apply_order_book(OrderBook {
                symbol: "BTCUSDT".to_string(),
                bids: (0..10)
                    .map(|i| OrderBookEntry {
                        price: 100.0 - i as f64,
                        quantity: 1.0,
                        orders: 1,
                    })
                    .collect(),
                asks: (0..10)
                    .map(|i| OrderBookEntry {
                        price: 101.0 + i as f64,
                        quantity: 1.0,
                        orders: 1,
                    })
                    .collect(),
                last_update_id: 1,
                timestamp: Utc::now(),
            })
            .await
            .unwrap();

        let book = service.get_order_book("BTCUSDT", 3).await.unwrap();
        assert_eq!(book.bids.len(), 3);
        assert_eq!(book.asks.len(), 3);

        let full = service.get_order_book("BTCUSDT", 0).await.unwrap();
        assert_eq!(full.bids.len(), 10);
    }
}
