//! TigerEx Trading Service - Core trading operations

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Trade request
#[derive(Debug, Clone)]
pub struct TradeRequest {
    pub user_id: String,
    pub symbol: String,
    pub side: TradeSide,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub stop_price: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
    TakeProfit,
}

/// Trade result
#[derive(Debug, Clone, serde::Serialize)]
pub struct TradeResult {
    pub order_id: String,
    pub status: TradeStatus,
    pub filled_quantity: f64,
    pub average_price: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TradeStatus {
    Pending,
    Open,
    Filled,
    PartiallyFilled,
    Cancelled,
    Rejected,
}

/// Trading session
pub struct TradingSession {
    pub user_id: String,
    pub symbol: String,
    pub orders: Vec<String>,
    pub realized_pnl: f64,
    pub created_at: u64,
}

/// Trading service
pub struct TradingService {
    sessions: RwLock<HashMap<String, TradingSession>>,
    order_status: RwLock<HashMap<String, TradeStatus>>,
    trading_pairs: RwLock<HashMap<String, TradingPair>>,
}

#[derive(Debug, Clone)]
pub struct TradingPair {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub min_quantity: f64,
    pub min_notional: f64,
    pub max_leverage: u32,
    pub precision: u8,
}

impl TradingService {
    pub fn new() -> Self {
        let service = Self {
            sessions: RwLock::new(HashMap::new()),
            order_status: RwLock::new(HashMap::new()),
            trading_pairs: RwLock::new(HashMap::new()),
        };
        
        // Register trading pairs
        service.register_pair("BTC/USDT", "BTC", "USDT", 0.0001, 10.0, 125, 8);
        service.register_pair("ETH/USDT", "ETH", "USDT", 0.001, 10.0, 100, 8);
        service.register_pair("BNB/USDT", "BNB", "USDT", 0.01, 10.0, 50, 8);
        
        service
    }

    fn register_pair(&self, symbol: &str, base: &str, quote: &str, min_qty: f64, min_notional: f64, leverage: u32, precision: u8) {
        let mut pairs = self.trading_pairs.write().unwrap();
        pairs.insert(symbol.to_string(), TradingPair {
            symbol: symbol.to_string(),
            base_asset: base.to_string(),
            quote_asset: quote.to_string(),
            min_quantity: min_qty,
            min_notional,
            max_leverage: leverage,
            precision,
        });
    }

    /// Start trading session
    pub fn start_session(&self, user_id: &str, symbol: &str) -> Result<(), String> {
        // Validate pair exists
        {
            let pairs = self.trading_pairs.read().unwrap();
            if !pairs.contains_key(symbol) {
                return Err("Trading pair not found".to_string());
            }
        }

        let session_key = format!("{}:{}", user_id, symbol);
        let mut sessions = self.sessions.write().unwrap();
        
        if sessions.contains_key(&session_key) {
            return Ok(()); // Session already exists
        }

        sessions.insert(session_key, TradingSession {
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            orders: Vec::new(),
            realized_pnl: 0.0,
            created_at: current_timestamp(),
        });

        Ok(())
    }

    /// Validate order
    pub fn validate_order(&self, request: &TradeRequest) -> Result<(), String> {
        // Check trading pair
        let pair = {
            let pairs = self.trading_pairs.read().unwrap();
            pairs.get(&request.symbol).cloned()
        };

        if let Some(pair) = pair {
            // Validate quantity
            if request.quantity < pair.min_quantity {
                return Err(format!("Minimum quantity is {}", pair.min_quantity));
            }

            // Validate notional
            if request.price * request.quantity < pair.min_notional {
                return Err(format!("Minimum notional is {}", pair.min_notional));
            }

            Ok(())
        } else {
            Err("Trading pair not found".to_string())
        }
    }

    /// Submit order
    pub fn submit_order(&self, request: &TradeRequest) -> Result<TradeResult, String> {
        // Validate order
        self.validate_order(request)?;

        let order_id = generate_order_id();
        
        let mut statuses = self.order_status.write().unwrap();
        statuses.insert(order_id.clone(), TradeStatus::Pending);

        Ok(TradeResult {
            order_id,
            status: TradeStatus::Pending,
            filled_quantity: 0.0,
            average_price: 0.0,
        })
    }

    /// Cancel order
    pub fn cancel_order(&self, order_id: &str) -> Result<(), String> {
        let mut statuses = self.order_status.write().unwrap();
        
        if let Some(status) = statuses.get_mut(order_id) {
            if *status == TradeStatus::Pending || *status == TradeStatus::Open {
                *status = TradeStatus::Cancelled;
                Ok(())
            } else {
                Err("Order cannot be cancelled".to_string())
            }
        } else {
            Err("Order not found".to_string())
        }
    }

    /// Get order status
    pub fn get_order_status(&self, order_id: &str) -> Option<TradeStatus> {
        let statuses = self.order_status.read().unwrap();
        statuses.get(order_id).copied()
    }

    /// Get trading pair info
    pub fn get_pair(&self, symbol: &str) -> Option<TradingPair> {
        let pairs = self.trading_pairs.read().unwrap();
        pairs.get(symbol).cloned()
    }

    /// List all pairs
    pub fn list_pairs(&self) -> Vec<String> {
        let pairs = self.trading_pairs.read().unwrap();
        pairs.keys().cloned().collect()
    }

    /// Get user session
    pub fn get_session(&self, user_id: &str, symbol: &str) -> Option<TradingSession> {
        let session_key = format!("{}:{}", user_id, symbol);
        let sessions = self.sessions.read().unwrap();
        sessions.get(&session_key).cloned()
    }
}

impl Default for TradingService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_order_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("trade_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_submit_order() {
        let service = TradingService::new();
        
        let request = TradeRequest {
            user_id: "user1".to_string(),
            symbol: "BTC/USDT".to_string(),
            side: TradeSide::Buy,
            order_type: OrderType::Limit,
            price: 50000.0,
            quantity: 1.0,
            stop_price: None,
        };
        
        let result = service.submit_order(&request).unwrap();
        assert!(!result.order_id.is_empty());
    }
}