//! TigerEx Options Trading Engine - Rust Implementation
//! 
//! Options pricing and trading engine with Black-Scholes model support
//! 
//! Migration from Go to Rust for deterministic options pricing

use std::collections::HashMap;

/// Option type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionType {
    Call,
    Put,
}

/// Option style
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionStyle {
    European,
    American,
}

/// Option contract
#[derive(Debug, Clone)]
pub struct OptionContract {
    pub symbol: String,
    pub underlying: String,
    pub option_type: OptionType,
    pub style: OptionStyle,
    pub strike_price: u64,
    pub expiration: u64,
    pub contract_size: u64,
}

/// Position
#[derive(Debug, Clone)]
pub struct OptionsPosition {
    pub id: String,
    pub user_id: String,
    pub contract: OptionContract,
    pub size: i64,  // Positive for long, negative for short
    pub entry_price: u64,
    pub premium: u64,
    pub opened_at: u64,
}

/// Order
#[derive(Debug, Clone)]
pub struct OptionsOrder {
    pub id: String,
    pub user_id: String,
    pub contract: OptionContract,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub size: i64,
    pub price: Option<u64>,
    pub premium: Option<u64>,
    pub status: OrderStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderSide { Buy, Sell }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderType { Market, Limit }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus { Pending, Filled, Cancelled, Rejected }

/// Greeks
#[derive(Debug, Clone)]
pub struct Greeks {
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64,
    pub vega: f64,
    pub rho: f64,
}

/// Pricing engine
pub struct OptionsEngine {
    contracts: HashMap<String, OptionContract>,
    positions: HashMap<String, HashMap<String, OptionsPosition>>,
    orders: HashMap<String, OptionsOrder>,
}

impl OptionsEngine {
    pub fn new() -> Self {
        OptionsEngine {
            contracts: HashMap::new(),
            positions: HashMap::new(),
            orders: HashMap::new(),
        }
    }
    
    /// Calculate Black-Scholes price
    pub fn black_scholes(
        &self,
        spot: f64,
        strike: f64,
        time_to_expiry: f64,
        rate: f64,
        volatility: f64,
        option_type: OptionType,
    ) -> f64 {
        if time_to_expiry <= 0.0 {
            return if option_type == OptionType::Call {
                (spot - strike).max(0.0)
            } else {
                (strike - spot).max(0.0)
            };
        }
        
        let d1 = (spot.ln() + (rate + volatility * volatility / 2.0) * time_to_expiry) 
            / (volatility * time_to_expiry.sqrt());
        let d2 = d1 - volatility * time_to_expiry.sqrt();
        
        let nd1 = normal_cdf(d1);
        let nd2 = normal_cdf(d2);
        
        if option_type == OptionType::Call {
            spot * nd1 - strike * (-rate * time_to_expiry).exp() * nd2
        } else {
            strike * (-rate * time_to_expiry).exp() * normal_cdf(-d2) - spot * normal_cdf(-d1)
        }
    }
    
    /// Calculate Greeks
    pub fn calculate_greeks(
        &self,
        spot: f64,
        strike: f64,
        time_to_expiry: f64,
        rate: f64,
        volatility: f64,
        option_type: OptionType,
    ) -> Greeks {
        if time_to_expiry <= 0.0 {
            return Greeks { delta: 0.0, gamma: 0.0, theta: 0.0, vega: 0.0, rho: 0.0 };
        }
        
        let d1 = (spot.ln() + (rate + volatility * volatility / 2.0) * time_to_expiry) 
            / (volatility * time_to_expiry.sqrt());
        let d2 = d1 - volatility * time_to_expiry.sqrt();
        
        let nd1_prime = normal_pdf(d1);
        
        let delta = if option_type == OptionType::Call {
            normal_cdf(d1)
        } else {
            normal_cdf(d1) - 1.0
        };
        
        let gamma = nd1_prime / (spot * volatility * time_to_expiry.sqrt());
        
        let theta = if option_type == OptionType::Call {
            -spot * nd1_prime * volatility / (2.0 * time_to_expiry.sqrt())
                - rate * strike * (-rate * time_to_expiry).exp() * normal_cdf(d2)
        } else {
            -spot * nd1_prime * volatility / (2.0 * time_to_expiry.sqrt())
                + rate * strike * (-rate * time_to_expiry).exp() * normal_cdf(-d2)
        };
        let theta = theta / 365.0;
        
        let vega = spot * time_to_expiry.sqrt() * nd1_prime / 100.0;
        
        let rho = if option_type == OptionType::Call {
            strike * time_to_expiry * (-rate * time_to_expiry).exp() * normal_cdf(d2) / 100.0
        } else {
            -strike * time_to_expiry * (-rate * time_to_expiry).exp() * normal_cdf(-d2) / 100.0
        };
        
        Greeks { delta, gamma, theta, vega, rho }
    }
    
    /// Create order
    pub fn create_order(&mut self, user_id: String, contract: OptionContract, side: OrderSide, size: i64, price: Option<u64>) -> String {
        let order_id = format!("OPT-{}-{}", contract.symbol, self.orders.len());
        let order = OptionsOrder {
            id: order_id.clone(),
            user_id,
            contract,
            side,
            order_type: OrderType::Limit,
            size,
            price,
            premium: None,
            status: OrderStatus::Pending,
            created_at: current_timestamp(),
        };
        self.orders.insert(order_id.clone(), order);
        order_id
    }
}

fn normal_cdf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;
    
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs() / 2.0_f64.sqrt();
    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();
    
    0.5 * (1.0 + sign * y)
}

fn normal_pdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / 2.0_f64.sqrt()
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_black_scholes_call() {
        let engine = OptionsEngine::new();
        let price = engine.black_scholes(100.0, 100.0, 30.0 / 365.0, 0.05, 0.2, OptionType::Call);
        assert!(price > 0.0);
    }
    
    #[test]
    fn test_greeks() {
        let engine = OptionsEngine::new();
        let greeks = engine.calculate_greeks(100.0, 100.0, 30.0 / 365.0, 0.05, 0.2, OptionType::Call);
        assert!(greeks.delta > 0.0);
    }
}