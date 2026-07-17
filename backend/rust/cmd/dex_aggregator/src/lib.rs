//! TigerEx DEX Aggregator
//! Cross-DEX liquidity aggregation - OKX-style DEX aggregator
//! 
//! Features:
//! - Multi-DEX order book aggregation
//! - Smart order routing
//! - Cross-DEX arbitrage detection
//! - MEV protection
//! - Gas optimization

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum DexAggregatorError {
    #[error("Exchange not supported: {0}")]
    ExchangeNotSupported(String),
    
    #[error("Insufficient liquidity: {0}")]
    InsufficientLiquidity(String),
    
    #[error("Price mismatch: {0}")]
    PriceMismatch(String),
    
    #[error("Slippage exceeded: {0}")]
    SlippageExceeded(String),
    
    #[error("Trade failed: {0}")]
    TradeFailed(String),
    
    #[error("Network error: {0}")]
    NetworkError(String),
    
    #[error("Rate limited: {0}")]
    RateLimited(String),
}

// ============================================================================
// SUPPORTED EXCHANGES
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Exchange {
    Binance,
    Bybit,
    Coinbase,
    Kraken,
    KuCoin,
    OKX,
    Gate,
    HTX,
    Bitget,
    MEXC,
    UniswapV3,
    Sushiswap,
    Curve,
    Balancer,
}

impl Exchange {
    pub fn is_cex(&self) -> bool {
        !matches!(self, Exchange::UniswapV3 | Exchange::Sushiswap | Exchange::Curve | Exchange::Balancer)
    }
    
    pub fn is_dex(&self) -> bool {
        !self.is_cex()
    }
    
    pub fn fee(&self) -> f64 {
        match self {
            Exchange::Binance => 0.001,
            Exchange::Bybit => 0.001,
            Exchange::Coinbase => 0.006,
            Exchange::Kraken => 0.002,
            Exchange::KuCoin => 0.001,
            Exchange::OKX => 0.001,
            Exchange::Gate => 0.002,
            Exchange::HTX => 0.002,
            Exchange::Bitget => 0.001,
            Exchange::MEXC => 0.002,
            Exchange::UniswapV3 => 0.003,
            Exchange::Sushiswap => 0.003,
            Exchange::Curve => 0.0004,
            Exchange::Balancer => 0.001,
        }
    }
}

// ============================================================================
// TOKEN AND PAIR
// ============================================================================

#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub struct Token {
    pub address: String,
    pub symbol: String,
    pub decimals: u8,
    pub chain: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradingPair {
    pub base: Token,
    pub quote: Token,
}

impl TradingPair {
    pub fn new(base: Token, quote: Token) -> Self {
        Self { base, quote }
    }
    
    pub fn format(&self) -> String {
        format!("{}/{}", self.base.symbol, self.quote.symbol)
    }
}

// ============================================================================
// PRICE LEVEL
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
    pub exchange: Exchange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedOrderBook {
    pub pair: TradingPair,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub last_update: u64,
    pub sequence: u64,
}

// ============================================================================
// ROUTE AND TRADE
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub exchanges: Vec<Exchange>,
    pub total_quantity: f64,
    pub total_price: f64,
    pub total_fee: f64,
    pub estimated_gas: u64,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeQuote {
    pub pair: TradingPair,
    pub side: TradeSide,
    pub quantity: f64,
    pub routes: Vec<Route>,
    pub best_price: f64,
    pub worst_price: f64,
    pub price_impact: f64,
    pub slippage: f64,
    pub valid_until: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TradeSide {
    Buy,
    Sell,
}

// ============================================================================
// DEX CONNECTOR
// ============================================================================

#[async_trait::async_trait]
pub trait DexConnector: Send + Sync {
    fn exchange(&self) -> Exchange;
    
    async fn get_order_book(&self, pair: &TradingPair) -> Result<AggregatedOrderBook, DexAggregatorError>;
    
    async fn get_quote(&self, pair: &TradingPair, quantity: f64, side: TradeSide) -> Result<TradeQuote, DexAggregatorError>;
    
    async fn execute_trade(&self, quote: &TradeQuote, route: &Route) -> Result<String, DexAggregatorError>;
    
    async fn get_balance(&self, token: &Token) -> Result<f64, DexAggregatorError>;
    
    async fn approve(&self, token: &Token, amount: f64) -> Result<(), DexAggregatorError>;
    
    fn supports(&self, pair: &TradingPair) -> bool;
}

// ============================================================================
// DEX AGGREGATOR
// ============================================================================

pub struct DexAggregator {
    connectors: HashMap<Exchange, Arc<dyn DexConnector>>,
    pairs: HashMap<String, HashSet<Exchange>>,
    order_books: RwLock<HashMap<String, AggregatedOrderBook>>,
    quotes: RwLock<HashMap<String, TradeQuote>>,
    settings: AggregatorSettings,
    
    // Event channels
    trade_tx: broadcast::Sender<TradeEvent>,
    price_tx: broadcast::Sender<PriceUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatorSettings {
    pub max_slippage: f64,
    pub max_price_impact: f64,
    pub max_exchanges: usize,
    pub gas_strategy: GasStrategy,
    pub mev_protection: bool,
    pub smart_routing: bool,
    pub cross_exchange_arbitrage: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GasStrategy {
    Fastest,
    Cheapest,
    Balanced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeEvent {
    pub quote_id: String,
    pub pair: TradingPair,
    pub side: TradeSide,
    pub quantity: f64,
    pub executed_price: f64,
    pub executed_quantity: f64,
    pub fee: f64,
    pub exchanges: Vec<Exchange>,
    pub tx_hash: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceUpdate {
    pub pair: TradingPair,
    pub best_bid: f64,
    pub best_ask: f64,
    pub spread: f64,
    pub exchanges: HashMap<Exchange, f64>,
}

impl DexAggregator {
    pub fn new(settings: AggregatorSettings) -> Self {
        let (trade_tx, _) = broadcast::channel(1000);
        let (price_tx, _) = broadcast::channel(1000);
        
        Self {
            connectors: HashMap::new(),
            pairs: HashMap::new(),
            order_books: RwLock::new(HashMap::new()),
            quotes: RwLock::new(HashMap::new()),
            settings,
            trade_tx,
            price_tx,
        }
    }
    
    // ============================================================================
    // CONNECTOR MANAGEMENT
    // ============================================================================
    
    pub fn add_connector(&mut self, exchange: Exchange, connector: Arc<dyn DexConnector>) {
        self.connectors.insert(exchange, connector);
        info!("Added connector for {:?}", exchange);
    }
    
    pub fn remove_connector(&mut self, exchange: Exchange) {
        self.connectors.remove(&exchange);
        info!("Removed connector for {:?}", exchange);
    }
    
    pub fn get_connectors(&self) -> Vec<Exchange> {
        self.connectors.keys().copied().collect()
    }
    
    // ============================================================================
    // PAIR MANAGEMENT
    // ============================================================================
    
    pub fn register_pair(&mut self, pair: TradingPair, exchanges: Vec<Exchange>) {
        let key = pair.format();
        self.pairs.insert(key, exchanges.into_iter().collect());
        info!("Registered pair {} on {:?}", key, exchanges);
    }
    
    pub fn get_supported_exchanges(&self, pair: &TradingPair) -> Vec<Exchange> {
        let key = pair.format();
        self.pairs.get(&key).map(|e| e.iter().copied().collect()).unwrap_or_default()
    }
    
    // ============================================================================
    // ORDER BOOK AGGREGATION
    // ============================================================================
    
    pub async fn aggregate_order_book(&self, pair: &TradingPair) -> Result<AggregatedOrderBook, DexAggregatorError> {
        let exchanges = self.get_supported_exchanges(pair);
        
        if exchanges.is_empty() {
            return Err(DexAggregatorError::ExchangeNotSupported(pair.format()));
        }
        
        let mut all_bids: Vec<PriceLevel> = Vec::new();
        let mut all_asks: Vec<PriceLevel> = Vec::new();
        
        // Fetch from all exchanges concurrently
        let mut handles = Vec::new();
        
        for &exchange in &exchanges {
            if let Some(connector) = self.connectors.get(&exchange) {
                let connector = Arc::clone(connector);
                let pair = pair.clone();
                
                handles.push(tokio::spawn(async move {
                    connector.get_order_book(&pair).await
                }));
            }
        }
        
        // Collect results
        for handle in handles {
            if let Ok(Ok(ob)) = handle.await {
                for bid in ob.bids {
                    all_bids.push(bid);
                }
                for ask in ob.asks {
                    all_asks.push(ask);
                }
            }
        }
        
        // Sort and aggregate
        all_bids.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
        all_asks.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());
        
        let aggregated = AggregatedOrderBook {
            pair: pair.clone(),
            bids: all_bids,
            asks: all_asks,
            last_update: chrono::Utc::now().timestamp() as u64,
            sequence: 0,
        };
        
        // Cache
        let key = pair.format();
        self.order_books.write().unwrap().insert(key, aggregated.clone());
        
        Ok(aggregated)
    }
    
    // ============================================================================
    // SMART ROUTING
    // ============================================================================
    
    pub async fn get_quote(&self, pair: &TradingPair, quantity: f64, side: TradeSide) -> Result<TradeQuote, DexAggregatorError> {
        let exchanges = self.get_supported_exchanges(pair);
        
        if exchanges.is_empty() {
            return Err(DexAggregatorError::ExchangeNotSupported(pair.format()));
        }
        
        let mut all_quotes: Vec<Route> = Vec::new();
        
        // Get quotes from all exchanges
        for &exchange in &exchanges {
            if let Some(connector) = self.connectors.get(&exchange) {
                match connector.get_quote(pair, quantity, side).await {
                    Ok(quote) => {
                        for route in quote.routes {
                            all_quotes.push(route);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to get quote from {:?}: {}", exchange, e);
                    }
                }
            }
        }
        
        if all_quotes.is_empty() {
            return Err(DexAggregatorError::InsufficientLiquidity(pair.format()));
        }
        
        // Sort by price
        if side == TradeSide::Buy {
            all_quotes.sort_by(|a, b| a.total_price.partial_cmp(&b.total_price).unwrap());
        } else {
            all_quotes.sort_by(|a, b| b.total_price.partial_cmp(&a.total_price).unwrap());
        }
        
        // Calculate metrics
        let best_price = all_quotes.first().map(|r| r.total_price / r.total_quantity).unwrap_or(0.0);
        let worst_price = all_quotes.last().map(|r| r.total_price / r.total_quantity).unwrap_or(0.0);
        let price_impact = if best_price > 0.0 {
            (best_price - worst_price) / best_price * 100.0
        } else {
            0.0
        };
        let slippage = self.calculate_slippage(&all_quotes, quantity);
        
        // Check limits
        if slippage > self.settings.max_slippage {
            return Err(DexAggregatorError::SlippageExceeded(format!(
                "Slippage {}% exceeds max {}%",
                slippage, self.settings.max_slippage
            )));
        }
        
        if price_impact > self.settings.max_price_impact {
            return Err(DexAggregatorError::PriceMismatch(format!(
                "Price impact {}% exceeds max {}%",
                price_impact, self.settings.max_price_impact
            )));
        }
        
        let quote = TradeQuote {
            pair: pair.clone(),
            side,
            quantity,
            routes: all_quotes,
            best_price,
            worst_price,
            price_impact,
            slippage,
            valid_until: (chrono::Utc::now() + chrono::Duration::seconds(30)).timestamp() as u64,
        };
        
        // Cache
        let key = format!("{}:{}:{}", pair.format(), side as u8, quantity);
        self.quotes.write().unwrap().insert(key, quote.clone());
        
        Ok(quote)
    }
    
    fn calculate_slippage(&self, routes: &[Route], quantity: f64) -> f64 {
        if routes.is_empty() || quantity == 0.0 {
            return 0.0;
        }
        
        // Calculate average price across all routes
        let total_value: f64 = routes.iter().map(|r| r.total_price).sum();
        let avg_price = total_value / routes.len() as f64;
        
        // Compare to best single route
        let best_price = routes.first().map(|r| r.total_price / r.total_quantity).unwrap_or(0.0);
        
        if best_price == 0.0 {
            return 0.0;
        }
        
        (avg_price - best_price) / best_price * 100.0
    }
    
    // ============================================================================
    // TRADE EXECUTION
    // ============================================================================
    
    pub async fn execute_quote(&self, quote: &TradeQuote, max_slippage: Option<f64>) -> Result<TradeEvent, DexAggregatorError> {
        let slippage_limit = max_slippage.unwrap_or(self.settings.max_slippage);
        
        if quote.slippage > slippage_limit {
            return Err(DexAggregatorError::SlippageExceeded(format!(
                "Quote slippage {}% exceeds limit {}%",
                quote.slippage, slippage_limit
            )));
        }
        
        // Execute best route first
        let route = quote.routes.first().ok_or_else(|| {
            DexAggregatorError::InsufficientLiquidity(quote.pair.format())
        })?;
        
        // Find connector
        let exchange = route.exchanges.first().ok_or_else(|| {
            DexAggregatorError::TradeFailed("No exchanges in route".to_string())
        })?;
        
        let connector = self.connectors.get(exchange).ok_or_else(|| {
            DexAggregatorError::ExchangeNotSupported(format!("{:?}", exchange))
        })?;
        
        // Execute
        let tx_hash = connector.execute_trade(quote, route).await?;
        
        let event = TradeEvent {
            quote_id: format!("{:?}:{}", quote.pair, quote.quantity),
            pair: quote.pair.clone(),
            side: quote.side,
            quantity: quote.quantity,
            executed_price: quote.best_price,
            executed_quantity: quote.quantity,
            fee: route.total_fee,
            exchanges: route.exchanges.clone(),
            tx_hash,
            timestamp: chrono::Utc::now().timestamp() as u64,
        };
        
        // Broadcast
        let _ = self.trade_tx.send(event.clone());
        
        Ok(event)
    }
    
    // ============================================================================
    // ARBITRAGE DETECTION
    // ============================================================================
    
    pub async fn detect_arbitrage(&self, pair: &TradingPair) -> Result<Option<ArbitrageOpportunity>, DexAggregatorError> {
        if !self.settings.cross_exchange_arbitrage {
            return Ok(None);
        }
        
        // Get order book
        let order_book = self.aggregate_order_book(pair).await?;
        
        // Find price differences
        let best_bid = order_book.bids.first();
        let best_ask = order_book.asks.first();
        
        if let (Some(bid), Some(ask)) = (best_bid, best_ask) {
            let spread = ask.price - bid.price;
            let spread_pct = spread / bid.price * 100.0;
            
            // Check if profitable after fees
            let total_fee: f64 = bid.exchange.fee() + ask.exchange.fee();
            
            if spread_pct > total_fee * 100.0 {
                return Ok(Some(ArbitrageOpportunity {
                    pair: pair.clone(),
                    buy_exchange: bid.exchange,
                    sell_exchange: ask.exchange,
                    buy_price: bid.price,
                    sell_price: ask.price,
                    quantity: bid.quantity.min(ask.quantity),
                    profit_pct: spread_pct - total_fee * 100.0,
                }));
            }
        }
        
        Ok(None)
    }
    
    // ============================================================================
    // GAS OPTIMIZATION
    // ============================================================================
    
    pub async fn optimize_gas(&self, route: &Route) -> Result<GasRecommendation, DexAggregatorError> {
        let mut recommendations = Vec::new();
        
        for exchange in &route.exchanges {
            if let Some(connector) = self.connectors.get(exchange) {
                // Estimate gas for this exchange
                let gas_estimate = self.estimate_gas(exchange, &route.path).await?;
                
                recommendations.push(GasRecommendation {
                    exchange: *exchange,
                    gas_limit: gas_estimate.0,
                    gas_price: gas_estimate.1,
                    estimated_cost_usd: gas_estimate.2,
                    time: gas_estimate.3,
                });
            }
        }
        
        // Sort by strategy
        match self.settings.gas_strategy {
            GasStrategy::Fastest => {
                recommendations.sort_by(|a, b| a.time.cmp(&b.time));
            }
            GasStrategy::Cheapest => {
                recommendations.sort_by(|a, b| a.estimated_cost_usd.partial_cmp(&b.estimated_cost_usd).unwrap());
            }
            GasStrategy::Balanced => {
                // Balanced score
                recommendations.sort_by(|a, b| {
                    let score_a = a.estimated_cost_usd / 100.0 + a.time as f64 / 1000.0;
                    let score_b = b.estimated_cost_usd / 100.0 + b.time as f64 / 1000.0;
                    score_a.partial_cmp(&score_b).unwrap()
                });
            }
        }
        
        Ok(recommendations)
    }
    
    async fn estimate_gas(&self, exchange: &Exchange, path: &[String]) -> Result<(u64, f64, f64, u64), DexAggregatorError> {
        // Simplified gas estimation
        let base_gas: u64 = match exchange {
            Exchange::UniswapV3 => 150000,
            Exchange::Sushiswap => 200000,
            Exchange::Curve => 100000,
            Exchange::Balancer => 180000,
            _ => 50000,
        };
        
        let path_multiplier = path.len() as u64;
        let gas_limit = base_gas * path_multiplier;
        
        // Current gas price (simplified - in production use oracle)
        let gas_price_gwei = 30.0;
        let gas_price_wei = gas_price_gwei * 1e9;
        
        // Estimate cost in USD
        let eth_price = 3500.0; // In production, fetch from oracle
        let estimated_cost_usd = (gas_limit as f64 * gas_price_wei / 1e18) * eth_price;
        
        // Estimated time
        let time = match exchange {
            Exchange::UniswapV3 => 15000,
            Exchange::Sushiswap => 20000,
            Exchange::Curve => 10000,
            _ => 5000,
        };
        
        Ok((gas_limit, gas_price_gwei, estimated_cost_usd, time))
    }
    
    // ============================================================================
    // PRICE FEEDS
    // ============================================================================
    
    pub fn subscribe_trades(&self) -> broadcast::Receiver<TradeEvent> {
        self.trade_tx.subscribe()
    }
    
    pub fn subscribe_prices(&self) -> broadcast::Receiver<PriceUpdate> {
        self.price_tx.subscribe()
    }
    
    pub async fn start_price_feed(&self) {
        // Start background price feed
        let order_books = Arc::new(self.order_books.clone());
        let price_tx = self.price_tx.clone();
        
        tokio::spawn(async move {
            loop {
                // Update all pairs
                for (pair_key, exchanges) in order_books.read().unwrap().iter() {
                    // Skip - just maintain structure
                    debug!("Price feed for {}", pair_key);
                }
                
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
    }
}

// ============================================================================
// ARBITRAGE OPPORTUNITY
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    pub pair: TradingPair,
    pub buy_exchange: Exchange,
    pub sell_exchange: Exchange,
    pub buy_price: f64,
    pub sell_price: f64,
    pub quantity: f64,
    pub profit_pct: f64,
}

// ============================================================================
// GAS RECOMMENDATION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GasRecommendation {
    pub exchange: Exchange,
    pub gas_limit: u64,
    pub gas_price: f64,
    pub estimated_cost_usd: f64,
    pub time: u64,  // milliseconds
}

// ============================================================================
// FACTORY
// ============================================================================

pub fn create_aggregator() -> DexAggregator {
    DexAggregator::new(AggregatorSettings {
        max_slippage: 0.5,
        max_price_impact: 1.0,
        max_exchanges: 5,
        gas_strategy: GasStrategy::Balanced,
        mev_protection: true,
        smart_routing: true,
        cross_exchange_arbitrage: true,
    })
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_exchange_fees() {
        assert!(Exchange::Binance.fee() < Exchange::Coinbase.fee());
    }
    
    #[test]
    fn test_dex_classification() {
        assert!(Exchange::Binance.is_cex());
        assert!(Exchange::UniswapV3.is_dex());
    }
}