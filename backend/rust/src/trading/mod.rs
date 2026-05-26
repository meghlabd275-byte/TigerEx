pub mod trading {
    use std::collections::HashMap;
    
    #[derive(Debug, Clone)]
    pub struct Trade {
        pub id: String,
        pub symbol: String,
        pub price: f64,
        pub quantity: i32,
        pub side: String,
        pub timestamp: i64,
    }
    
    pub struct TradingEngine {
        positions: HashMap<String, Position>,
    }
    
    #[derive(Debug, Clone)]
    pub struct Position {
        pub symbol: String,
        pub quantity: i32,
        pub avg_price: f64,
    }
    
    impl TradingEngine {
        pub fn new() -> Self {
            TradingEngine { positions: HashMap::new() }
        }
        
        pub fn execute(&mut self, trade: Trade) {
            let pos = self.positions.entry(trade.symbol.clone()).or_insert(
                Position {
                    symbol: trade.symbol.clone(),
                    quantity: 0,
                    avg_price: 0.0,
                }
            );
            
            if trade.side == "buy" {
                pos.quantity += trade.quantity;
            } else {
                pos.quantity -= trade.quantity;
            }
        }
        
        pub fn get_position(&self, symbol: &str) -> Option<&Position> {
            self.positions.get(symbol)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_trade() {
        let mut engine = TradingEngine::new();
        engine.execute(Trade {
            id: "1".to_string(),
            symbol: "BTC".to_string(),
            price: 50000.0,
            quantity: 1,
            side: "buy".to_string(),
            timestamp: 0,
        });
        assert!(engine.get_position("BTC").is_some());
    }
}