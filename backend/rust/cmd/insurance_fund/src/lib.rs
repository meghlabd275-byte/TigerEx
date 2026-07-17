//! Insurance Fund - Rust (covers bankruptcies)
use std::sync::RwLock;
pub struct InsuranceFund { balance: RwLock<f64>, reserves: RwLock<f64> }
impl InsuranceFund {
    pub fn new() -> Self { Self { balance: RwLock::new(0.0), reserves: RwLock::new(0.0) } }
    pub fn add(&self, amount: f64) { *self.balance.write().unwrap() += amount; }
    pub fn cover(&self, amount: f64) -> bool {
        let bal = *self.balance.read().unwrap();
        if bal >= amount { *self.balance.write().unwrap() -= amount; true } else { false }
    }
    pub fn balance(&self) -> f64 { *self.balance.read().unwrap() }
}
impl Default for InsuranceFund { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_insurance() { let f = InsuranceFund::new(); f.add(1000.0); assert_eq!(f.balance(), 1000.0); } }