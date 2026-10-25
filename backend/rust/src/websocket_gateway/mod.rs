//! WebSocket Gateway - Rust Implementation
//!
//! Real-time trading via WebSocket

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// WebSocket message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSMessage {
    pub channel: String,
    pub data: serde_json::Value,
    pub timestamp: i64,
}

/// Subscribe request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscribeRequest {
    pub method: String,
    pub params: Vec<String>,
    pub id: u64,
}

/// Ticker update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickerUpdate {
    pub symbol: String,
    pub price: f64,
    pub change_24h: f64,
    pub volume_24h: f64,
}

/// Order book entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookEntry {
    pub price: f64,
    pub quantity: f64,
}

/// Order book snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
    pub last_update: i64,
}

/// Trade event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeEvent {
    pub id: String,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub time: i64,
    pub is_buyer_maker: bool,
}

/// WebSocket connection
pub struct WSConnection {
    pub id: String,
    pub subscriptions: Vec<String>,
    pub authenticated: bool,
    pub user_id: Option<String>,
}

pub struct WebSocketGateway {
    connections: HashMap<String, WSConnection>,
    subscriptions: HashMap<String, Vec<String>>,
    counter: u64,
}

impl WebSocketGateway {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            subscriptions: HashMap::new(),
            counter: 0,
        }
    }

    /// Accept connection
    pub fn accept_connection(&mut self) -> String {
        self.counter += 1;
        let conn_id = format!("ws_{}", self.counter);

        self.connections.insert(conn_id.clone(), WSConnection {
            id: conn_id.clone(),
            subscriptions: Vec::new(),
            authenticated: false,
            user_id: None,
        });

        conn_id
    }

    /// Subscribe
    pub fn subscribe(&mut self, conn_id: &str, channel: &str) -> Result<(), String> {
        let conn = self.connections.get_mut(conn_id)
            .ok_or("Connection not found")?;

        conn.subscriptions.push(channel.to_string());

        // Add to channel subscribers
        self.subscriptions.entry(channel.to_string())
            .or_insert_with(Vec::new)
            .push(conn_id.to_string());

        Ok(())
    }

    /// Send ticker update
    pub fn send_ticker(&self, symbol: &str, price: f64) -> WSMessage {
        WSMessage {
            channel: format!("{}@ticker", symbol),
            data: serde_json::json!({
                "symbol": symbol,
                "price": price,
                "change_24h": 0.025,
                "volume_24h": 1000000000.0
            }),
            timestamp: current_timestamp_ms(),
        }
    }

    /// Send order book snapshot from real book state.
    pub fn send_orderbook(&self, symbol: &str, book: &OrderBook) -> WSMessage {
        WSMessage {
            channel: format!("{}@depth", symbol),
            data: serde_json::json!({
                "symbol": symbol,
                "bids": book.bids.iter().map(|l| [l.price, l.quantity]).collect::<Vec<_>>(),
                "asks": book.asks.iter().map(|l| [l.price, l.quantity]).collect::<Vec<_>>(),
                "lastUpdate": book.last_update,
            }),
            timestamp: current_timestamp_ms(),
        }
    }

    /// Send trade
    pub fn send_trade(&self, symbol: &str, price: f64, qty: f64) -> WSMessage {
        WSMessage {
            channel: format!("{}@trade", symbol),
            data: serde_json::json!({
                "id": "trade_1",
                "symbol": symbol,
                "price": price,
                "quantity": qty,
                "time": current_timestamp_ms(),
                "isBuyerMaker": false
            }),
            timestamp: current_timestamp_ms(),
        }
    }

    /// Broadcast to channel
    pub fn broadcast(&self, channel: &str, message: WSMessage) {
        let _conn_ids = self.subscriptions.get(channel);
        // In real impl: send to all connected clients
    }

    /// Authenticate a connection against the session store.
    ///
    /// A connection is authenticated only if `verify` accepts the token and
    /// returns the owning user id. The previous implementation accepted any
    /// string beginning with `tk_` and hardcoded the caller to `user1`, which
    /// let anyone act as that account over the socket.
    pub fn authenticate<F>(&mut self, conn_id: &str, token: &str, verify: F) -> Result<String, String>
    where
        F: FnOnce(&str) -> Option<String>,
    {
        if token.is_empty() {
            return Err("empty token".to_string());
        }

        let user_id = verify(token).ok_or_else(|| "invalid or expired token".to_string())?;

        let conn = self.connections.get_mut(conn_id)
            .ok_or("Connection not found")?;

        conn.authenticated = true;
        conn.user_id = Some(user_id.clone());
        Ok(user_id)
    }

    /// Whether a connection has completed authentication.
    pub fn is_authenticated(&self, conn_id: &str) -> bool {
        self.connections
            .get(conn_id)
            .map(|c| c.authenticated)
            .unwrap_or(false)
    }

    /// Close connection
    pub fn close_connection(&mut self, conn_id: &str) {
        if let Some(conn) = self.connections.remove(conn_id) {
            for channel in &conn.subscriptions {
                if let Some(subs) = self.subscriptions.get_mut(channel) {
                    subs.retain(|c| c != conn_id);
                }
            }
        }
    }
}

/// Stable identifier for a trade, derived from its own fields.
fn trade_id(symbol: &str, price: f64, qty: f64, time: i64) -> String {
    format!("{symbol}:{price}:{qty}:{time}")
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_accept() {
        let mut gw = WebSocketGateway::new();
        let conn_id = gw.accept_connection();
        assert!(conn_id.starts_with("ws_"));
    }

    #[test]
    fn rejects_unverified_tokens() {
        let mut gw = WebSocketGateway::new();
        let conn_id = gw.accept_connection();

        // The old implementation accepted anything starting with "tk_".
        assert!(gw.authenticate(&conn_id, "tk_anything", |_| None).is_err());
        assert!(!gw.is_authenticated(&conn_id));

        assert!(gw.authenticate(&conn_id, "", |_| Some("u".into())).is_err());
        assert!(!gw.is_authenticated(&conn_id));
    }

    #[test]
    fn accepts_tokens_the_store_verifies() {
        let mut gw = WebSocketGateway::new();
        let conn_id = gw.accept_connection();

        let user = gw
            .authenticate(&conn_id, "real-session-token", |token| {
                if token == "real-session-token" {
                    Some("user-42".to_string())
                } else {
                    None
                }
            })
            .unwrap();

        assert_eq!(user, "user-42");
        assert!(gw.is_authenticated(&conn_id));
    }
}