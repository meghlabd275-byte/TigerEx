//! WebSocket v2 - real-time market stream.
//!
//! All market data comes from the shared [`MarketDataService`]. The previous
//! implementation returned a hardcoded `{"s":..,"p":50000.0}` payload and
//! printed published messages to stdout instead of delivering them.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use tigerex_marketdata::{MarketDataService, Trade};
use tokio::sync::broadcast;

/// Broadcast payload for a single channel.
pub type Receiver = broadcast::Receiver<String>;

pub struct WebSocketV2 {
    market: Arc<MarketDataService>,
    channels: RwLock<HashMap<String, broadcast::Sender<String>>>,
}

impl WebSocketV2 {
    pub fn new(market: Arc<MarketDataService>) -> Self {
        Self {
            market,
            channels: RwLock::new(HashMap::new()),
        }
    }

    /// Subscribe to a channel, returning a receiver for its payloads.
    pub fn subscribe(&self, channel: &str) -> Receiver {
        let mut channels = self.channels.write().unwrap();
        channels
            .entry(channel.to_string())
            .or_insert_with(|| broadcast::channel(1024).0)
            .subscribe()
    }

    /// Publish a payload to a channel. Returns the number of receivers that
    /// accepted it, which is zero when nobody is subscribed.
    pub fn publish(&self, channel: &str, data: &str) -> usize {
        let channels = self.channels.read().unwrap();
        match channels.get(channel) {
            Some(tx) => tx.send(data.to_string()).unwrap_or(0),
            None => 0,
        }
    }

    /// Current ticker as JSON, or `None` when the symbol has no live data.
    pub fn ticker_stream(&self, symbol: &str) -> Option<String> {
        self.market
            .get_ticker(symbol)
            .and_then(|ticker| serde_json::to_string(&ticker).ok())
    }

    /// Current order book as JSON, or `None` when the symbol has no live data.
    pub fn orderbook_stream(&self, symbol: &str) -> Option<String> {
        self.market
            .get_orderbook(symbol)
            .and_then(|book| serde_json::to_string(&book).ok())
    }

    /// Record a trade so it appears in the trade stream.
    pub fn publish_trade(&self, trade: Trade) {
        self.market.add_trade(trade);
    }

    /// Recent trades as JSON for a symbol.
    pub fn trades_stream(&self, symbol: &str, limit: usize) -> Option<String> {
        let trades = self.market.get_trades(symbol, limit);
        if trades.is_empty() {
            return None;
        }
        serde_json::to_string(&trades).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tigerex_marketdata::Trade;

    fn trade(symbol: &str, price: f64, qty: f64) -> Trade {
        Trade {
            id: "t1".to_string(),
            symbol: symbol.to_string(),
            price,
            quantity: qty,
            side: "buy".to_string(),
            timestamp: 1,
        }
    }

    #[test]
    fn ticker_stream_is_none_without_live_data() {
        let svc = WebSocketV2::new(Arc::new(MarketDataService::new()));
        assert!(svc.ticker_stream("BTC/USDT").is_none());
    }

    #[test]
    fn ticker_stream_reflects_recorded_price() {
        let market = Arc::new(MarketDataService::new());
        market.update_ticker("BTC/USDT", 61_234.5, 2.0);
        let svc = WebSocketV2::new(market);

        let json = svc.ticker_stream("BTC/USDT").expect("ticker present");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["price"], 61_234.5);
        assert_eq!(parsed["symbol"], "BTC/USDT");
    }

    #[test]
    fn publish_reaches_subscribers_only() {
        let svc = WebSocketV2::new(Arc::new(MarketDataService::new()));
        let mut rx = svc.subscribe("BTC/USDT@trade");

        assert_eq!(svc.publish("BTC/USDT@trade", "hello"), 1);
        assert_eq!(rx.try_recv().unwrap(), "hello");

        // No subscriber on this channel, so the send is dropped.
        assert_eq!(svc.publish("ETH/USDT@trade", "nobody"), 0);
    }

    #[test]
    fn trades_stream_exposes_recorded_trades() {
        let svc = WebSocketV2::new(Arc::new(MarketDataService::new()));
        assert!(svc.trades_stream("BTC/USDT", 10).is_none());

        svc.publish_trade(trade("BTC/USDT", 50_000.0, 1.5));
        let json = svc.trades_stream("BTC/USDT", 10).expect("trades present");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed[0]["price"], 50_000.0);
    }
}
