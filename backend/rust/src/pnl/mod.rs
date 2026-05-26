// PnL Engine - Profit and Loss Calculation
// Rust for deterministic, concurrent-safe PnL

use std::collections::HashMap;

// Trade execution
#[derive(Debug, Clone)]
pub struct Trade {
    pub order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String, // buy, sell
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub timestamp: i64,
}

// PnL record
#[derive(Debug, Clone)]
pub struct PnLRecord {
    pub user_id: String,
    pub symbol: String,
    pub realized_pnl: f64,
    pub unrealized_pnl: f64,
    pub total_pnl: f64,
    pub fee_paid: f64,
    pub volume: f64,
}

// Position for PnL tracking
#[derive(Debug, Clone)]
pub struct Position {
    pub user_id: String,
    pub symbol: String,
    pub quantity: f64, // positive = long, negative = short
    pub entry_price: f64,
    pub cost_basis: f64, // total cost
}

// PnL Engine
pub struct PnLEngine {
    // user_id -> symbol -> Position
    positions: HashMap<String, HashMap<String, Position>>,
    // Trades for each user
    trades: HashMap<String, Vec<Trade>>,
}

impl PnLEngine {
    pub fn new() -> Self {
        PnLEngine {
            positions: HashMap::new(),
            trades: HashMap::new(),
        }
    }

    // Record trade
    pub fn record_trade(&mut self, trade: Trade) {
        // Update position
        let user_positions = self.positions
            .entry(trade.user_id.clone())
            .or_insert_with(HashMap::new);
        
        let position = user_positions
            .entry(trade.symbol.clone())
            .or_insert_with(|| Position {
                user_id: trade.user_id.clone(),
                symbol: trade.symbol.clone(),
                quantity: 0.0,
                entry_price: 0.0,
                cost_basis: 0.0,
            });
        
        let value = trade.price * trade.quantity;
        
        if trade.side == "buy" {
            // Add to position
            let new_quantity = position.quantity + trade.quantity;
            let new_cost = position.cost_basis + value;
            position.quantity = new_quantity;
            position.cost_basis = new_cost;
            if new_quantity > 0.0 {
                position.entry_price = new_cost / new_quantity;
            }
        } else {
            // Sell - realize PnL if long
            let sold = trade.quantity.min(position.quantity.abs());
            if position.quantity > 0.0 && sold > 0.0 {
                let pnl = (trade.price - position.entry_price) * sold;
                position.quantity -= sold;
                position.cost_basis -= position.entry_price * sold;
            }
        }
        
        // Record trade
        self.trades
            .entry(trade.user_id.clone())
            .or_insert_with(Vec::new)
            .push(trade);
    }

    // Calculate realized PnL
    pub fn calculate_realized_pnl(&self, user_id: &str, symbol: &str) -> f64 {
        let user_trades = match self.trades.get(user_id) {
            Some(t) => t,
            None => return 0.0,
        };
        
        let position = self.positions
            .get(user_id)
            .and_then(|p| p.get(symbol));
        
        let mut pnl = 0.0;
        let mut cost = 0.0;
        let mut qty = 0.0;
        
        for trade in user_trades {
            if trade.symbol != symbol {
                continue;
            }
            
            if trade.side == "buy" {
                cost += trade.price * trade.quantity;
                qty += trade.quantity;
            } else {
                // Realize PnL on sale
                let avg_price = if qty > 0.0 { cost / qty } else { 0.0 };
                pnl += (trade.price - avg_price) * trade.quantity.min(qty);
                cost -= avg_price * trade.quantity.min(qty);
                qty -= trade.quantity.min(qty);
            }
        }
        
        pnl
    }

    // Calculate unrealized PnL
    pub fn calculate_unrealized_pnl(&self, user_id: &str, symbol: &str, current_price: f64) -> f64 {
        let position = match self.positions.get(user_id) {
            Some(p) => p.get(symbol),
            None => return 0.0,
        };
        
        if let Some(pos) = position {
            if pos.quantity > 0.0 {
                return (current_price - pos.entry_price) * pos.quantity;
            }
        }
        
        0.0
    }

    // Get total PnL record
    pub fn get_pnl_record(&self, user_id: &str, symbol: &str, current_price: f64) -> PnLRecord {
        let position = self.positions
            .get(user_id)
            .and_then(|p| p.get(symbol));
        
        let realized = self.calculate_realized_pnl(user_id, symbol);
        let unrealized = self.calculate_unrealized_pnl(user_id, symbol, current_price);
        
        let trades = self.trades.get(user_id);
        let volume: f64 = trades
            .map(|t| {
                t.iter()
                    .filter(|tr| tr.symbol == symbol)
                    .map(|tr| tr.price * tr.quantity)
                    .sum()
            })
            .unwrap_or(0.0);
        
        let fee: f64 = trades
            .map(|t| {
                t.iter()
                    .filter(|tr| tr.symbol == symbol)
                    .map(|tr| tr.fee)
                    .sum()
            })
            .unwrap_or(0.0);
        
        PnLRecord {
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            realized_pnl: realized,
            unrealized_pnl: unrealized,
            total_pnl: realized + unrealized,
            fee_paid: fee,
            volume,
        }
    }

    // Get historical PnL
    pub fn get_historical_pnl(&self, user_id: &str, from_ts: i64, to_ts: i64) -> Vec<(i64, f64)> {
        let user_trades = match self.trades.get(user_id) {
            Some(t) => t,
            None => return vec![],
        };
        
        let mut daily_pnl: HashMap<i64, f64> = HashMap::new();
        
        for trade in user_trades {
            if trade.timestamp >= from_ts && trade.timestamp <= to_ts {
                let day = (trade.timestamp / 86400000) * 86400000;
                let pnl = if trade.side == "buy" { -trade.price * trade.quantity } else { trade.price * trade.quantity };
                *daily_pnl.entry(day).or_insert(0.0) += pnl;
            }
        }
        
        let mut result: Vec<_> = daily_pnl.into_iter().collect();
        result.sort_by_key(|(ts, _)| *ts);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pnl() {
        let mut engine = PnLEngine::new();
        
        // Buy
        engine.record_trade(Trade {
            order_id: "1".to_string(),
            user_id: "user1".to_string(),
            symbol: "BTCUSDT".to_string(),
            side: "buy".to_string(),
            price: 50000.0,
            quantity: 1.0,
            fee: 10.0,
            timestamp: 1000,
        });
        
        // Sell
        engine.record_trade(Trade {
            order_id: "2".to_string(),
            user_id: "user1".to_string(),
            symbol: "BTCUSDT".to_string(),
            side: "sell".to_string(),
            price: 55000.0,
            quantity: 1.0,
            fee: 10.0,
            timestamp: 2000,
        });
        
        let pnl = engine.get_pnl_record("user1", "BTCUSDT", 55000.0);
        println!("Realized: {} Unrealized: {}", pnl.realized_pnl, pnl.unrealized_pnl);
    }
}