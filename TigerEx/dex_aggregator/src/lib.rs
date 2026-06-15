//! TigerEx native DEX aggregation engine.
//!
//! This module is intentionally dependency-free and deterministic so it can run inside
//! low-latency execution services, risk simulations, and transaction builders without
//! relying on competitor APIs or third-party routing services.

use std::collections::{BTreeMap, VecDeque};

pub type Amount = u128;
pub const BPS_DENOMINATOR: Amount = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Asset(pub String);

impl Asset {
    pub fn new(symbol: impl Into<String>) -> Self {
        Self(symbol.into().to_ascii_uppercase())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DexError {
    InvalidPool,
    InvalidAmount,
    ExcessiveFee,
    RouteNotFound,
    SlippageExceeded,
    ArithmeticOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiquidityPool {
    pub id: String,
    pub base: Asset,
    pub quote: Asset,
    pub reserve_base: Amount,
    pub reserve_quote: Amount,
    pub fee_bps: u16,
    pub enabled: bool,
}

impl LiquidityPool {
    pub fn new(
        id: impl Into<String>,
        base: Asset,
        quote: Asset,
        reserve_base: Amount,
        reserve_quote: Amount,
        fee_bps: u16,
    ) -> Result<Self, DexError> {
        if reserve_base == 0 || reserve_quote == 0 || base == quote {
            return Err(DexError::InvalidPool);
        }
        if fee_bps as Amount >= BPS_DENOMINATOR {
            return Err(DexError::ExcessiveFee);
        }
        Ok(Self {
            id: id.into(),
            base,
            quote,
            reserve_base,
            reserve_quote,
            fee_bps,
            enabled: true,
        })
    }

    pub fn quote_exact_in(&self, input: &Asset, amount_in: Amount) -> Result<SwapQuote, DexError> {
        if !self.enabled || amount_in == 0 {
            return Err(DexError::InvalidAmount);
        }
        let (reserve_in, reserve_out, output) = if input == &self.base {
            (self.reserve_base, self.reserve_quote, self.quote.clone())
        } else if input == &self.quote {
            (self.reserve_quote, self.reserve_base, self.base.clone())
        } else {
            return Err(DexError::InvalidPool);
        };
        let amount_after_fee = amount_in
            .checked_mul(BPS_DENOMINATOR - self.fee_bps as Amount)
            .ok_or(DexError::ArithmeticOverflow)?
            / BPS_DENOMINATOR;
        let numerator = amount_after_fee
            .checked_mul(reserve_out)
            .ok_or(DexError::ArithmeticOverflow)?;
        let denominator = reserve_in
            .checked_add(amount_after_fee)
            .ok_or(DexError::ArithmeticOverflow)?;
        let amount_out = numerator / denominator;
        if amount_out == 0 || amount_out >= reserve_out {
            return Err(DexError::InvalidAmount);
        }
        Ok(SwapQuote {
            pool_id: self.id.clone(),
            input: input.clone(),
            output,
            amount_in,
            amount_out,
            fee_paid: amount_in - amount_after_fee,
        })
    }

    pub fn apply_exact_in(&mut self, quote: &SwapQuote) -> Result<(), DexError> {
        if quote.pool_id != self.id {
            return Err(DexError::InvalidPool);
        }
        if quote.input == self.base {
            self.reserve_base = self
                .reserve_base
                .checked_add(quote.amount_in)
                .ok_or(DexError::ArithmeticOverflow)?;
            self.reserve_quote = self
                .reserve_quote
                .checked_sub(quote.amount_out)
                .ok_or(DexError::InvalidAmount)?;
        } else if quote.input == self.quote {
            self.reserve_quote = self
                .reserve_quote
                .checked_add(quote.amount_in)
                .ok_or(DexError::ArithmeticOverflow)?;
            self.reserve_base = self
                .reserve_base
                .checked_sub(quote.amount_out)
                .ok_or(DexError::InvalidAmount)?;
        } else {
            return Err(DexError::InvalidPool);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwapQuote {
    pub pool_id: String,
    pub input: Asset,
    pub output: Asset,
    pub amount_in: Amount,
    pub amount_out: Amount,
    pub fee_paid: Amount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteQuote {
    pub hops: Vec<SwapQuote>,
    pub input: Asset,
    pub output: Asset,
    pub amount_in: Amount,
    pub amount_out: Amount,
    pub min_amount_out: Amount,
    pub total_fee_paid: Amount,
}

#[derive(Debug, Clone)]
pub struct RouteRequest {
    pub input: Asset,
    pub output: Asset,
    pub amount_in: Amount,
    pub max_hops: usize,
    pub slippage_bps: u16,
}

#[derive(Debug, Default, Clone)]
pub struct DexAggregator {
    pools: BTreeMap<String, LiquidityPool>,
}

impl DexAggregator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn upsert_pool(&mut self, pool: LiquidityPool) -> Result<(), DexError> {
        if pool.reserve_base == 0 || pool.reserve_quote == 0 || pool.base == pool.quote {
            return Err(DexError::InvalidPool);
        }
        self.pools.insert(pool.id.clone(), pool);
        Ok(())
    }

    pub fn disable_pool(&mut self, pool_id: &str) -> bool {
        if let Some(pool) = self.pools.get_mut(pool_id) {
            pool.enabled = false;
            return true;
        }
        false
    }

    pub fn best_route(&self, request: RouteRequest) -> Result<RouteQuote, DexError> {
        if request.amount_in == 0 || request.max_hops == 0 || request.input == request.output {
            return Err(DexError::InvalidAmount);
        }
        if request.slippage_bps as Amount >= BPS_DENOMINATOR {
            return Err(DexError::SlippageExceeded);
        }

        let mut queue = VecDeque::new();
        queue.push_back((request.input.clone(), request.amount_in, Vec::<SwapQuote>::new()));
        let mut best: Option<RouteQuote> = None;

        while let Some((asset, amount, hops)) = queue.pop_front() {
            if hops.len() >= request.max_hops {
                continue;
            }
            for pool in self.pools.values().filter(|pool| pool.enabled) {
                let Ok(quote) = pool.quote_exact_in(&asset, amount) else {
                    continue;
                };
                if hops.iter().any(|hop| hop.pool_id == quote.pool_id) {
                    continue;
                }
                let mut next_hops = hops.clone();
                next_hops.push(quote.clone());
                if quote.output == request.output {
                    let total_fee_paid = next_hops.iter().map(|hop| hop.fee_paid).sum();
                    let min_amount_out = quote.amount_out
                        * (BPS_DENOMINATOR - request.slippage_bps as Amount)
                        / BPS_DENOMINATOR;
                    let route = RouteQuote {
                        hops: next_hops.clone(),
                        input: request.input.clone(),
                        output: request.output.clone(),
                        amount_in: request.amount_in,
                        amount_out: quote.amount_out,
                        min_amount_out,
                        total_fee_paid,
                    };
                    if best.as_ref().map(|current| route.amount_out > current.amount_out).unwrap_or(true) {
                        best = Some(route);
                    }
                } else {
                    queue.push_back((quote.output.clone(), quote.amount_out, next_hops));
                }
            }
        }
        best.ok_or(DexError::RouteNotFound)
    }

    pub fn execute_exact_in(&mut self, request: RouteRequest) -> Result<RouteQuote, DexError> {
        let route = self.best_route(request)?;
        for hop in &route.hops {
            let pool = self.pools.get_mut(&hop.pool_id).ok_or(DexError::InvalidPool)?;
            pool.apply_exact_in(hop)?;
        }
        Ok(route)
    }

    pub fn pool_count(&self) -> usize {
        self.pools.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(symbol: &str) -> Asset {
        Asset::new(symbol)
    }

    #[test]
    fn chooses_best_direct_pool() {
        let mut aggregator = DexAggregator::new();
        aggregator.upsert_pool(LiquidityPool::new("thin", asset("ETH"), asset("USDT"), 1_000, 1_000_000, 30).unwrap()).unwrap();
        aggregator.upsert_pool(LiquidityPool::new("deep", asset("ETH"), asset("USDT"), 10_000, 20_000_000, 10).unwrap()).unwrap();

        let route = aggregator.best_route(RouteRequest {
            input: asset("ETH"),
            output: asset("USDT"),
            amount_in: 10_000,
            max_hops: 2,
            slippage_bps: 50,
        }).unwrap();

        assert_eq!(route.hops.len(), 1);
        assert_eq!(route.hops[0].pool_id, "deep");
        assert!(route.amount_out > 9_000_000);
    }

    #[test]
    fn supports_multi_hop_routes_without_competitor_dependency() {
        let mut aggregator = DexAggregator::new();
        aggregator.upsert_pool(LiquidityPool::new("btc-eth", asset("BTC"), asset("ETH"), 100_000_000, 2_000_000_000, 20).unwrap()).unwrap();
        aggregator.upsert_pool(LiquidityPool::new("eth-usdc", asset("ETH"), asset("USDC"), 2_000_000_000, 8_000_000_000_000, 20).unwrap()).unwrap();

        let route = aggregator.best_route(RouteRequest {
            input: asset("BTC"),
            output: asset("USDC"),
            amount_in: 100_000_000,
            max_hops: 3,
            slippage_bps: 100,
        }).unwrap();

        assert_eq!(route.hops.len(), 2);
        assert_eq!(route.output, asset("USDC"));
        assert!(route.min_amount_out < route.amount_out);
    }

    #[test]
    fn execution_updates_pool_reserves() {
        let mut aggregator = DexAggregator::new();
        aggregator.upsert_pool(LiquidityPool::new("eth-usdt", asset("ETH"), asset("USDT"), 1_000, 2_000_000, 30).unwrap()).unwrap();
        let before = aggregator.pools.get("eth-usdt").unwrap().reserve_base;
        let route = aggregator.execute_exact_in(RouteRequest {
            input: asset("ETH"),
            output: asset("USDT"),
            amount_in: 5,
            max_hops: 1,
            slippage_bps: 25,
        }).unwrap();
        assert_eq!(aggregator.pools.get("eth-usdt").unwrap().reserve_base, before + 5);
        assert_eq!(route.hops[0].input, asset("ETH"));
    }
}
