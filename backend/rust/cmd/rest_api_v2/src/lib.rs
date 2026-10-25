//! REST API v2 - market data endpoints.
//!
//! Market data is served from the shared [`MarketDataService`]. The previous
//! implementation returned a hardcoded `{"symbol":..,"price":50000.0}` ticker
//! and always-empty order book.

use std::sync::Arc;

use tigerex_marketdata::MarketDataService;

pub struct RESTAPIV2 {
    market: Arc<MarketDataService>,
}

/// A JSON response body paired with an HTTP status code.
#[derive(Debug)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}

impl RESTAPIV2 {
    pub fn new(market: Arc<MarketDataService>) -> Self {
        Self { market }
    }

    /// Route a request. Returns 404 for unknown paths and 503 when a known
    /// endpoint has no live data, so callers can never mistake a placeholder
    /// for real market data.
    pub fn handle(&self, method: &str, path: &str) -> ApiResponse {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();

        match (method, parts.as_slice()) {
            ("GET", ["api", "v2", "ticker", symbol]) => self.market_ticker(symbol),
            ("GET", ["api", "v2", "depth", symbol]) => self.order_book(symbol),
            ("GET", ["api", "v2", "ping"]) => ApiResponse {
                status: 200,
                body: "{\"message\":\"pong\"}".to_string(),
            },
            _ => ApiResponse {
                status: 404,
                body: "{\"error\":\"not found\"}".to_string(),
            },
        }
    }

    /// Ticker for a symbol, or 503 when there is no live data.
    pub fn market_ticker(&self, symbol: &str) -> ApiResponse {
        match self.market.get_ticker(symbol) {
            Some(ticker) => match serde_json::to_string(&ticker) {
                Ok(body) => ApiResponse { status: 200, body },
                Err(_) => ApiResponse {
                    status: 500,
                    body: "{\"error\":\"serialization failed\"}".to_string(),
                },
            },
            None => ApiResponse {
                status: 503,
                body: format!("{{\"error\":\"no market data for {symbol}\"}}"),
            },
        }
    }

    /// Order book for a symbol, or 503 when there is no live data.
    pub fn order_book(&self, symbol: &str) -> ApiResponse {
        match self.market.get_orderbook(symbol) {
            Some(book) => match serde_json::to_string(&book) {
                Ok(body) => ApiResponse { status: 200, body },
                Err(_) => ApiResponse {
                    status: 500,
                    body: "{\"error\":\"serialization failed\"}".to_string(),
                },
            },
            None => ApiResponse {
                status: 503,
                body: format!("{{\"error\":\"no order book for {symbol}\"}}"),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tigerex_marketdata::OrderBook;

    #[test]
    fn ticker_returns_503_without_live_data() {
        let api = RESTAPIV2::new(Arc::new(MarketDataService::new()));
        let res = api.market_ticker("BTC/USDT");
        assert_eq!(res.status, 503);
        assert!(res.body.contains("no market data"));
    }

    #[test]
    fn ticker_returns_recorded_price() {
        let market = Arc::new(MarketDataService::new());
        market.update_ticker("BTC/USDT", 42_000.0, 1.0);
        let api = RESTAPIV2::new(market);

        let res = api.market_ticker("BTC/USDT");
        assert_eq!(res.status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&res.body).unwrap();
        assert_eq!(parsed["price"], 42_000.0);
    }

    #[test]
    fn order_book_reflects_recorded_state() {
        let market = Arc::new(MarketDataService::new());
        let mut book = OrderBook::new("BTC/USDT");
        book.bids.push(tigerex_marketdata::OrderBookLevel { price: 41_999.0, quantity: 0.5 });
        market.update_orderbook("BTC/USDT", book);
        let api = RESTAPIV2::new(market);

        let res = api.order_book("BTC/USDT");
        assert_eq!(res.status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&res.body).unwrap();
        assert_eq!(parsed["bids"][0]["price"], 41_999.0);
    }

    #[test]
    fn routing_reports_unknown_paths() {
        let api = RESTAPIV2::new(Arc::new(MarketDataService::new()));
        assert_eq!(api.handle("GET", "/api/v2/nope").status, 404);
        assert_eq!(api.handle("GET", "/api/v2/ping").status, 200);
    }
}
