// Perpetual Contract - USD-M Futures
// Rust for perpetual futures contract logic

use std::collections::HashMap;

// Contract state
#[derive(Debug, Clone)]
pub struct PerpetualState {
    pub symbol: String,
    pub mark_price: f64,
    pub index_price: f64,
    pub funding_rate: f64,
    pub open_interest: f64,
    pub volume_24h: f64,
}

// Position data
#[derive(Debug, Clone)]
pub struct Position {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String, // long, short
    pub size: f64,
    pub entry_price: f64,
    pub leverage: f64,
    pub liquidation_price: f64,
    pub margin: f64,
    pub unrealized_pnl: f64,
}

// Order data
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String, // limit, market, stop
    pub price: f64,
    pub size: f64,
    pub filled: f64,
    pub status: String, // pending, filled, cancelled
}

// Funding calculation
#[derive(Debug, Clone)]
pub struct FundingInfo {
    pub symbol: String,
    pub current_rate: f64,
    pub next_funding: i64,
    pub payment: f64,
    pub accrued: f64,
}

// Perpetual engine
pub struct PerpetualEngine {
    positions: HashMap<String, Position>, // user:symbol -> position
    orders: Vec<Order>,
    states: HashMap<String, PerpetualState>,
}

impl PerpetualEngine {
    pub fn new() -> Self {
        PerpetualEngine {
            positions: HashMap::new(),
            orders: Vec::new(),
            states: HashMap::new(),
        }
    }

    // Initialize state
    pub fn init_contract(&mut self, symbol: &str, price: f64) {
        let state = PerpetualState {
            symbol: symbol.to_string(),
            mark_price: price,
            index_price: price,
            funding_rate: 0.0001, // 0.01%
            open_interest: 0.0,
            volume_24h: 0.0,
        };
        self.states.insert(symbol.to_string(), state);
    }

    // Open position
    pub fn open_position(&mut self, user_id: &str, symbol: &str, side: &str, price: f64, size: f64, leverage: f64) -> Result<String, String> {
        if let Some(state) = self.states.get_mut(symbol) {
            let margin = price * size / leverage;
            
            let liq_price = if side == "long" {
                price * (1.0 - 1.0/leverage)
            } else {
                price * (1.0 + 1.0/leverage)
            };

            let pos = Position {
                id: format!("pos_{}", user_id),
                user_id: user_id.to_string(),
                symbol: symbol.to_string(),
                side: side.to_string(),
                size,
                entry_price: price,
                leverage,
                liquidation_price: liq_price,
                margin,
                unrealized_pnl: 0.0,
            };

            let key = format!("{}:{}", user_id, symbol);
            self.positions.insert(key, pos);
            state.open_interest += size;

            return Ok("position_opened".to_string());
        }

        Err("contract not found".to_string())
    }

    // Close position
    pub fn close_position(&mut self, user_id: &str, symbol: &str) -> Result<f64, String> {
        let key = format!("{}:{}", user_id, symbol);
        
        if let Some(pos) = self.positions.remove(&key) {
            if let Some(state) = self.states.get_mut(symbol) {
                state.open_interest -= pos.size;
                return Ok(pos.unrealized_pnl);
            }
        }

        Err("position not found".to_string())
    }

    // Calculate unrealized PnL
    pub fn calculate_pnl(&mut self, user_id: &str, symbol: &str) -> f64 {
        let key = format!("{}:{}", user_id, symbol);
        
        if let Some(pos) = self.positions.get(&key) {
            if let Some(state) = self.states.get(symbol) {
                let price_diff = state.mark_price - pos.entry_price;
                
                if pos.side == "long" {
                    return price_diff * pos.size;
                } else {
                    return -price_diff * pos.size;
                }
            }
        }
        
        0.0
    }

    // Check liquidation
    pub fn check_liquidation(&self, user_id: &str, symbol: &str) -> bool {
        let key = format!("{}:{}", user_id, symbol);
        
        if let Some(pos) = self.positions.get(&key) {
            if let Some(state) = self.states.get(symbol) {
                if pos.side == "long" {
                    return state.mark_price <= pos.liquidation_price;
                } else {
                    return state.mark_price >= pos.liquidation_price;
                }
            }
        }
        
        false
    }

    // Calculate funding
    pub fn calculate_funding(&self, symbol: &str, position_size: f64) -> FundingInfo {
        if let Some(state) = self.states.get(symbol) {
            let payment = position_size * state.funding_rate * state.index_price;
            
            return FundingInfo {
                symbol: symbol.to_string(),
                current_rate: state.funding_rate,
                next_funding: now_ms() + 28800000, // 8 hours
                payment,
                accrued: payment,
            };
        }
        
        FundingInfo {
            symbol: symbol.to_string(),
            current_rate: 0.0,
            next_funding: 0,
            payment: 0.0,
            accrued: 0.0,
        }
    }

    // Update mark price
    pub fn update_price(&mut self, symbol: &str, mark: f64, index: f64) {
        if let Some(state) = self.states.get_mut(symbol) {
            state.mark_price = mark;
            state.index_price = index;
        }
    }

    // Get state
    pub fn get_state(&self, symbol: &str) -> Option<&PerpetualState> {
        self.states.get(symbol)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perpetual() {
        let mut engine = PerpetualEngine::new();
        
        engine.init_contract("BTC-PERP", 65000.0);
        
        let result = engine.open_position("user1", "BTC-PERP", "long", 65000.0, 1.0, 10.0);
        
        assert!(result.is_ok());
    }
}