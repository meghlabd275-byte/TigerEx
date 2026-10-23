//! TigerEx Oracle Service
//! Self-built price aggregation for TigerEx's own markets.
//!
//! Design principles:
//! - No dependency on any external exchange. Prices come from TigerEx's own
//!   price reporters (spot, futures, margin, OTC and node venues) that submit
//!   observations to this service.
//! - No fabricated data. When there are not enough fresh observations the
//!   service fails closed with an error instead of inventing a price.
//! - Outlier and staleness rejection so a single bad reporter cannot move the
//!   aggregated mark price.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum OracleError {
    #[error("Price not available")]
    PriceNotAvailable,

    #[error("Source not available")]
    SourceNotAvailable,

    #[error("Invalid symbol")]
    InvalidSymbol,

    #[error("Price deviation too high")]
    PriceDeviationTooHigh,

    #[error("Insufficient sources")]
    InsufficientSources,

    #[error("Invalid observation: {0}")]
    InvalidObservation(String),
}

impl IntoResponse for OracleError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            OracleError::PriceNotAvailable => (StatusCode::SERVICE_UNAVAILABLE, "Price not available".to_string()),
            OracleError::SourceNotAvailable => (StatusCode::SERVICE_UNAVAILABLE, "Source not available".to_string()),
            OracleError::InvalidSymbol => (StatusCode::BAD_REQUEST, "Invalid symbol".to_string()),
            OracleError::PriceDeviationTooHigh => (StatusCode::BAD_REQUEST, "Price deviation too high".to_string()),
            OracleError::InsufficientSources => (StatusCode::BAD_REQUEST, "Insufficient sources".to_string()),
            OracleError::InvalidObservation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
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

/// A single price observation submitted by a TigerEx price reporter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceFeed {
    pub symbol: String,
    pub price: f64,
    pub timestamp: DateTime<Utc>,
    pub source: String,
    pub volume_24h: f64,
    pub bid: f64,
    pub ask: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedPrice {
    pub symbol: String,
    pub price: f64,
    pub timestamp: DateTime<Utc>,
    pub sources: Vec<String>,
    pub bid: f64,
    pub ask: f64,
    pub spread: f64,
    pub volume_24h: f64,
    pub price_change_24h: f64,
    pub price_change_percent_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub weighted_avg_price: f64,
}

/// A price reporter registered with the oracle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSource {
    pub name: String,
    /// Kind of reporter: spot, futures, margin, otc, p2p or node.
    pub kind: String,
    pub enabled: bool,
    pub weight: u8,
    pub last_update: Option<DateTime<Utc>>,
    pub is_healthy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub condition: AlertCondition,
    pub target_price: f64,
    pub enabled: bool,
    pub triggered: bool,
    pub triggered_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertCondition {
    Above,
    Below,
    CrossesAbove,
    CrossesBelow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoricalPrice {
    pub symbol: String,
    pub price: f64,
    pub timestamp: DateTime<Utc>,
    pub source: String,
    pub volume: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TWAPCalculation {
    pub symbol: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub total_volume: f64,
    pub weighted_avg_price: f64,
    pub sample_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VWAPCalculation {
    pub symbol: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub volume_weighted_avg_price: f64,
    pub total_volume: f64,
    pub total_quote_volume: f64,
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct GetPriceQuery {
    pub min_sources: Option<usize>,
    pub limit: Option<usize>,
}

/// A price observation pushed by an authorised TigerEx reporter.
#[derive(Debug, Deserialize)]
pub struct SubmitPriceRequest {
    pub source: String,
    pub symbol: String,
    pub price: f64,
    pub bid: f64,
    pub ask: f64,
    pub volume_24h: f64,
    /// Reporter confidence in [0, 1].
    pub confidence: f64,
}

#[derive(Debug, Deserialize)]
pub struct CreateAlertRequest {
    pub user_id: String,
    pub symbol: String,
    pub condition: AlertCondition,
    pub target_price: f64,
}

#[derive(Debug, Deserialize)]
pub struct RegisterSourceRequest {
    pub name: String,
    pub kind: String,
    pub weight: u8,
}

// =============================================================================
// ORACLE SERVICE
// =============================================================================

pub struct OracleService {
    /// Registered price reporters.
    sources: RwLock<HashMap<String, PriceSource>>,

    /// Latest observation per source per symbol.
    source_prices: RwLock<HashMap<String, HashMap<String, PriceFeed>>>,

    /// Aggregated prices.
    aggregated_prices: RwLock<HashMap<String, AggregatedPrice>>,

    /// Price history per symbol.
    price_history: RwLock<HashMap<String, Vec<HistoricalPrice>>>,

    /// Price alerts per user.
    alerts: RwLock<HashMap<String, Vec<PriceAlert>>>,

    /// Symbol configurations.
    symbols: RwLock<HashMap<String, SymbolConfig>>,

    /// Observations older than this are ignored.
    max_age: Duration,
}

#[derive(Debug, Clone)]
pub struct SymbolConfig {
    pub symbol: String,
    pub enabled: bool,
    pub min_sources: usize,
    pub max_deviation_percent: f64,
}

impl Default for OracleService {
    fn default() -> Self {
        Self::new()
    }
}

impl OracleService {
    pub fn new() -> Self {
        Self {
            sources: RwLock::new(HashMap::new()),
            source_prices: RwLock::new(HashMap::new()),
            aggregated_prices: RwLock::new(HashMap::new()),
            price_history: RwLock::new(HashMap::new()),
            alerts: RwLock::new(HashMap::new()),
            symbols: RwLock::new(HashMap::new()),
            max_age: Duration::from_secs(30),
        }
    }

    /// Register a symbol for aggregation. Idempotent.
    pub async fn register_symbol(&self, symbol: &str, min_sources: usize, max_deviation_percent: f64) {
        self.symbols.write().await.insert(
            symbol.to_uppercase(),
            SymbolConfig {
                symbol: symbol.to_uppercase(),
                enabled: true,
                min_sources,
                max_deviation_percent,
            },
        );
    }

    /// Register a TigerEx price reporter.
    pub async fn register_source(
        &self,
        name: &str,
        kind: &str,
        weight: u8,
    ) -> Result<PriceSource, OracleError> {
        if name.trim().is_empty() {
            return Err(OracleError::InvalidObservation(
                "source name must not be empty".to_string(),
            ));
        }
        let source = PriceSource {
            name: name.to_string(),
            kind: kind.to_string(),
            enabled: true,
            weight,
            last_update: None,
            is_healthy: true,
        };
        self.sources.write().await.insert(name.to_string(), source.clone());
        Ok(source)
    }

    /// Record a price observation from a registered reporter.
    pub async fn submit_price(&self, request: SubmitPriceRequest) -> Result<PriceFeed, OracleError> {
        if !request.price.is_finite() || request.price <= 0.0 {
            return Err(OracleError::InvalidObservation(
                "price must be a positive finite number".to_string(),
            ));
        }
        if !request.bid.is_finite() || !request.ask.is_finite() || request.bid <= 0.0 || request.ask <= 0.0 {
            return Err(OracleError::InvalidObservation(
                "bid and ask must be positive finite numbers".to_string(),
            ));
        }
        if request.bid > request.ask {
            return Err(OracleError::InvalidObservation(
                "bid must not exceed ask".to_string(),
            ));
        }
        if !(0.0..=1.0).contains(&request.confidence) {
            return Err(OracleError::InvalidObservation(
                "confidence must be within [0, 1]".to_string(),
            ));
        }
        if !request.volume_24h.is_finite() || request.volume_24h < 0.0 {
            return Err(OracleError::InvalidObservation(
                "volume_24h must be non-negative".to_string(),
            ));
        }

        let symbol = request.symbol.to_uppercase();
        {
            let symbols = self.symbols.read().await;
            let config = symbols.get(&symbol).ok_or(OracleError::InvalidSymbol)?;
            if !config.enabled {
                return Err(OracleError::InvalidSymbol);
            }
        }

        let now = Utc::now();
        {
            let mut sources = self.sources.write().await;
            let source = sources
                .get_mut(&request.source)
                .ok_or(OracleError::SourceNotAvailable)?;
            if !source.enabled {
                return Err(OracleError::SourceNotAvailable);
            }
            source.last_update = Some(now);
            source.is_healthy = true;
        }

        let feed = PriceFeed {
            symbol: symbol.clone(),
            price: request.price,
            timestamp: now,
            source: request.source.clone(),
            volume_24h: request.volume_24h,
            bid: request.bid,
            ask: request.ask,
            confidence: request.confidence,
        };

        self.source_prices
            .write()
            .await
            .entry(request.source.clone())
            .or_default()
            .insert(symbol, feed.clone());

        Ok(feed)
    }

    /// Aggregate the freshest observations for a symbol.
    ///
    /// Fails closed when there are fewer than the required number of fresh
    /// observations, and drops outliers beyond the symbol's deviation band.
    pub async fn aggregate_prices(
        &self,
        symbol: &str,
        min_sources: usize,
    ) -> Result<AggregatedPrice, OracleError> {
        let symbol = symbol.to_uppercase();
        let (min_required, max_deviation) = {
            let symbols = self.symbols.read().await;
            let config = symbols.get(&symbol).ok_or(OracleError::InvalidSymbol)?;
            if !config.enabled {
                return Err(OracleError::InvalidSymbol);
            }
            (min_sources.max(config.min_sources), config.max_deviation_percent)
        };

        let now = Utc::now();
        let cutoff = now
            - chrono::Duration::from_std(self.max_age)
                .unwrap_or_else(|_| chrono::Duration::seconds(30));

        let mut fresh: Vec<(PriceFeed, u8)> = Vec::new();
        {
            let sources = self.sources.read().await;
            let prices = self.source_prices.read().await;
            for (name, per_symbol) in prices.iter() {
                let Some(source) = sources.get(name) else {
                    continue;
                };
                if !source.enabled {
                    continue;
                }
                if let Some(feed) = per_symbol.get(&symbol) {
                    if feed.timestamp >= cutoff && feed.confidence > 0.0 {
                        fresh.push((feed.clone(), source.weight));
                    }
                }
            }
        }

        if fresh.len() < min_required {
            return Err(OracleError::InsufficientSources);
        }

        let mut prices_only: Vec<f64> = fresh.iter().map(|(feed, _)| feed.price).collect();
        prices_only.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = prices_only[prices_only.len() / 2];
        if median <= 0.0 {
            return Err(OracleError::PriceNotAvailable);
        }

        let kept: Vec<(PriceFeed, u8)> = fresh
            .into_iter()
            .filter(|(feed, _)| ((feed.price - median).abs() / median) * 100.0 <= max_deviation)
            .collect();

        if kept.len() < min_required {
            return Err(OracleError::PriceDeviationTooHigh);
        }

        let mut total_weight = 0.0_f64;
        let mut weighted_sum = 0.0_f64;
        let mut bid_sum = 0.0_f64;
        let mut ask_sum = 0.0_f64;
        let mut volume_sum = 0.0_f64;

        for (feed, weight) in &kept {
            let effective = (*weight as f64) * feed.confidence;
            total_weight += effective;
            weighted_sum += feed.price * effective;
            bid_sum += feed.bid * effective;
            ask_sum += feed.ask * effective;
            volume_sum += feed.volume_24h;
        }

        if total_weight <= 0.0 {
            return Err(OracleError::InsufficientSources);
        }

        let avg_price = weighted_sum / total_weight;
        let avg_bid = bid_sum / total_weight;
        let avg_ask = ask_sum / total_weight;

        // 24h statistics are derived from stored history, never invented.
        let (high_24h, low_24h, change_24h) = {
            let history = self.price_history.read().await;
            let day_ago = now - chrono::Duration::hours(24);
            let recent: Vec<HistoricalPrice> = history
                .get(&symbol)
                .map(|entries| {
                    entries
                        .iter()
                        .filter(|entry| entry.timestamp >= day_ago)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();

            if recent.is_empty() {
                (avg_price, avg_price, 0.0)
            } else {
                let high = recent.iter().map(|entry| entry.price).fold(f64::MIN, f64::max);
                let low = recent.iter().map(|entry| entry.price).fold(f64::MAX, f64::min);
                let open = recent.first().map(|entry| entry.price).unwrap_or(avg_price);
                (high.max(avg_price), low.min(avg_price), avg_price - open)
            }
        };

        let price_change_percent = if avg_price > 0.0 {
            (change_24h / avg_price) * 100.0
        } else {
            0.0
        };

        let aggregated = AggregatedPrice {
            symbol: symbol.clone(),
            price: avg_price,
            timestamp: now,
            sources: kept.iter().map(|(feed, _)| feed.source.clone()).collect(),
            bid: avg_bid,
            ask: avg_ask,
            spread: avg_ask - avg_bid,
            volume_24h: volume_sum,
            price_change_24h: change_24h,
            price_change_percent_24h: price_change_percent,
            high_24h,
            low_24h,
            weighted_avg_price: avg_price,
        };

        self.aggregated_prices
            .write()
            .await
            .insert(symbol.clone(), aggregated.clone());

        {
            let mut history = self.price_history.write().await;
            let entries = history.entry(symbol).or_default();
            entries.push(HistoricalPrice {
                symbol: aggregated.symbol.clone(),
                price: avg_price,
                timestamp: now,
                source: "aggregated".to_string(),
                volume: volume_sum,
            });
            // Bound memory to roughly one day of per-second samples.
            let max_entries = 86_400usize;
            if entries.len() > max_entries {
                let excess = entries.len() - max_entries;
                entries.drain(0..excess);
            }
        }

        Ok(aggregated)
    }

    // =============================================================================
    // PRICE ALERTS
    // =============================================================================

    pub async fn create_alert(&self, request: CreateAlertRequest) -> Result<PriceAlert, OracleError> {
        if !request.target_price.is_finite() || request.target_price <= 0.0 {
            return Err(OracleError::InvalidObservation(
                "target_price must be positive".to_string(),
            ));
        }
        {
            let symbols = self.symbols.read().await;
            if !symbols.contains_key(&request.symbol.to_uppercase()) {
                return Err(OracleError::InvalidSymbol);
            }
        }

        let alert = PriceAlert {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: request.user_id,
            symbol: request.symbol.to_uppercase(),
            condition: request.condition,
            target_price: request.target_price,
            enabled: true,
            triggered: false,
            triggered_at: None,
            created_at: Utc::now(),
        };

        self.alerts
            .write()
            .await
            .entry(alert.user_id.clone())
            .or_default()
            .push(alert.clone());

        info!("Price alert created: {} for {} at {}", alert.id, alert.symbol, alert.target_price);

        Ok(alert)
    }

    /// Evaluate alerts for a symbol against a new price and mark them triggered.
    pub async fn check_alerts(&self, symbol: &str, current_price: f64) -> Vec<PriceAlert> {
        let symbol = symbol.to_uppercase();
        let mut triggered = Vec::new();
        let mut alerts = self.alerts.write().await;

        for user_alerts in alerts.values_mut() {
            for alert in user_alerts.iter_mut() {
                if alert.symbol != symbol || !alert.enabled || alert.triggered {
                    continue;
                }
                let should_trigger = match alert.condition {
                    AlertCondition::Above | AlertCondition::CrossesAbove => current_price >= alert.target_price,
                    AlertCondition::Below | AlertCondition::CrossesBelow => current_price <= alert.target_price,
                };
                if should_trigger {
                    alert.triggered = true;
                    alert.triggered_at = Some(Utc::now());
                    triggered.push(alert.clone());
                }
            }
        }

        triggered
    }

    // =============================================================================
    // HISTORICAL DATA
    // =============================================================================

    pub async fn get_history(&self, symbol: &str, limit: usize) -> Vec<HistoricalPrice> {
        let symbol = symbol.to_uppercase();
        let history = self.price_history.read().await;
        history
            .get(&symbol)
            .map(|prices| {
                let start = prices.len().saturating_sub(limit);
                prices[start..].to_vec()
            })
            .unwrap_or_default()
    }

    /// Time-weighted average price over the stored history.
    pub async fn calculate_twap(&self, symbol: &str, minutes: u32) -> Result<TWAPCalculation, OracleError> {
        let samples = self.window_samples(symbol, minutes).await?;

        let mut weighted = 0.0_f64;
        let mut total_time = 0.0_f64;
        for pair in samples.windows(2) {
            let (previous, current) = (&pair[0], &pair[1]);
            let seconds = (current.timestamp - previous.timestamp).num_milliseconds() as f64 / 1000.0;
            if seconds <= 0.0 {
                continue;
            }
            weighted += current.price * seconds;
            total_time += seconds;
        }

        if total_time <= 0.0 {
            return Err(OracleError::PriceNotAvailable);
        }

        let now = Utc::now();
        Ok(TWAPCalculation {
            symbol: symbol.to_uppercase(),
            start_time: now - chrono::Duration::minutes(minutes as i64),
            end_time: now,
            total_volume: samples.iter().map(|entry| entry.volume).sum(),
            weighted_avg_price: weighted / total_time,
            sample_count: samples.len() as u32,
        })
    }

    /// Volume-weighted average price over the stored history.
    pub async fn calculate_vwap(&self, symbol: &str, minutes: u32) -> Result<VWAPCalculation, OracleError> {
        let samples = self.window_samples(symbol, minutes).await?;

        let total_volume: f64 = samples.iter().map(|entry| entry.volume).sum();
        let total_quote_volume: f64 = samples.iter().map(|entry| entry.price * entry.volume).sum();

        if total_volume <= 0.0 {
            return Err(OracleError::PriceNotAvailable);
        }

        let now = Utc::now();
        Ok(VWAPCalculation {
            symbol: symbol.to_uppercase(),
            start_time: now - chrono::Duration::minutes(minutes as i64),
            end_time: now,
            volume_weighted_avg_price: total_quote_volume / total_volume,
            total_volume,
            total_quote_volume,
        })
    }

    async fn window_samples(&self, symbol: &str, minutes: u32) -> Result<Vec<HistoricalPrice>, OracleError> {
        if minutes == 0 {
            return Err(OracleError::InvalidObservation(
                "minutes must be positive".to_string(),
            ));
        }
        let symbol = symbol.to_uppercase();
        let cutoff = Utc::now() - chrono::Duration::minutes(minutes as i64);
        let history = self.price_history.read().await;
        let samples: Vec<HistoricalPrice> = history
            .get(&symbol)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|entry| entry.timestamp >= cutoff)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();

        if samples.is_empty() {
            return Err(OracleError::PriceNotAvailable);
        }
        Ok(samples)
    }

    // =============================================================================
    // SOURCE MANAGEMENT
    // =============================================================================

    pub async fn get_sources(&self) -> Vec<PriceSource> {
        self.sources.read().await.values().cloned().collect()
    }

    pub async fn get_source(&self, name: &str) -> Option<PriceSource> {
        self.sources.read().await.get(name).cloned()
    }
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedOracleService = Arc<OracleService>;

#[derive(Clone)]
pub struct AppState {
    pub oracle_service: SharedOracleService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn get_price(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<GetPriceQuery>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let min_sources = query.min_sources.unwrap_or(2);
    let price = state.oracle_service.aggregate_prices(&symbol, min_sources).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": price
    })))
}

async fn get_all_prices(State(state): State<AppState>) -> Result<Json<serde_json::Value>, OracleError> {
    let symbols: Vec<String> = state.oracle_service.symbols.read().await.keys().cloned().collect();
    let mut prices = Vec::new();

    for symbol in symbols {
        match state.oracle_service.aggregate_prices(&symbol, 1).await {
            Ok(price) => prices.push(price),
            Err(error) => warn!("No aggregate for {}: {}", symbol, error),
        }
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "data": prices
    })))
}

async fn get_sources(State(state): State<AppState>) -> Result<Json<serde_json::Value>, OracleError> {
    let sources = state.oracle_service.get_sources().await;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": sources
    })))
}

async fn get_history(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<GetPriceQuery>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let limit = query.limit.unwrap_or(100);
    let history = state.oracle_service.get_history(&symbol, limit).await;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": history
    })))
}

async fn submit_price(
    State(state): State<AppState>,
    Json(request): Json<SubmitPriceRequest>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let feed = state.oracle_service.submit_price(request).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": feed
    })))
}

async fn register_source(
    State(state): State<AppState>,
    Json(request): Json<RegisterSourceRequest>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let source = state
        .oracle_service
        .register_source(&request.name, &request.kind, request.weight)
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": source
    })))
}

async fn create_alert(
    State(state): State<AppState>,
    Json(request): Json<CreateAlertRequest>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let alert = state.oracle_service.create_alert(request).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": alert
    })))
}

async fn calculate_twap(
    State(state): State<AppState>,
    Path((symbol, minutes)): Path<(String, u32)>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let twap = state.oracle_service.calculate_twap(&symbol, minutes).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": twap
    })))
}

async fn calculate_vwap(
    State(state): State<AppState>,
    Path((symbol, minutes)): Path<(String, u32)>,
) -> Result<Json<serde_json::Value>, OracleError> {
    let vwap = state.oracle_service.calculate_vwap(&symbol, minutes).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "data": vwap
    })))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "oracle-service",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// =============================================================================
// MAIN
// =============================================================================

/// Symbols the exchange trades. Prices come from reporters, never hard-coded.
fn default_symbols() -> Vec<(&'static str, usize)> {
    vec![
        ("BTCUSDT", 2),
        ("ETHUSDT", 2),
        ("TGRUSDT", 2),
        ("SOLUSDT", 2),
        ("BTCUSDC", 2),
        ("ETHUSDC", 2),
        ("BTCRUSD", 2),
        ("ETHRUSD", 2),
        ("TGRRUSD", 2),
    ]
}

/// TigerEx's own price reporters. No external exchange is used.
fn default_sources() -> Vec<(&'static str, &'static str, u8)> {
    vec![
        ("tigerex-spot", "spot", 10),
        ("tigerex-futures", "futures", 9),
        ("tigerex-margin", "margin", 7),
        ("tigerex-otc", "otc", 6),
        ("tigerex-p2p", "p2p", 4),
        ("tigerex-node", "node", 5),
    ]
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    info!("Starting TigerEx Oracle Service (self-built, no external exchange dependency)");

    let oracle_service = Arc::new(OracleService::new());

    for (symbol, min_sources) in default_symbols() {
        oracle_service.register_symbol(symbol, min_sources, 5.0).await;
    }
    for (name, kind, weight) in default_sources() {
        oracle_service.register_source(name, kind, weight).await?;
    }

    let state = AppState {
        oracle_service: oracle_service.clone(),
    };

    // Periodically re-aggregate every symbol from freshly submitted observations.
    let oracle_clone = oracle_service.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            let symbols: Vec<String> = oracle_clone.symbols.read().await.keys().cloned().collect();
            for symbol in symbols {
                if let Ok(price) = oracle_clone.aggregate_prices(&symbol, 1).await {
                    let _ = oracle_clone.check_alerts(&symbol, price.price).await;
                }
            }
        }
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/price/:symbol", get(get_price))
        .route("/api/v1/prices", get(get_all_prices))
        .route("/api/v1/sources", get(get_sources))
        .route("/api/v1/sources/register", post(register_source))
        .route("/api/v1/submit", post(submit_price))
        .route("/api/v1/history/:symbol", get(get_history))
        .route("/api/v1/alerts", post(create_alert))
        .route("/api/v1/twap/:symbol/:minutes", get(calculate_twap))
        .route("/api/v1/vwap/:symbol/:minutes", get(calculate_vwap))
        .with_state(state);

    let addr: std::net::SocketAddr = "0.0.0.0:8085".parse()?;
    info!("Oracle service listening on {}", addr);

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

    async fn service() -> OracleService {
        let service = OracleService::new();
        service.register_symbol("BTCUSDT", 2, 5.0).await;
        service.register_source("tigerex-spot", "spot", 10).await.unwrap();
        service.register_source("tigerex-futures", "futures", 9).await.unwrap();
        service.register_source("tigerex-margin", "margin", 7).await.unwrap();
        service
    }

    fn observation(source: &str, price: f64) -> SubmitPriceRequest {
        SubmitPriceRequest {
            source: source.to_string(),
            symbol: "BTCUSDT".to_string(),
            price,
            bid: price * 0.999,
            ask: price * 1.001,
            volume_24h: 100.0,
            confidence: 1.0,
        }
    }

    #[tokio::test]
    async fn fails_closed_without_observations() {
        let service = service().await;
        assert!(matches!(
            service.aggregate_prices("BTCUSDT", 2).await,
            Err(OracleError::InsufficientSources)
        ));
    }

    #[tokio::test]
    async fn rejects_invalid_observations() {
        let service = service().await;

        assert!(service.submit_price(observation("tigerex-spot", 0.0)).await.is_err());

        let mut request = observation("tigerex-spot", 100.0);
        request.confidence = 1.5;
        assert!(service.submit_price(request).await.is_err());

        let mut request = observation("tigerex-spot", 100.0);
        request.bid = 101.0;
        request.ask = 99.0;
        assert!(service.submit_price(request).await.is_err());
    }

    #[tokio::test]
    async fn rejects_unknown_source_and_symbol() {
        let service = service().await;
        let mut request = observation("unknown-venue", 100.0);
        request.symbol = "BTCUSDT".to_string();
        assert!(matches!(
            service.submit_price(request).await,
            Err(OracleError::SourceNotAvailable)
        ));

        let mut request = observation("tigerex-spot", 100.0);
        request.symbol = "NOTLISTED".to_string();
        assert!(matches!(
            service.submit_price(request).await,
            Err(OracleError::InvalidSymbol)
        ));
    }

    #[tokio::test]
    async fn aggregates_weighted_price() {
        let service = service().await;
        service.submit_price(observation("tigerex-spot", 100.0)).await.unwrap();
        service.submit_price(observation("tigerex-futures", 102.0)).await.unwrap();

        let aggregated = service.aggregate_prices("BTCUSDT", 2).await.unwrap();
        let expected = (100.0 * 10.0 + 102.0 * 9.0) / 19.0;
        assert!((aggregated.price - expected).abs() < 1e-9, "{}", aggregated.price);
        assert_eq!(aggregated.sources.len(), 2);
        assert!(aggregated.spread >= 0.0);
    }

    #[tokio::test]
    async fn rejects_outlier_beyond_deviation() {
        let service = service().await;
        service.submit_price(observation("tigerex-spot", 100.0)).await.unwrap();
        service.submit_price(observation("tigerex-futures", 101.0)).await.unwrap();
        service.submit_price(observation("tigerex-margin", 500.0)).await.unwrap();

        let aggregated = service.aggregate_prices("BTCUSDT", 2).await.unwrap();
        assert!(aggregated.price < 110.0);
        assert!(!aggregated.sources.contains(&"tigerex-margin".to_string()));
    }

    #[tokio::test]
    async fn vwap_uses_real_volumes() {
        let service = service().await;
        service.submit_price(observation("tigerex-spot", 100.0)).await.unwrap();
        service.submit_price(observation("tigerex-futures", 100.0)).await.unwrap();
        service.aggregate_prices("BTCUSDT", 2).await.unwrap();

        let vwap = service.calculate_vwap("BTCUSDT", 60).await.unwrap();
        assert!((vwap.volume_weighted_avg_price - 100.0).abs() < 1e-9);
        assert!(vwap.total_volume > 0.0);
    }

    #[tokio::test]
    async fn twap_fails_without_history() {
        let service = service().await;
        assert!(matches!(
            service.calculate_twap("BTCUSDT", 60).await,
            Err(OracleError::PriceNotAvailable)
        ));
    }

    #[tokio::test]
    async fn alerts_trigger_once() {
        let service = service().await;
        let alert = service
            .create_alert(CreateAlertRequest {
                user_id: "u1".to_string(),
                symbol: "BTCUSDT".to_string(),
                condition: AlertCondition::Above,
                target_price: 100.0,
            })
            .await
            .unwrap();

        let triggered = service.check_alerts("BTCUSDT", 101.0).await;
        assert_eq!(triggered.len(), 1);
        assert_eq!(triggered[0].id, alert.id);

        assert!(service.check_alerts("BTCUSDT", 102.0).await.is_empty());
    }
}
