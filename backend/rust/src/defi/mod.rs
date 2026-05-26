//! DeFi Integration - Rust Implementation
//! 
//! Uniswap, Aave, Compound integrations

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub address: String,
    pub symbol: String,
    pub decimals: u8,
    pub price_usd: f64,
}

/// Pool info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pool {
    pub id: String,
    pub token_a: String,
    pub token_b: String,
    pub reserve_a: f64,
    pub reserve_b: f64,
    pub apy: f64,
}

/// Swap quote
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapQuote {
    pub from_token: String,
    pub to_token: String,
    pub from_amount: f64,
    pub to_amount: f64,
    pub price_impact: f64,
    pub route: Vec<String>,
}

/// Uniswap-like DEX
pub struct DEX {
    pub name: String,
    pub pools: HashMap<String, Pool>,
}

impl DEX {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_string(), pools: HashMap::new() }
    }
    
    pub fn add_pool(&mut self, id: &str, tok_a: &str, tok_b: &str, res_a: f64, res_b: f64) {
        self.pools.insert(id.to_string(), Pool {
            id: id.to_string(),
            token_a: tok_a.to_string(),
            token_b: tok_b.to_string(),
            reserve_a: res_a,
            reserve_b: res_b,
            apy: 0.0,
        });
    }
    
    pub fn get_price(&self, token_a: &str, token_b: &str) -> Option<f64> {
        for pool in self.pools.values() {
            if (&pool.token_a == token_a && &pool.token_b == token_b)
               || (&pool.token_a == token_b && &pool.token_b == token_a) {
                if pool.token_a == token_a {
                    return Some(pool.reserve_b / pool.reserve_a);
                } else {
                    return Some(pool.reserve_a / pool.reserve_b);
                }
            }
        }
        None
    }
    
    pub fn swap(&self, from: &str, to: &str, amount: f64) -> Option<SwapQuote> {
        let price = self.get_price(from, to)?;
        let to_amount = amount * price;
        
        Some(SwapQuote {
            from_token: from.to_string(),
            to_token: to.to_string(),
            from_amount: amount,
            to_amount,
            price_impact: 0.001,
            route: vec![from.to_string(), to.to_string()],
        })
    }
}

/// Lending pool (Aave-like)
pub struct LendingPool {
    pub token: String,
    pub total_supplied: f64,
    pub total_borrowed: f64,
    pub supply_apr: f64,
    pub borrow_apr: f64,
}

impl LendingPool {
    pub fn new(tok: &str) -> Self {
        Self { token: tok.to_string(), total_supplied: 0.0, total_borrowed: 0.0, supply_apr: 0.05, borrow_apr: 0.08 }
    }
    
    pub fn supply(&mut self, amount: f64) { self.total_supplied += amount; }
    pub fn borrow(&mut self, amount: f64) -> Result<(), String> {
        if amount > self.available() { Err("Insufficient liquidity".into()) } 
        else { self.total_borrowed += amount; Ok(()) }
    }
    
    pub fn available(&self) -> f64 { self.total_supplied * 0.8 - self.total_borrowed }
    pub fn utilization(&self) -> f64 { self.total_borrowed / self.total_supplied }
}

/// DeFi aggregator
pub struct DeFiAggregator {
    pub dexes: Vec<DEX>,
    pub lending_pools: HashMap<String, LendingPool>,
}

impl DeFiAggregator {
    pub fn new() -> Self {
        Self { dexes: vec![], lending_pools: HashMap::new() }
    }
    
    pub fn find_best_swap(&self, from: &str, to: &str, amount: f64) -> Option<SwapQuote> {
        for dex in &self.dexes {
            if let Some(quote) = dex.swap(from, to, amount) {
                return Some(quote);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_dex() {
        let mut dex = DEX::new("uniswap");
        dex.add_pool("ETH-USDT", "ETH", "USDT", 1000.0, 3000000.0);
        assert!(dex.get_price("ETH", "USDT").is_some());
    }
}