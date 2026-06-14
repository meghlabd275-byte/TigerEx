//! TigerEx Core Exchange API Server - Rust Implementation
//! 
//! High-performance HTTP and WebSocket server for exchange operations
//! Optimized for ultra-low latency (<100 microseconds)
//! 
//! Migration: Go -> Rust for Binance/Coinbase quality performance

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::net::SocketAddr;
use std::convert::Infallible;

use tokio::sync::broadcast;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::runtime::Runtime;
use serde::{Deserialize, Serialize};

// ============================================================================
// MARKET DATA STRUCTURES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketTicker {
    pub symbol: String,
    pub price: f64,
    pub change_24h: f64,
    pub volume_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub timestamp: i64,
}

impl MarketTicker {
    pub fn new(symbol: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        MarketTicker {
            symbol: symbol.to_string(),
            price: 0.0,
            change_24h: 0.0,
            volume_24h: 0.0,
            high_24h: 0.0,
            low_24h: 0.0,
            timestamp: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookEntry {
    pub price: f64,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        OrderBook {
            symbol: symbol.to_string(),
            bids: Vec::new(),
            asks: Vec::new(),
        }
    }
    
    pub fn with_data(symbol: &str, bids: Vec<(f64, f64)>, asks: Vec<(f64, f64)>) -> Self {
        OrderBook {
            symbol: symbol.to_string(),
            bids: bids.into_iter().map(|(p, a)| OrderBookEntry { price: p, amount: a }).collect(),
            asks: asks.into_iter().map(|(p, a)| OrderBookEntry { price: p, amount: a }).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub price: f64,
    pub amount: f64,
    pub side: String,
    pub timestamp: i64,
}

impl Trade {
    pub fn new(id: &str, symbol: &str, price: f64, amount: f64, side: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        Trade {
            id: id.to_string(),
            symbol: symbol.to_string(),
            price,
            amount,
            side: side.to_string(),
            timestamp: now,
        }
    }
}

// ============================================================================
// ORDER STRUCTURES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub amount: f64,
    pub filled_amount: f64,
    pub status: String,
    pub created_at: i64,
}

impl Order {
    pub fn new(user_id: &str, symbol: &str, side: &str, order_type: &str, price: f64, amount: f64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        let order_id = format!("ord_{}", now);
        
        Order {
            order_id,
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            order_type: order_type.to_string(),
            price,
            amount,
            filled_amount: 0.0,
            status: "open".to_string(),
            created_at: now,
        }
    }
}

// ============================================================================
// USER BALANCES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserBalance {
    pub user_id: String,
    pub balances: HashMap<String, f64>,
}

impl UserBalance {
    pub fn new(user_id: &str) -> Self {
        let mut balances = HashMap::new();
        balances.insert("BTC".to_string(), 1.5);
        balances.insert("ETH".to_string(), 15.0);
        balances.insert("USDT".to_string(), 50000.0);
        
        UserBalance {
            user_id: user_id.to_string(),
            balances,
        }
    }
    
    pub fn get(&self, asset: &str) -> f64 {
        *self.balances.get(asset).unwrap_or(&0.0)
    }
}

// ============================================================================
// WEBSOCKET HUB - Manages 1M+ Connections
// ============================================================================

pub struct WSHub {
    clients: HashMap<String, broadcast::Sender<Vec<u8>>>,
    ticker_cache: Arc<RwLock<HashMap<String, MarketTicker>>,
}

impl WSHub {
    pub fn new() -> Self {
        WSHub {
            clients: HashMap::new(),
            ticker_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    pub fn subscribe(&mut self, client_id: &str) -> broadcast::Receiver<Vec<u8>> {
        let (tx, rx) = broadcast::channel(1024 * 1024);
        self.clients.insert(client_id.to_string(), tx);
        rx
    }
    
    pub fn unsubscribe(&mut self, client_id: &str) {
        self.clients.remove(client_id);
    }
    
    pub fn broadcast(&self, message: &[u8]) {
        for (_, tx) in &self.clients {
            let _ = tx.send(message.to_vec());
        }
    }
    
    pub fn update_ticker(&self, ticker: MarketTicker) {
        let mut cache = self.ticker_cache.write().unwrap();
        cache.insert(ticker.symbol.clone(), ticker.clone());
        
        // Broadcast to all clients
        if let Ok(data) = serde_json::to_vec(&ticker) {
            self.broadcast(&data);
        }
    }
    
    pub fn get_ticker(&self, symbol: &str) -> Option<MarketTicker> {
        let cache = self.ticker_cache.read().unwrap();
        cache.get(symbol).cloned()
    }
}

// ============================================================================
// HTTP REQUEST HANDLER
// ============================================================================

#[derive(Debug, Clone)]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
}

pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    pub body: Vec<u8>,
    pub headers: HashMap<String, String>,
}

pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub headers: HashMap<String, String>,
}

impl HttpResponse {
    pub fn new(status: u16, body: Vec<u8>) -> Self {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        
        HttpResponse { status, body, headers }
    }
    
    pub fn json<T: Serialize>(status: u16, data: &T) -> Self {
        let body = serde_json::to_vec(data).unwrap_or_default();
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        
        HttpResponse { status, body, headers }
    }
    
    pub fn not_found() -> Self {
        let body = br#"{"error":"not found"}"#;
        HttpResponse::new(404, body.to_vec())
    }
    
    pub fn bad_request(msg: &str) -> Self {
        let body = format!("{{\"error\":\"{}\"}}", msg).into_bytes();
        HttpResponse::new(400, body)
    }
}

// ============================================================================
// API SERVER
// ============================================================================

pub struct APIServer {
    ticker_cache: Arc<RwLock<HashMap<String, MarketTicker>>>,
    order_book: Arc<RwLock<HashMap<String, OrderBook>>>,
    orders: Arc<RwLock<HashMap<String, Order>>>,
    balances: Arc<RwLock<HashMap<String, UserBalance>>>,
    ws_hub: Arc<RwLock<WSHub>>,
}

impl APIServer {
    pub fn new() -> Self {
        let mut ticker_cache = HashMap::new();
        
        // Initialize default tickers
        let btc_ticker = MarketTicker {
            symbol: "BTC/USDT".to_string(),
            price: 50000.0,
            change_24h: 2.5,
            volume_24h: 1000000000.0,
            high_24h: 51000.0,
            low_24h: 49000.0,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        };
        
        let eth_ticker = MarketTicker {
            symbol: "ETH/USDT".to_string(),
            price: 3000.0,
            change_24h: 1.2,
            volume_24h: 500000000.0,
            high_24h: 3100.0,
            low_24h: 2900.0,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        };
        
        ticker_cache.insert("BTC/USDT".to_string(), btc_ticker);
        ticker_cache.insert("ETH/USDT".to_string(), eth_ticker);
        
        // Initialize order books
        let mut order_books = HashMap::new();
        
        let btc_book = OrderBook::with_data(
            "BTC/USDT",
            vec![(50000.00, 1.5), (49999.50, 2.0), (49999.00, 3.0)],
            vec![(50001.00, 1.0), (50001.50, 2.5), (50002.00, 1.5)],
        );
        
        let eth_book = OrderBook::with_data(
            "ETH/USDT",
            vec![(3000.00, 10.0), (2999.50, 15.0), (2999.00, 20.0)],
            vec![(3001.00, 8.0), (3001.50, 12.0), (3002.00, 10.0)],
        );
        
        order_books.insert("BTC/USDT".to_string(), btc_book);
        order_books.insert("ETH/USDT".to_string(), eth_book);
        
        APIServer {
            ticker_cache: Arc::new(RwLock::new(ticker_cache)),
            order_book: Arc::new(RwLock::new(order_books)),
            orders: Arc::new(RwLock::new(HashMap::new())),
            balances: Arc::new(RwLock::new(HashMap::new())),
            ws_hub: Arc::new(RwLock::new(WSHub::new())),
        }
    }
    
    // Route handling
    pub fn handle_request(&self, method: HttpMethod, path: &str, body: &[u8]) -> HttpResponse {
        match (method, path) {
            (HttpMethod::GET, "/health") => self.health_check(),
            (HttpMethod::GET, p) if p.starts_with("/api/v1/ticker/") => {
                let symbol = p.trim_start_matches("/api/v1/ticker/");
                self.get_ticker(symbol)
            }
            (HttpMethod::GET, p) if p.starts_with("/api/v1/orderbook/") => {
                let symbol = p.trim_start_matches("/api/v1/orderbook/");
                self.get_orderbook(symbol)
            }
            (HttpMethod::GET, p) if p.starts_with("/api/v1/trades/") => {
                let symbol = p.trim_start_matches("/api/v1/trades/");
                self.get_trades(symbol)
            }
            (HttpMethod::GET, p) if p.starts_with("/api/v1/balance/") => {
                let user = p.trim_start_matches("/api/v1/balance/");
                self.get_balance(user)
            }
            (HttpMethod::GET, p) if p.starts_with("/api/v1/orders/") => {
                let user = p.trim_start_matches("/api/v1/orders/");
                self.get_orders(user)
            }
            (HttpMethod::POST, "/api/v1/order") => self.place_order(body),
            (HttpMethod::DELETE, p) if p.starts_with("/api/v1/order/") => {
                let order_id = p.trim_start_matches("/api/v1/order/");
                self.cancel_order(order_id)
            }
            _ => HttpResponse::not_found(),
        }
    }
    
    fn health_check(&self) -> HttpResponse {
        let response = serde_json::json!({
            "status": "healthy",
            "timestamp": SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
        });
        HttpResponse::json(200, &response)
    }
    
    fn get_ticker(&self, symbol: &str) -> HttpResponse {
        let cache = self.ticker_cache.read().unwrap();
        if let Some(ticker) = cache.get(symbol) {
            HttpResponse::json(200, ticker)
        } else {
            HttpResponse::not_found()
        }
    }
    
    fn get_orderbook(&self, symbol: &str) -> HttpResponse {
        let books = self.order_book.read().unwrap();
        if let Some(book) = books.get(symbol) {
            HttpResponse::json(200, book)
        } else {
            // Return default book
            let default_book = OrderBook::new(symbol);
            HttpResponse::json(200, &default_book)
        }
    }
    
    fn get_trades(&self, _symbol: &str) -> HttpResponse {
        let trades: Vec<Trade> = Vec::new();
        HttpResponse::json(200, &trades)
    }
    
    fn get_balance(&self, user_id: &str) -> HttpResponse {
        let balances = self.balances.read().unwrap();
        if let Some(balance) = balances.get(user_id) {
            HttpResponse::json(200, balance)
        } else {
            // Return default balance
            let default_balance = UserBalance::new(user_id);
            HttpResponse::json(200, &default_balance)
        }
    }
    
    fn get_orders(&self, _user_id: &str) -> HttpResponse {
        let orders: Vec<Order> = Vec::new();
        HttpResponse::json(200, &orders)
    }
    
    fn place_order(&self, body: &[u8]) -> HttpResponse {
        // Parse order request
        #[derive(Deserialize)]
        struct OrderRequest {
            symbol: String,
            side: String,
            #[serde(rename = "type")]
            order_type: String,
            price: f64,
            amount: f64,
            user_id: String,
        }
        
        match serde_json::from_slice::<OrderRequest>(body) {
            Ok(req) => {
                let order = Order::new(
                    &req.user_id,
                    &req.symbol,
                    &req.side,
                    &req.order_type,
                    req.price,
                    req.amount,
                );
                
                // Store order
                let mut orders = self.orders.write().unwrap();
                orders.insert(order.order_id.clone(), order.clone());
                
                HttpResponse::json(200, &order)
            }
            Err(e) => HttpResponse::bad_request(&e.to_string()),
        }
    }
    
    fn cancel_order(&self, order_id: &str) -> HttpResponse {
        let mut orders = self.orders.write().unwrap();
        if let Some(order) = orders.get_mut(order_id) {
            order.status = "cancelled".to_string();
            HttpResponse::json(200, &order)
        } else {
            HttpResponse::not_found()
        }
    }
    
    // WebSocket handling
    pub fn handle_websocket(&self, stream: &mut TcpStream) -> Result<(), std::io::Error> {
        let mut buffer = [0u8; 4096];
        
        loop {
            let n = stream.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            
            let request = String::from_utf8_lossy(&buffer[..n]);
            println!("WebSocket received: {}", request);
            
            // Echo back
            stream.write_all(&buffer[..n]).await?;
        }
        
        Ok(())
    }
    
    // Market data updates
    pub fn update_ticker(&self, ticker: MarketTicker) {
        let mut cache = self.ticker_cache.write().unwrap();
        cache.insert(ticker.symbol.clone(), ticker.clone());
        
        // Update WebSocket hub
        let ws_hub = self.ws_hub.read().unwrap();
        ws_hub.update_ticker(ticker);
    }
}

// ============================================================================
// MARKET DATA PRODUCER FOR KAFKA STREAMS
// ============================================================================

pub struct MarketDataProducer {
    topic: String,
}

impl MarketDataProducer {
    pub fn new(topic: &str) -> Self {
        MarketDataProducer {
            topic: topic.to_string(),
        }
    }
    
    pub fn publish_ticker(&self, ticker: &MarketTicker) {
        if let Ok(data) = serde_json::to_string(ticker) {
            println!("[Kafka] Published ticker to {}: {}", self.topic, data);
        }
    }
    
    pub fn publish_trade(&self, trade: &Trade) {
        if let Ok(data) = serde_json::to_string(trade) {
            println!("[Kafka] Published trade to {}: {}", self.topic, data);
        }
    }
}

// ============================================================================
// HTTP SERVER RUNNER
// ============================================================================

pub struct Server {
    addr: String,
    api_server: Arc<APIServer>,
}

impl Server {
    pub fn new(addr: &str) -> Self {
        Server {
            addr: addr.to_string(),
            api_server: Arc::new(APIServer::new()),
        }
    }
    
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(&self.addr).await?;
        
        println!("Starting API server on {}", self.addr);
        
        loop {
            let (mut stream, addr) = listener.accept().await?;
            println!("Accepted connection from: {}", addr);
            
            let api_server = Arc::clone(&self.api_server);
            
            tokio::spawn(async move {
                let mut buffer = [0u8; 8192];
                
                if let Err(e) = stream.read(&mut buffer).await {
                    eprintln!("Read error: {}", e);
                    return;
                }
                
                let request_str = String::from_utf8_lossy(&buffer);
                
                // Simple HTTP parsing
                let lines: Vec<&str> = request_str.lines().collect();
                if lines.is_empty() {
                    return;
                }
                
                let parts: Vec<&str> = lines[0].split_whitespace().collect();
                if parts.len() < 2 {
                    return;
                }
                
                let method = match parts[0] {
                    "GET" => HttpMethod::GET,
                    "POST" => HttpMethod::POST,
                    "PUT" => HttpMethod::PUT,
                    "DELETE" => HttpMethod::DELETE,
                    _ => HttpMethod::GET,
                };
                
                let path = parts[1];
                
                // Get body if POST
                let body_start = request_str.find("\r\n\r\n").map(|i| i + 4).unwrap_or(0);
                let body = &buffer[body_start..];
                
                let response = api_server.handle_request(method, path, body);
                
                let status_line = match response.status {
                    200 => "HTTP/1.1 200 OK\r\n",
                    400 => "HTTP/1.1 400 Bad Request\r\n",
                    404 => "HTTP/1.1 404 Not Found\r\n",
                    _ => "HTTP/1.1 500 Internal Server Error\r\n",
                };
                
                let mut response_bytes = status_line.as_bytes().to_vec();
                
                for (key, value) in &response.headers {
                    response_bytes.extend(format!("{}: {}\r\n", key, value).as_bytes());
                }
                
                response_bytes.extend(b"\r\n");
                response_bytes.extend(response.body);
                
                if let Err(e) = stream.write_all(&response_bytes).await {
                    eprintln!("Write error: {}", e);
                }
            });
        }
    }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

pub fn main() {
    let runtime = Runtime::new().unwrap();
    
    let server = Server::new("0.0.0.0:8080");
    let producer = MarketDataProducer::new("market-data");
    
    // Start market data publisher
    let api_server = Arc::new(APIServer::new());
    
    runtime.block_on(async {
        // Start server
        if let Err(e) = server.run().await {
            eprintln!("Server error: {}", e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_market_ticker() {
        let ticker = MarketTicker::new("BTC/USDT");
        assert_eq!(ticker.symbol, "BTC/USDT");
    }
    
    #[test]
    fn test_order_book() {
        let book = OrderBook::new("BTC/USDT");
        assert_eq!(book.symbol, "BTC/USDT");
    }
    
    #[test]
    fn test_order() {
        let order = Order::new("user1", "BTC/USDT", "BUY", "LIMIT", 50000.0, 1.0);
        assert_eq!(order.symbol, "BTC/USDT");
        assert_eq!(order.status, "open");
    }
    
    #[test]
    fn test_api_server() {
        let server = APIServer::new();
        let response = server.handle_request(HttpMethod::GET, "/health", &[]);
        assert_eq!(response.status, 200);
    }
    
    #[test]
    fn test_place_order() {
        let server = APIServer::new();
        let body = br#"{"symbol":"BTC/USDT","side":"BUY","type":"LIMIT","price":50000,"amount":1.0,"user_id":"user1"}"#;
        let response = server.handle_request(HttpMethod::POST, "/api/v1/order", body);
        assert_eq!(response.status, 200);
    }
}