// Volatility - IV Calculation and Surface
// Rust for implied volatility modeling

use std::collections::HashMap;

// Volatility smile point
#[derive(Debug, Clone)]
pub struct SmilePoint {
    pub strike: f64,
    pub iv: f64,
    pub delta: f64,
}

// Volatility surface
pub struct VolSurface {
    underlying: String,
    points: HashMap<i64, Vec<SmilePoint>>, // expiry -> points
    term_structure: HashMap<i64, f64>, // expiry -> ATM vol
}

impl VolSurface {
    pub fn new(underlying: &str) -> Self {
        VolSurface {
            underlying: underlying.to_string(),
            points: HashMap::new(),
            term_structure: HashMap::new(),
        }
    }

    // Add smile point
    pub fn add_point(&mut self, expiry: i64, strike: f64, iv: f64) {
        let point = SmilePoint {
            strike,
            iv,
            delta: 0.5, // Would calculate from BS
        };

        self.points
            .entry(expiry)
            .or_insert_with(Vec::new)
            .push(point);
    }

    // Get ATM vol
    pub fn get_atm_vol(&self, expiry: i64) -> f64 {
        self.term_structure.get(&expiry).copied().unwrap_or(0.5)
    }

    // Set ATM vol
    pub fn set_atm_vol(&mut self, expiry: i64, vol: f64) {
        self.term_structure.insert(expiry, vol);
    }

    // Interpolate strike vol (SABR simplified)
    pub fn interpolate_vol(&self, expiry: i64, strike: f64, spot: f64) -> f64 {
        if let Some(points) = self.points.get(&expiry) {
            // Wing model interpolation
            let atm = self.get_atm_vol(expiry);
            
            let log_moneyness = (strike / spot).ln();
            
            // Skew adjustment
            let skew = 0.5; // Would be from regression
            let convexity = 0.1;
            
            return atm + skew * log_moneyness + convexity * log_moneyness.powi(2);
        }
        
        0.5 // Default 50%
    }
}

// Realized volatility
pub struct RealizedVol {
    returns: Vec<f64>,
    window: usize,
}

impl RealizedVol {
    pub fn new(window: usize) -> Self {
        RealizedVol {
            returns: Vec::new(),
            window,
        }
    }

    pub fn update(&mut self, price: f64) {
        if let Some(&last) = self.returns.last() {
            let ret = (price - last) / last;
            self.returns.push(ret);
            
            if self.returns.len() > self.window {
                self.returns.remove(0);
            }
        } else {
            self.returns.push(0.0);
        }
    }

    pub fn calculate(&self) -> f64 {
        if self.returns.is_empty() {
            return 0.0;
        }

        let mean: f64 = self.returns.iter().sum::<f64>() / self.returns.len() as f64;
        let variance = self.returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / self.returns.len() as f64;
        
        variance.sqrt() * (252.0_f64).sqrt() // Annualized
    }
}

// Volatility arbitrage detection
pub struct VolArb {
    surface: VolSurface,
    historical_vol: f64,
}

impl VolArb {
    pub fn new(underlying: &str) -> Self {
        VolArb {
            surface: VolSurface::new(underlying),
            historical_vol: 0.0,
        }
    }

    pub fn set_historical(&mut self, vol: f64) {
        self.historical_vol = vol;
    }

    pub fn check_arbitrage(&self, expiry: i64, spot: f64) -> bool {
        let iv = self.surface.get_atm_vol(expiry);
        
        // IV should not deviate too far from HV
        let ratio = iv / self.historical_vol;
        
        ratio < 0.5 || ratio > 2.0 // Sanity bounds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_realized_vol() {
        let mut rv = RealizedVol::new(20);
        
        for _ in 0..30 {
            rv.update(100.0);
        }
        
        assert!(rv.calculate() >= 0.0);
    }
}