//! Trading Pairs - Rust Implementation
//! 
//! Trading pair management and configuration

use serde::{Serialize, Deserialize};

/// Trading pair configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingPair {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub price_precision: u8,
    pub quantity_precision: u8,
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub min_notional: f64,
    pub status: PairStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PairStatus {
    Trading,
    Halted,
    Pending,
    Delisted,
}

/// Fee structure for pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairFees {
    pub symbol: String,
    pub maker_fee: f64,
    pub taker_fee: f64,
}

pub struct TradingPairManager {
    pairs: Vec<TradingPair>,
    fees: Vec<PairFees>,
}

impl TradingPairManager {
    pub fn new() -> Self {
        let mut manager = Self {
            pairs: Vec::new(),
            fees: Vec::new(),
        };
        
        manager.initialize_pairs();
        manager
    }

    fn initialize_pairs(&mut self) {
        let pairs = vec![
            ("BTC/USDT", "BTC", "USDT", 2, 6, 0.00001, 1000.0),
            ("ETH/USDT", "ETH", "USDT", 2, 5, 0.0001, 10000.0),
            ("BNB/USDT", "BNB", "USDT", 2, 4, 0.001, 100000.0),
            ("SOL/USDT", "SOL", "USDT", 3, 3, 0.01, 100000.0),
            ("XRP/USDT", "XRP", "USDT", 5, 1, 1.0, 10000000.0),
            ("ADA/USDT", "ADA", "USDT", 5, 1, 1.0, 10000000.0),
            ("DOGE/USDT", "DOGE", "USDT", 6, 0, 10.0, 100000000.0),
            ("DOT/USDT", "DOT", "USDT", 3, 2, 0.1, 1000000.0),
            ("MATIC/USDT", "MATIC", "USDT", 4, 1, 1.0, 10000000.0),
            ("LTC/USDT", "LTC", "USDT", 2, 4, 0.001, 100000.0),
        ];

        for (symbol, base, quote, price_prec, qty_prec, min_qty, max_qty) in pairs {
            self.pairs.push(TradingPair {
                symbol: symbol.to_string(),
                base_asset: base.to_string(),
                quote_asset: quote.to_string(),
                price_precision: price_prec,
                quantity_precision: qty_prec,
                min_quantity: min_qty,
                max_quantity: max_qty,
                min_notional: 10.0,
                status: PairStatus::Trading,
            });

            self.fees.push(PairFees {
                symbol: symbol.to_string(),
                maker_fee: 0.001,
                taker_fee: 0.001,
            });
        }
    }

    pub fn get_pair(&self, symbol: &str) -> Option<&TradingPair> {
        self.pairs.iter().find(|p| p.symbol == symbol)
    }

    pub fn is_active(&self, symbol: &str) -> bool {
        matches!(self.get_pair(symbol), Some(p) if p.status == PairStatus::Trading)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_pair() {
        let manager = TradingPairManager::new();
        let pair = manager.get_pair("BTC/USDT");
        assert!(pair.is_some());
    }
}