//! Stream Processor - Rust Implementation
//! High-performance event streaming for TigerEx

use serde::{Deserialize, Serialize};
use std::collections::{VecDeque, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Ticker data from market stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub bid: f64,
    pub ask: f64,
    pub last: f64,
    pub volume_24h: f64,
}

/// Trade event from market stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub price: f64,
    pub quantity: f64,
    pub side: String,
    pub timestamp: i64,
}

/// Stream message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub msg_type: String,
    pub symbol: Option<String>,
    pub data: serde_json::Value,
    pub timestamp: i64,
}

/// Stream event handler function type
pub type EventHandler = Box<dyn Fn(StreamMessage) + Send + Sync>;

/// High-performance stream processor with ring buffer
pub struct StreamProcessor {
    buffer: Mutex<VecDeque<StreamMessage>>,
    max_size: usize,
    handlers: Mutex<Vec<Arc<EventHandler>>],
    subscriptions: Mutex<HashMap<String, bool>>,
}

impl StreamProcessor {
    /// Create new stream processor
    pub fn new(max_size: usize) -> Self {
        Self {
            buffer: Mutex::new(VecDeque::with_capacity(max_size)),
            max_size,
            handlers: Mutex::new(Vec::new()),
            subscriptions: Mutex::new(HashMap::new()),
        }
    }

    /// Subscribe to symbols
    pub fn subscribe(&self, symbols: &[String]) {
        let mut subs = self.subscriptions.lock().unwrap();
        for symbol in symbols {
            subs.insert(symbol.clone(), true);
        }
    }

    /// Add event handler
    pub fn add_handler(&self, handler: Arc<EventHandler>) {
        let mut handlers = self.handlers.lock().unwrap();
        handlers.push(handler);
    }

    /// Push message to stream
    pub fn push(&self, msg: StreamMessage) -> bool {
        let mut buffer = self.buffer.lock().unwrap();
        
        if buffer.len() >= self.max_size {
            return false; // Buffer full
        }
        
        buffer.push_back(msg);
        
        // Notify handlers
        drop(buffer);
        self.notify_handlers();
        
        true
    }

    /// Pop message from stream
    pub fn pop(&self) -> Option<StreamMessage> {
        let mut buffer = self.buffer.lock().unwrap();
        buffer.pop_front()
    }

    /// Get buffer length
    pub fn len(&self) -> usize {
        let buffer = self.buffer.lock().unwrap();
        buffer.len()
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn notify_handlers(&self) {
        let handlers = self.handlers.lock().unwrap();
        let buffer = self.buffer.lock().unwrap();
        
        if let Some(msg) = buffer.back() {
            for handler in handlers.iter() {
                handler(msg.clone());
            }
        }
    }

    /// Process ticker data
    pub fn process_ticker(&self, symbol: &str, bid: f64, ask: f64, last: f64, volume: f64) {
        let msg = StreamMessage {
            msg_type: "ticker".to_string(),
            symbol: Some(symbol.to_string()),
            data: serde_json::json!({
                "symbol": symbol,
                "bid": bid,
                "ask": ask,
                "last": last,
                "volume_24h": volume
            }),
            timestamp: current_timestamp_ms(),
        };
        let _ = self.push(msg);
    }

    /// Process trade data
    pub fn process_trade(&self, id: &str, symbol: &str, price: f64, qty: f64, side: &str) {
        let msg = StreamMessage {
            msg_type: "trade".to_string(),
            symbol: Some(symbol.to_string()),
            data: serde_json::json!({
                "id": id,
                "symbol": symbol,
                "price": price,
                "quantity": qty,
                "side": side,
                "timestamp": current_timestamp_ms()
            }),
            timestamp: current_timestamp_ms(),
        };
        let _ = self.push(msg);
    }
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Global stream processor instance
pub fn create_stream_processor() -> StreamProcessor {
    StreamProcessor::new(1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_processor() {
        let sp = StreamProcessor::new(100);
        sp.subscribe(&["BTC/USDT".to_string()]);
        
        let msg = StreamMessage {
            msg_type: "ticker".to_string(),
            symbol: Some("BTC/USDT".to_string()),
            data: serde_json::json!({"price": 50000.0)),
            timestamp: current_timestamp_ms(),
        };
        
        assert!(sp.push(msg));
        assert_eq!(sp.len(), 1);
    }

    #[test]
    fn test_process_ticker() {
        let sp = StreamProcessor::new(100);
        sp.process_ticker("BTC/USDT", 49900.0, 50100.0, 50000.0, 1000.0);
        assert!(!sp.is_empty());
    }
}