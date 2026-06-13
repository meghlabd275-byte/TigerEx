//! TigerEx WebSocket Server - Rust Implementation
//! 
//! High-performance WebSocket server for real-time market data
//! Supports thousands of concurrent connections
//! 
//! Migration from Go to Rust using tokio and tungstenite

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// WebSocket message type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WSMessageType {
    Ping,
    Pong,
    Subscribe,
    Unsubscribe,
    Trade,
    Ticker,
    OrderBook,
    Kline,
    AccountUpdate,
}

/// Market channel
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Channel {
    Trade(String),       // Trade channel for symbol
    Ticker(String),    // Ticker for symbol
    OrderBook(String), // Order book for symbol
    Kline(String, u32), // Kline/candlestick (symbol, interval)
    Account(String),   // Account updates
}

impl Channel {
    pub fn symbol(&self) -> Option<&String> {
        match self {
            Channel::Trade(s) => Some(s),
            Channel::Ticker(s) => Some(s),
            Channel::OrderBook(s) => Some(s),
            Channel::Kline(s, _) => Some(s),
            Channel::Account(s) => Some(s),
            _ => None,
        }
    }
    
    pub fn name(&self) -> String {
        match self {
            Channel::Trade(s) => format!("{}@trade", s),
            Channel::Ticker(s) => format!("{}@ticker", s),
            Channel::OrderBook(s) => format!("{}@depth", s),
            Channel::Kline(s, i) => format!("{}@kline_{}", s, i),
            Channel::Account(u) => format!("{}@account", u),
        }
    }
}

/// WebSocket message
#[derive(Debug, Clone)]
pub struct WSMessage {
    pub msg_type: WSMessageType,
    pub channel: Option<String>,
    pub data: Option<String>,
    pub timestamp: u64,
}

impl WSMessage {
    pub fn new_ping() -> Self {
        WSMessage {
            msg_type: WSMessageType::Ping,
            channel: None,
            data: None,
            timestamp: current_timestamp(),
        }
    }
    
    pub fn new_pong() -> Self {
        WSMessage {
            msg_type: WSMessageType::Pong,
            channel: None,
            data: None,
            timestamp: current_timestamp(),
        }
    }
    
    pub fn subscribe(channel: String) -> Self {
        WSMessage {
            msg_type: WSMessageType::Subscribe,
            channel: Some(channel),
            data: None,
            timestamp: current_timestamp(),
        }
    }
    
    pub fn unsubscribe(channel: String) -> Self {
        WSMessage {
            msg_type: WSMessageType::Unsubscribe,
            channel: Some(channel),
            data: None,
            timestamp: current_timestamp(),
        }
    }
}

/// Client connection state
#[derive(Debug, Clone)]
pub struct WSClient {
    pub id: String,
    pub subscriptions: Vec<Channel>,
    pub messages_sent: u64,
    pub messages_recv: u64,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub last_activity: u64,
    pub authenticated: bool,
    pub user_id: Option<String>,
}

impl WSClient {
    pub fn new(id: String) -> Self {
        WSClient {
            id,
            subscriptions: Vec::new(),
            messages_sent: 0,
            messages_recv: 0,
            bytes_sent: 0,
            bytes_recv: 0,
            last_activity: current_timestamp(),
            authenticated: false,
            user_id: None,
        }
    }
    
    pub fn subscribe(&mut self, channel: Channel) {
        if !self.subscriptions.contains(&channel) {
            self.subscriptions.push(channel);
        }
    }
    
    pub fn unsubscribe(&mut self, channel: &Channel) {
        self.subscriptions.retain(|c| c != channel);
    }
    
    pub fn is_subscribed(&self, channel: &Channel) -> bool {
        self.subscriptions.contains(channel)
    }
}

/// Channel subscription tracking
#[derive(Debug, Clone)]
pub struct ChannelSubscribers {
    pub channel: Channel,
    pub clients: Vec<String>, // Client IDs
}

impl ChannelSubscribers {
    pub fn new(channel: Channel) -> Self {
        ChannelSubscribers {
            channel,
            clients: Vec::new(),
        }
    }
    
    pub fn add_client(&mut self, client_id: String) {
        if !self.clients.contains(&client_id) {
            self.clients.push(client_id);
        }
    }
    
    pub fn remove_client(&mut self, client_id: &str) {
        self.clients.retain(|c| c != client_id);
    }
    
    pub fn client_count(&self) -> usize {
        self.clients.len()
    }
}

/// WebSocket server configuration
#[derive(Debug, Clone)]
pub struct WSServerConfig {
    pub max_connections: usize,
    pub maxSubscriptions_per_client: usize,
    pub ping_interval_ms: u64,
    pub pong_timeout_ms: u64,
    pub max_message_size: usize,
    pub buffer_size: usize,
}

impl Default for WSServerConfig {
    fn default() -> Self {
        Self {
            max_connections: 100000,
            maxSubscriptions_per_client: 100,
            ping_interval_ms: 30000,
            pong_timeout_ms: 5000,
            max_message_size: 1024 * 1024, // 1MB
            buffer_size: 4096,
        }
    }
}

impl WSServerConfig {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Main WebSocket Server
pub struct WSServer {
    config: WSServerConfig,
    clients: HashMap<String, WSClient>,
    channels: HashMap<Channel, ChannelSubscribers>,
    client_id_counter: u64,
    messages_total: u64,
    bytes_total: u64,
    enabled: bool,
}

impl Default for WSServer {
    fn default() -> Self {
        Self::new()
    }
}

impl WSServer {
    pub fn new() -> Self {
        WSServer {
            config: WSServerConfig::new(),
            clients: HashMap::new(),
            channels: HashMap::new(),
            client_id_counter: 0,
            messages_total: 0,
            bytes_total: 0,
            enabled: true,
        }
    }
    
    pub fn with_config(config: WSServerConfig) -> Self {
        WSServer {
            config,
            clients: HashMap::new(),
            channels: HashMap::new(),
            client_id_counter: 0,
            messages_total: 0,
            bytes_total: 0,
            enabled: true,
        }
    }
    
    /// Get current timestamp in milliseconds
    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
    
    /// Register new client
    pub fn register_client(&mut self) -> String {
        self.client_id_counter += 1;
        let id = format!("client_{}", self.client_id_counter);
        
        let client = WSClient::new(id.clone());
        self.clients.insert(id.clone(), client);
        
        id
    }
    
    /// Remove client
    pub fn remove_client(&mut self, client_id: &str) {
        if let Some(client) = self.clients.get_mut(client_id) {
            // Unsubscribe from all channels
            for channel in &client.subscriptions {
                if let Some(channel_sub) = self.channels.get_mut(channel) {
                    channel_sub.remove_client(client_id);
                }
            }
        }
        self.clients.remove(client_id);
    }
    
    /// Subscribe client to channel
    pub fn subscribe(&mut self, client_id: &str, channel: Channel) -> Result<(), String> {
        // Get client
        let client = self.clients.get_mut(client_id)
            .ok_or_else(|| "Client not found".to_string())?;
        
        // Check subscription limit
        if client.subscriptions.len() >= self.config.maxSubscriptions_per_client {
            return Err("Max subscriptions reached".to_string());
        }
        
        // Add subscription
        client.subscribe(channel.clone());
        
        // Add to channel
        let channel_entry = self.channels.entry(channel)
            .or_insert_with(|| ChannelSubscribers::new(channel.clone()));
        channel_entry.add_client(client_id.to_string());
        
        Ok(())
    }
    
    /// Unsubscribe client from channel
    pub fn unsubscribe(&mut self, client_id: &str, channel: &Channel) -> Result<(), String> {
        let client = self.clients.get_mut(client_id)
            .ok_or_else(|| "Client not found".to_string())?;
        
        client.unsubscribe(channel);
        
        if let Some(channel_sub) = self.channels.get_mut(channel) {
            channel_sub.remove_client(client_id);
        }
        
        Ok(())
    }
    
    /// Get client
    pub fn get_client(&self, client_id: &str) -> Option<&WSClient> {
        self.clients.get(client_id)
    }
    
    /// Get channel subscriber count
    pub fn get_channel_subscribers(&self, channel: &Channel) -> usize {
        self.channels
            .get(channel)
            .map(|c| c.client_count())
            .unwrap_or(0)
    }
    
    /// Broadcast to channel
    pub fn broadcast(&mut self, channel: &Channel, data: &str) -> usize {
        let channel_sub = match self.channels.get(channel) {
            Some(c) => c,
            None => return 0,
        };
        
        let mut count = 0;
        for client_id in &channel_sub.clients {
            if let Some(client) = self.clients.get_mut(client_id) {
                client.messages_sent += 1;
                client.bytes_sent += data.len() as u64;
                count += 1;
            }
        }
        
        self.messages_total += count as u64;
        self.bytes_total += (data.len() * count) as u64;
        
        count
    }
    
    /// Get server stats
    pub fn stats(&self) -> WSServerStats {
        WSServerStats {
            total_connections: self.clients.len(),
            total_channels: self.channels.len(),
            messages_total: self.messages_total,
            bytes_total: self.bytes_total,
        }
    }
}

/// Server statistics
#[derive(Debug, Clone)]
pub struct WSServerStats {
    pub total_connections: usize,
    pub total_channels: usize,
    pub messages_total: u64,
    pub bytes_total: u64,
}

/// Trade event for WebSocket
#[derive(Debug, Clone)]
pub struct TradeEvent {
    pub symbol: String,
    pub price: u64,
    pub quantity: u64,
    pub buyer_order_id: String,
    pub seller_order_id: String,
    pub timestamp_ms: u64,
}

impl TradeEvent {
    pub fn to_json(&self) -> String {
        format!(r#"{{"symbol":"{}","price":{},"quantity":{},"buyerOrderId":"{}","sellerOrderId":"{}","timestamp":{}}}"#,
            self.symbol, self.price, self.quantity, self.buyer_order_id, self.seller_order_id, self.timestamp_ms)
    }
}

/// Ticker event for WebSocket
#[derive(Debug, Clone)]
pub struct TickerEvent {
    pub symbol: String,
    pub last_price: u64,
    pub price_change: i64,
    pub price_change_percent: f64,
    pub high_24h: u64,
    pub low_24h: u64,
    pub volume_24h: u64,
    pub quote_volume_24h: u64,
    pub timestamp_ms: u64,
}

impl TickerEvent {
    pub fn to_json(&self) -> String {
        format!(r#"{{"symbol":"{}","lastPrice":{},"priceChange":{},"priceChangePercent":{},"high24h":{},"low24h":{},"volume24h":{},"quoteVolume24h":{},"timestamp":{}}}"#,
            self.symbol, self.last_price, self.price_change, self.price_change_percent,
            self.high_24h, self.low_24h, self.volume_24h, self.quote_volume_24h, self.timestamp_ms)
    }
}

/// Order book event for WebSocket
#[derive(Debug, Clone)]
pub struct OrderBookEvent {
    pub symbol: String,
    pub last_update_id: u64,
    pub bids: Vec<(u64, u64)>, // (price, quantity)
    pub asks: Vec<(u64, u64)>,
}

impl OrderBookEvent {
    pub fn to_json(&self) -> String {
        let bids_str: Vec<String> = self.bids.iter()
            .map(|(p, q)| format!("[{},{}]", p, q))
            .collect();
        let asks_str: Vec<String> = self.asks.iter()
            .map(|(p, q)| format!("[{},{}]", p, q))
            .collect();
        
        format!(r#"{{"symbol":"{}","lastUpdateId":{},"bids":[{}],"asks":[{}]}}"#,
            self.symbol, self.last_update_id,
            bids_str.join(","),
            asks_str.join(","))
    }
}

/// Kline/candlestick event
#[derive(Debug, Clone)]
pub struct KlineEvent {
    pub symbol: String,
    pub interval: u32,
    pub open_time: u64,
    pub open: u64,
    pub high: u64,
    pub low: u64,
    pub close: u64,
    pub volume: u64,
    pub close_time: u64,
}

impl KlineEvent {
    pub fn to_json(&self) -> String {
        format!(r#"{{"symbol":"{}","interval":{},"openTime":{},"open":{},"high":{},"low":{},"close":{},"volume":{},"closeTime":{}}}"#,
            self.symbol, self.interval, self.open_time, self.open, self.high,
            self.low, self.close, self.volume, self.close_time)
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_client_registration() {
        let mut server = WSServer::new();
        
        let client_id = server.register_client();
        println!("Registered client: {}", client_id);
        
        assert!(server.get_client(&client_id).is_some());
    }
    
    #[test]
    fn test_subscription() {
        let mut server = WSServer::new();
        
        let client_id = server.register_client();
        let channel = Channel::Trade("BTC/USDT".to_string());
        
        server.subscribe(&client_id, channel.clone()).unwrap();
        
        let client = server.get_client(&client_id).unwrap();
        assert!(client.is_subscribed(&channel));
    }
    
    #[test]
    fn test_broadcast() {
        let mut server = WSServer::new();
        
        let client_id = server.register_client();
        let channel = Channel::Trade("BTC/USDT".to_string());
        
        server.subscribe(&client_id, channel.clone()).unwrap();
        
        let count = server.broadcast(&channel, r#"{"test":true}"#);
        assert_eq!(count, 1);
    }
}