// Hedge - Delta Neutral Strategies
// Rust for hedging strategies

use std::collections::HashMap;

// Position delta
#[derive(Debug, Clone)]
pub struct PositionDelta {
    pub symbol: String,
    pub size: f64,
    pub delta: f64, // price sensitivity
}

// Hedge order
#[derive(Debug, Clone)]
pub struct HedgeOrder {
    pub id: String,
    pub hedge_id: String,
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub price: f64,
    pub status: String,
}

// Hedge portfolio
pub struct HedgePortfolio {
    positions: HashMap<String, PositionDelta>,
    target_delta: f64,
}

impl HedgePortfolio {
    pub fn new() -> Self {
        HedgePortfolio {
            positions: HashMap::new(),
            target_delta: 0.0,
        }
    }

    pub fn set_target(&mut self, delta: f64) {
        self.target_delta = delta;
    }

    pub fn add_position(&mut self, symbol: &str, size: f64, price: f64) {
        let delta = size * price; // Simplified delta
        
        self.positions.insert(symbol.to_string(), PositionDelta {
            symbol: symbol.to_string(),
            size,
            delta,
        });
    }

    pub fn current_delta(&self) -> f64 {
        let mut total = 0.0;
        for (_, pos) in &self.positions {
            total += pos.delta;
        }
        total
    }

    pub fn rebalance(&self, market_price: f64) -> Vec<HedgeOrder> {
        let mut orders = Vec::new();
        
        let current = self.current_delta();
        let diff = self.target_delta - current;
        
        if diff.abs() > 0.01 {
            let side = if diff > 0.0 { "buy" } else { "sell" };
            let size = diff.abs() / market_price;
            
            orders.push(HedgeOrder {
                id: format!("hh_{}", now_ms()),
                hedge_id: "auto".to_string(),
                symbol: "BTCUSDT".to_string(),
                side: side.to_string(),
                size,
                price: market_price,
                status: "pending".to_string(),
            });
        }
        
        orders
    }
}

// Delta hedge strategy
pub struct DeltaHedge {
    portfolio: HedgePortfolio,
    rebalance_threshold: f64,
}

impl DeltaHedge {
    pub fn new(threshold: f64) -> Self {
        DeltaHedge {
            portfolio: HedgePortfolio::new(),
            rebalance_threshold: threshold,
        }
    }

    pub fn check_rebalance(&mut self, current_price: f64) -> bool {
        let delta = self.portfolio.current_delta();
        let deviation = (delta - self.portfolio.target_delta).abs();
        
        deviation > self.rebalance_threshold
    }

    pub fn get_hedge_orders(&self, price: f64) -> Vec<HedgeOrder> {
        self.portfolio.rebalance(price)
    }

    pub fn set_positions(&mut self, positions: Vec<(String, f64, f64)>) {
        for (sym, size, price) in positions {
            self.portfolio.add_position(&sym, size, price);
        }
    }
}

// Cross-exchange hedge
pub struct CrossHedge {
    exchange_a_balance: f64,
    exchange_b_balance: f64,
    target_spread: f64,
}

impl CrossHedge {
    pub fn new(target_spread: f64) -> Self {
        CrossHedge {
            exchange_a_balance: 0.0,
            exchange_b_balance: 0.0,
            target_spread,
        }
    }

    pub fn update_balance(&mut self, exchange: &str, balance: f64) {
        if exchange == "A" {
            self.exchange_a_balance = balance;
        } else {
            self.exchange_b_balance = balance;
        }
    }

    pub fn needs_rebalance(&self) -> bool {
        let total = self.exchange_a_balance + self.exchange_b_balance;
        if total == 0.0 {
            return false;
        }
        
        let ratio = self.exchange_a_balance / total;
        (ratio - 0.5).abs() > self.target_spread
    }

    pub fn get_rebalance_amount(&self) -> f64 {
        let total = self.exchange_a_balance + self.exchange_b_balance;
        let avg = total / 2.0;
        avg - self.exchange_a_balance
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
    fn test_hedge() {
        let mut hedge = DeltaHedge::new(0.1);
        
        hedge.set_positions(vec![
            ("BTCUSDT".to_string(), 1.0, 65000.0),
        ]);
        
        assert!(hedge.check_rebalance(65000.0));
    }
}