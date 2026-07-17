//! Bond Market - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Bond { pub issuer: String, pub coupon: f64, pub maturity: u32, pub price: f64 }
pub struct BondMarketService { bonds: RwLock<HashMap<String, Bond>> }
impl BondMarketService {
    pub fn new() -> Self { Self { bonds: RwLock::new(HashMap::new()) } }
    pub fn issue(&self, issuer: &str, coupon: f64, maturity: u32) -> String { let id = format!("bond_{}", issuer); self.bonds.write().unwrap().insert(id.clone(), Bond{issuer:issuer.to_string(),coupon,maturity,price:100.0}); id }
    pub fn quote(&self, bond_id: &str) -> f64 { self.bonds.read().unwrap().get(bond_id).map(|b| b.price).unwrap_or(0.0) }
}
impl Default for BondMarketService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = BondMarketService::new(); } }