//! Liquidity Pool - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pool {
    pub id: String,
    pub token_a: String,
    pub token_b: String,
    pub reserve_a: f64,
    pub reserve_b: f64,
    pub lp_token: String,
}

pub struct LiquidityPool {
    pools: HashMap<String, Pool>,
}

impl LiquidityPool {
    pub fn new() -> Self {
        Self { pools: HashMap::new() }
    }
    pub fn create(&mut self, tok_a: &str, tok_b: &str) -> String {
        let id = format!("POOL_{}_{}", tok_a, tok_b);
        self.pools.insert(id.clone(), Pool {
            id: id.clone(),
            token_a: tok_a.to_string(),
            token_b: tok_b.to_string(),
            reserve_a: 0.0,
            reserve_b: 0.0,
            lp_token: format!("LP_{}", id),
        });
        id
    }
    pub fn add_liquidity(&mut self, id: &str, amt_a: f64, amt_b: f64) -> Result<(), String> {
        let pool = self.pools.get_mut(id).ok_or("Pool not found")?;
        pool.reserve_a += amt_a;
        pool.reserve_b += amt_b;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test() {
        let mut p = LiquidityPool::new();
        let id = p.create("USDC", "ETH");
        p.add_liquidity(&id, 10000.0, 5.0).unwrap();
    }
}
