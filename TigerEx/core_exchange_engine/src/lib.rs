//! Deterministic in-memory limit-order matching primitives for TigerEx.
//! Uses decimal arithmetic and price-time priority. Persistence, risk checks,
//! and settlement must be supplied by the production service before deployment.

use rust_decimal::Decimal;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side { Buy, Sell }

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LimitOrder {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub price: Decimal,
    pub quantity: Decimal,
    pub remaining: Decimal,
    sequence: u64,
}

impl LimitOrder {
    pub fn new(id: String, user_id: String, symbol: String, side: Side, price: Decimal, quantity: Decimal) -> Result<Self, EngineError> {
        if id.trim().is_empty() || user_id.trim().is_empty() || symbol.trim().is_empty() {
            return Err(EngineError::InvalidOrder("identifiers and symbol are required".into()));
        }
        if price <= Decimal::ZERO || quantity <= Decimal::ZERO {
            return Err(EngineError::InvalidOrder("price and quantity must be positive".into()));
        }
        Ok(Self { id, user_id, symbol, side, price, quantity, remaining: quantity, sequence: 0 })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Trade {
    pub maker_order_id: String,
    pub taker_order_id: String,
    pub symbol: String,
    pub price: Decimal,
    pub quantity: Decimal,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EngineError {
    InvalidOrder(String),
    DuplicateOrderId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmitResult {
    pub trades: Vec<Trade>,
    pub resting_quantity: Decimal,
}

#[derive(Default)]
pub struct MatchingEngine {
    books: HashMap<String, Vec<LimitOrder>>,
    used_order_ids: std::collections::HashSet<String>,
    next_sequence: u64,
}

impl MatchingEngine {
    pub fn new() -> Self { Self::default() }

    /// Submit a limit order. Matching uses best price, then FIFO sequence.
    /// A non-crossing remainder rests in the book; a fully filled order does not.
    pub fn submit_limit(&mut self, mut incoming: LimitOrder) -> Result<SubmitResult, EngineError> {
        if self.used_order_ids.contains(&incoming.id) {
            return Err(EngineError::DuplicateOrderId);
        }
        let symbol = incoming.symbol.clone();
        let mut trades = Vec::new();
        let book = self.books.entry(symbol.clone()).or_default();

        while incoming.remaining > Decimal::ZERO {
            let candidate = book.iter().enumerate()
                .filter(|(_, maker)| maker.side != incoming.side && crosses(&incoming, maker))
                .min_by(|(_, a), (_, b)| {
                    let price_order = match incoming.side {
                        Side::Buy => a.price.cmp(&b.price),
                        Side::Sell => b.price.cmp(&a.price),
                    };
                    price_order.then_with(|| a.sequence.cmp(&b.sequence))
                })
                .map(|(index, _)| index);

            let Some(index) = candidate else { break };
            let maker = &mut book[index];
            let traded = incoming.remaining.min(maker.remaining);
            if traded <= Decimal::ZERO { break; }
            trades.push(Trade {
                maker_order_id: maker.id.clone(),
                taker_order_id: incoming.id.clone(),
                symbol: symbol.clone(),
                price: maker.price,
                quantity: traded,
            });
            maker.remaining -= traded;
            incoming.remaining -= traded;
            if maker.remaining == Decimal::ZERO {
                let removed = book.remove(index);
                self.used_order_ids.remove(&removed.id);
            }
        }

        let resting_quantity = incoming.remaining;
        if resting_quantity > Decimal::ZERO {
            self.next_sequence = self.next_sequence.checked_add(1)
                .ok_or_else(|| EngineError::InvalidOrder("sequence exhausted".into()))?;
            incoming.sequence = self.next_sequence;
            self.used_order_ids.insert(incoming.id.clone());
            book.push(incoming);
        }
        Ok(SubmitResult { trades, resting_quantity })
    }

    pub fn cancel(&mut self, order_id: &str) -> bool {
        for book in self.books.values_mut() {
            if let Some(index) = book.iter().position(|order| order.id == order_id) {
                book.remove(index);
                self.used_order_ids.remove(order_id);
                return true;
            }
        }
        false
    }

    pub fn open_orders(&self, symbol: &str) -> Vec<LimitOrder> {
        let mut orders = self.books.get(symbol).cloned().unwrap_or_default();
        orders.sort_by(|a, b| match a.side {
            Side::Buy if b.side == Side::Buy => b.price.cmp(&a.price).then_with(|| a.sequence.cmp(&b.sequence)),
            Side::Sell if b.side == Side::Sell => a.price.cmp(&b.price).then_with(|| a.sequence.cmp(&b.sequence)),
            Side::Buy => std::cmp::Ordering::Less,
            Side::Sell => std::cmp::Ordering::Greater,
        });
        orders
    }
}

fn crosses(taker: &LimitOrder, maker: &LimitOrder) -> bool {
    match taker.side {
        Side::Buy => taker.price >= maker.price,
        Side::Sell => taker.price <= maker.price,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(v: &str) -> Decimal { Decimal::from_str(v).expect("valid test decimal") }
    fn order(id: &str, side: Side, price: &str, qty: &str) -> LimitOrder {
        LimitOrder::new(id.into(), format!("user-{id}"), "BTC-USDT".into(), side, dec(price), dec(qty)).unwrap()
    }

    #[test]
    fn matches_at_resting_price_and_preserves_partial_remainder() {
        let mut engine = MatchingEngine::new();
        engine.submit_limit(order("ask", Side::Sell, "100", "2")).unwrap();
        let result = engine.submit_limit(order("bid", Side::Buy, "101", "3")).unwrap();
        assert_eq!(result.trades.len(), 1);
        assert_eq!(result.trades[0].price, dec("100"));
        assert_eq!(result.trades[0].quantity, dec("2"));
        assert_eq!(result.resting_quantity, dec("1"));
    }

    #[test]
    fn uses_price_then_time_priority() {
        let mut engine = MatchingEngine::new();
        engine.submit_limit(order("ask1", Side::Sell, "100", "1")).unwrap();
        engine.submit_limit(order("ask2", Side::Sell, "100", "1")).unwrap();
        let result = engine.submit_limit(order("bid", Side::Buy, "100", "1")).unwrap();
        assert_eq!(result.trades[0].maker_order_id, "ask1");
    }

    #[test]
    fn rejects_invalid_and_duplicate_live_orders_and_cancels() {
        assert!(LimitOrder::new("x".into(), "u".into(), "BTC".into(), Side::Buy, dec("0"), dec("1")).is_err());
        let mut engine = MatchingEngine::new();
        engine.submit_limit(order("ask", Side::Sell, "100", "1")).unwrap();
        assert_eq!(engine.submit_limit(order("ask", Side::Sell, "100", "1")), Err(EngineError::DuplicateOrderId));
        assert!(engine.cancel("ask"));
        assert!(!engine.cancel("ask"));
    }
}
