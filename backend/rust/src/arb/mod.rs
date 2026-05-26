// Arbitrage - Triangular and Cross-Exchange
// Rust for arbitrage detection and execution

use std::collections::HashMap;

// Arbitrage opportunity
#[derive(Debug, Clone)]
pub struct ArbOpportunity {
    pub id: String,
    pub path: Vec<String>, // [BTC, ETH, USDT]
    pub profit_percent: f64,
    pub volume: f64,
    pub timestamp: i64,
}

// Triangular arbitrage (single exchange)
pub struct TriArb {
    pairs: HashMap<String, f64>, // symbol -> price
}

impl TriArb {
    pub fn new() -> Self {
        TriArb {
            pairs: HashMap::new(),
        }
    }

    // Set prices
    pub fn set_price(&mut self, symbol: &str, price: f64) {
        self.pairs.insert(symbol.to_string(), price);
    }

    // Calculate triangular arbitrage
    pub fn calculate(&self, base: &str) -> Option<f64> {
        // A -> B -> C -> A
        // Example: BTC->ETH->USDT->BTC
        
        let btc_eth = self.pairs.get("ETHBTC").copied().unwrap_or(0.0);
        let eth_usdt = self.pairs.get("USDTETH").copied().unwrap_or(0.0);
        let usdt_btc = self.pairs.get("BTCUSDT").copied().unwrap_or(0.0);

        if btc_eth > 0.0 && eth_usdt > 0.0 && usdt_btc > 0.0 {
            // 1 BTC -> ETH -> USDT -> BTC
            let step1 = 1.0 / btc_eth; // 1 BTC to ETH
            let step2 = step1 * eth_usdt; // ETH to USDT
            let step3 = step2 / usdt_btc; // USDT to BTC
            
            let profit = (step3 - 1.0) * 100.0;
            
            if profit > 0.0 {
                return Some(profit);
            }
        }

        None
    }
}

// Cross-exchange arbitrage
pub struct CrossArb {
    exchange_a_prices: HashMap<String, f64>,
    exchange_b_prices: HashMap<String, f64>,
}

impl CrossArb {
    pub fn new() -> Self {
        CrossArb {
            exchange_a_prices: HashMap::new(),
            exchange_b_prices: HashMap::new(),
        }
    }

    pub fn set_exchange_price(&mut self, exchange: &str, symbol: &str, price: f64) {
        if exchange == "A" {
            self.exchange_a_prices.insert(symbol.to_string(), price);
        } else {
            self.exchange_b_prices.insert(symbol.to_string(), price);
        }
    }

    pub fn find_opportunities(&self, min_profit: f64) -> Vec<ArbOpportunity> {
        let mut opportunities = Vec::new();

        for (symbol, price_a) in &self.exchange_a_prices {
            if let Some(price_b) = self.exchange_b_prices.get(symbol) {
                let spread = ((price_a - price_b) / price_b).abs() * 100.0;

                if spread > min_profit {
                    // Buy on cheaper, sell on expensive
                    let exchange = if price_a < price_b { "A" } else { "B" };

                    opportunities.push(ArbOpportunity {
                        id: format!("arb_{}", now_ms()),
                        path: vec!["exchange_A".to_string(), symbol.clone(), "exchange_B".to_string()],
                        profit_percent: spread,
                        volume: 0.0,
                        timestamp: now_ms(),
                    });
                }
            }
        }

        opportunities
    }

    pub fn calculate_profit(&self, symbol: &str, volume: f64) -> f64 {
        let price_a = self.exchange_a_prices.get(symbol).copied().unwrap_or(0.0);
        let price_b = self.exchange_b_prices.get(symbol).copied().unwrap_or(0.0);

        if price_a == 0.0 || price_b == 0.0 {
            return 0.0;
        }

        let spread = price_a - price_b;
        spread.abs() * volume
    }
}

// Flash loan arbitrage (simulated)
pub struct FlashArb {
    opportunities: Vec<ArbOpportunity>,
}

impl FlashArb {
    pub fn new() -> Self {
        FlashArb {
            opportunities: Vec::new(),
        }
    }

    pub fn check_flash_opportunity(&self, prices: &HashMap<String, f64>, max_spread: f64) -> Option<ArbOpportunity> {
        // Simplified: check for profitable triangular path
        None // Would require complex calculation
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
    fn test_tri_arb() {
        let mut arb = TriArb::new();
        
        arb.set_price("ETHBTC", 20.0);
        arb.set_price("USDTETH", 3000.0);
        arb.set_price("BTCUSDT", 60000.0);
        
        let profit = arb.calculate("BTC");
        
        // May or may not be profitable
        assert!(profit >= Some(0.0));
    }
}