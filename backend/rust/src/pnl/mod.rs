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

/// Apply one fill to a position and return the PnL it realized.
///
/// A fill that reduces or flips the position realizes `(price - entry) * qty`
/// for the closed part, where the sign of the closed quantity carries the
/// direction (long closed by a sell, short closed by a buy). The remainder of
/// the fill opens a position in the new direction at the fill price. The
/// previous implementation only ever updated a long position, so a short was
/// never opened, reduced, or realized, and its PnL was silently dropped.
fn apply_fill(position: &mut Position, trade: &Trade) -> f64 {
    let signed = if trade.side == "buy" {
        trade.quantity
    } else {
        -trade.quantity
    };

    // Fills in the same direction as the current position (or the first fill
    // of a flat position) extend it.
    if position.quantity == 0.0 || (position.quantity > 0.0) == (signed > 0.0) {
        let new_quantity = position.quantity + signed;
        position.cost_basis += trade.price * signed;
        position.quantity = new_quantity;
        position.entry_price = position.cost_basis / new_quantity;
        return 0.0;
    }

    // Opposite direction: close what we hold, realize on the closed part.
    let closing = signed.abs().min(position.quantity.abs());
    let direction = if position.quantity > 0.0 { 1.0 } else { -1.0 };
    let realized = (trade.price - position.entry_price) * closing * direction;

    position.quantity -= direction * closing;
    position.cost_basis = position.entry_price * position.quantity;

    // Anything left over opens a position in the new direction.
    let remainder = signed.abs() - closing;
    if remainder > 0.0 {
        position.quantity = direction * -remainder;
        position.cost_basis = trade.price * position.quantity;
        position.entry_price = trade.price;
    } else if position.quantity == 0.0 {
        position.cost_basis = 0.0;
        position.entry_price = 0.0;
    }

    realized
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

    // Record a fill and update the position.
    pub fn record_trade(&mut self, trade: Trade) {
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

        apply_fill(position, &trade);

        self.trades
            .entry(trade.user_id.clone())
            .or_insert_with(Vec::new)
            .push(trade);
    }

    // Realized PnL, computed by replaying the user's fills for the symbol.
    //
    // The position is rebuilt from the trade log rather than read back from
    // the live map, so the result depends only on the fills and stays correct
    // as the position is opened, flipped and closed.
    pub fn calculate_realized_pnl(&self, user_id: &str, symbol: &str) -> f64 {
        let user_trades = match self.trades.get(user_id) {
            Some(t) => t,
            None => return 0.0,
        };

        let mut position = Position {
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            quantity: 0.0,
            entry_price: 0.0,
            cost_basis: 0.0,
        };

        let mut realized = 0.0;
        for trade in user_trades {
            if trade.symbol != symbol {
                continue;
            }
            realized += apply_fill(&mut position, trade);
        }

        realized
    }

    // Calculate unrealized PnL
    pub fn calculate_unrealized_pnl(&self, user_id: &str, symbol: &str, current_price: f64) -> f64 {
        let position = match self.positions.get(user_id) {
            Some(p) => p.get(symbol),
            None => return 0.0,
        };
        
        if let Some(pos) = position {
            if pos.quantity != 0.0 {
                // Signed quantity: a short (negative) earns when price falls.
                return (current_price - pos.entry_price) * pos.quantity;
            }
        }
        
        0.0
    }

    // Get total PnL record
    pub fn get_pnl_record(&self, user_id: &str, symbol: &str, current_price: f64) -> PnLRecord {
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

    fn trade(side: &str, price: f64, quantity: f64) -> Trade {
        Trade {
            order_id: "o".to_string(),
            user_id: "user1".to_string(),
            symbol: "BTCUSDT".to_string(),
            side: side.to_string(),
            price,
            quantity,
            fee: 0.0,
            timestamp: 0,
        }
    }

    #[test]
    fn long_round_trip_realizes_the_price_difference() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("buy", 50_000.0, 1.0));
        engine.record_trade(trade("sell", 55_000.0, 1.0));

        assert_eq!(engine.calculate_realized_pnl("user1", "BTCUSDT"), 5_000.0);
        // Flat afterwards, so there is nothing unrealized.
        assert_eq!(engine.calculate_unrealized_pnl("user1", "BTCUSDT", 60_000.0), 0.0);
    }

    #[test]
    fn short_round_trip_realizes_a_profit_when_price_falls() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("sell", 50_000.0, 2.0));
        engine.record_trade(trade("buy", 45_000.0, 2.0));

        // The old implementation dropped this entirely and returned 0.
        assert_eq!(engine.calculate_realized_pnl("user1", "BTCUSDT"), 10_000.0);
    }

    #[test]
    fn open_short_has_unrealized_pnl_that_grows_as_price_falls() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("sell", 50_000.0, 1.0));

        assert_eq!(engine.calculate_unrealized_pnl("user1", "BTCUSDT", 45_000.0), 5_000.0);
        assert_eq!(engine.calculate_unrealized_pnl("user1", "BTCUSDT", 55_000.0), -5_000.0);
    }

    #[test]
    fn partial_close_realizes_only_the_closed_quantity() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("buy", 50_000.0, 2.0));
        engine.record_trade(trade("sell", 51_000.0, 1.0));

        assert_eq!(engine.calculate_realized_pnl("user1", "BTCUSDT"), 1_000.0);
        // One unit still long at 50k; at 52k that is +2k unrealized.
        assert_eq!(engine.calculate_unrealized_pnl("user1", "BTCUSDT", 52_000.0), 2_000.0);
    }

    #[test]
    fn flip_through_zero_closes_then_opens_the_other_side() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("buy", 50_000.0, 1.0));
        // Sell 3: closes the long (+1k) and opens a 2-unit short at 51k.
        engine.record_trade(trade("sell", 51_000.0, 3.0));

        assert_eq!(engine.calculate_realized_pnl("user1", "BTCUSDT"), 1_000.0);
        // Short 2 at 51k; at 50k that is +2k unrealized.
        assert_eq!(engine.calculate_unrealized_pnl("user1", "BTCUSDT", 50_000.0), 2_000.0);
    }

    #[test]
    fn pnl_record_totals_realized_and_unrealized() {
        let mut engine = PnLEngine::new();
        engine.record_trade(trade("buy", 50_000.0, 1.0));
        engine.record_trade(trade("sell", 52_000.0, 1.0));
        engine.record_trade(trade("buy", 52_000.0, 1.0));

        let record = engine.get_pnl_record("user1", "BTCUSDT", 53_000.0);
        assert_eq!(record.realized_pnl, 2_000.0);
        assert_eq!(record.unrealized_pnl, 1_000.0);
        assert_eq!(record.total_pnl, 3_000.0);
    }
}
