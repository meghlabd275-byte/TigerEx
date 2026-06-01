// Derivatives Pricing - Money Path in Rust
// Options and futures pricing

use std::collections::HashMap;
use std::sync::RwLock;

/// Option type
#[derive(Debug, Clone, Copy)]
pub enum OptionType { Call, Put }

/// Option style
#[derive(Debug, Clone, Copy)]
pub enum OptionStyle { European, American }

/// Option contract
#[derive(Debug, Clone)]
pub struct OptionContract {
    pub id: String,
    pub underlying: String,
    pub strike: f64,
    pub expiry: u64,
    pub option_type: OptionType,
    pub style: OptionStyle,
    pub premium: f64,
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64,
    pub vega: f64,
}

/// Greeks calculator
pub struct GreeksCalculator;

impl GreeksCalculator {
    /// Black-Scholes call/put price
    pub fn black_scholes(S: f64, K: f64, T: f64, r: f64, sigma: f64, opt_type: OptionType) -> (f64, f64) {
        // d1 and d2
        let d1 = (S.ln() + (r + sigma * sigma / 2.0) * T) / (sigma * T.sqrt());
        let d2 = d1 - sigma * T.sqrt();
        
        let (price, delta) = match opt_type {
            OptionType::Call => {
                let nd1 = normal_cdf(d1);
                let nd2 = normal_cdf(d2);
                let price = S * nd1 - K * (-r * T).exp() * nd2;
                let delta = nd1;
                (price, delta)
            },
            OptionType::Put => {
                let nd1 = normal_cdf(-d1);
                let nd2 = normal_cdf(-d2);
                let price = K * (-r * T).exp() * nd2 - S * nd1;
                let delta = nd1 - 1.0;
                (price, delta)
            },
        };
        
        (price, delta)
    }
    
    /// Calculate gamma
    pub fn gamma(S: f64, K: f64, T: f64, r: f64, sigma: f64) -> f64 {
        let d1 = (S.ln() + (r + sigma * sigma / 2.0) * T) / (sigma * T.sqrt());
        let nd1_prime = normal_pdf(d1);
        nd1_prime * S / (sigma * T.sqrt())
    }
    
    /// Calculate theta
    pub fn theta(S: f64, K: f64, T: f64, r: f64, sigma: f64, opt_type: OptionType) -> f64 {
        let d1 = (S.ln() + (r + sigma * sigma / 2.0) * T) / (sigma * T.sqrt());
        let d2 = d1 - sigma * T.sqrt();
        let nd1_prime = normal_pdf(d1);
        
        let theta = match opt_type {
            OptionType::Call => {
                -(S * sigma * nd1_prime) / (2.0 * T.sqrt()) - r * K * (-r * T).exp() * normal_cdf(d2)
            },
            OptionType::Put => {
                -(S * sigma * nd1_prime) / (2.0 * T.sqrt()) + r * K * (-r * T).exp() * normal_cdf(-d2)
            },
        };
        
        theta / 365.0 // Daily theta
    }
    
    /// Calculate vega
    pub fn vega(S: f64, K: f64, T: f64, r: f64, sigma: f64) -> f64 {
        let d1 = (S.ln() + (r + sigma * sigma / 2.0) * T) / (sigma * T.sqrt());
        let nd1_prime = normal_pdf(d1);
        S * T.sqrt() * nd1_prime / 100.0 // Per 1% vol change
    }
}

/// Normal CDF
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

/// Normal PDF
fn normal_pdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / (2.0_f64 * std::f64::consts::PI).sqrt()
}

/// Futures contract
#[derive(Debug, Clone)]
pub struct FuturesContract {
    pub id: String,
    pub underlying: String,
    pub expiry: u64,
    pub price: f64,
    pub funding_rate: f64,
    pub index_price: f64,
}

/// Pricing Service
pub struct PricingService {
    options: RwLock<HashMap<String, OptionContract>>,
    futures: RwLock<HashMap<String, FuturesContract>>,
    volatility: RwLock<HashMap<String, f64>>, // implied vol by symbol
}

impl PricingService {
    pub fn new() -> Self {
        PricingService {
            options: RwLock::new(HashMap::new()),
            futures: RwLock::new(HashMap::new()),
            volatility: RwLock::new(HashMap::new()),
        }
    }
    
    /// Price option
    pub fn price_option(&self, underlying: &str, strike: f64, T: f64, r: f64, opt_type: OptionType) -> f64 {
        // Get or default vol
        let sigma = self.volatility.read().unwrap()
            .get(underlying)
            .copied()
            .unwrap_or(0.50); // 50% default
        
        let (price, _) = GreeksCalculator::black_scholes(50000.0, strike, T, r, sigma, opt_type);
        price
    }
    
    /// Price futures
    pub fn price_futures(&self, underlying: &str, index_price: f64, T: f64, funding_rate: f64) -> f64 {
        let rate = funding_rate / 100.0;
        index_price * (1.0 + rate * T / 365.0)
    }
    
    /// Update IV
    pub fn update_volatility(&self, symbol: &str, iv: f64) {
        self.volatility.write().unwrap().insert(symbol.to_string(), iv);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_greeks() {
        let (price, delta) = GreeksCalculator::black_scholes(50000.0, 50000.0, 30.0/365.0, 0.05, 0.50, OptionType::Call);
        assert!(price > 0.0);
    }
}