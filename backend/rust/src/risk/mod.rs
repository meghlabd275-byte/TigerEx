//! Risk Engine - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_position: f64,
    pub max_leverage: f64,
    pub max_daily_loss: f64,
}

pub struct RiskEngine { limits: RiskLimits }

impl RiskEngine {
    pub fn new() -> Self {
        Self { limits: RiskLimits { max_position: 10_000_000.0, max_leverage: 125.0, max_daily_loss: 1_000_000.0 } }
    }
    pub fn check_position(&self, value: f64) -> Result<(), String> {
        if value > self.limits.max_position { Err("Position limit exceeded".into()) } else { Ok(()) }
    }
    pub fn check_leverage(&self, lev: f64) -> Result<(), String> {
        if lev > self.limits.max_leverage { Err("Leverage limit exceeded".into()) } else { Ok(()) }
    }
    pub fn check_daily_loss(&self, loss: f64) -> Result<(), String> {
        if loss > self.limits.max_daily_loss { Err("Daily loss limit exceeded".into()) } else { Ok(()) }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let r = RiskEngine::new(); assert!(r.check_position(1000.0).is_ok()); } }
