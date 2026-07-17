//! US Treasury Tokenized - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct TreasuryBond { pub maturity: u32, pub yield_rate: f64, pub face_value: f64 }
pub struct USTreasuryTokenService { bonds: RwLock<HashMap<String, TreasuryBond>>> }
impl USTreasuryTokenService {
    pub fn new() -> Self { Self { bonds: RwLock::new(HashMap::new()) } }
    pub fn mint(&self, maturity: u32, face_value: f64) -> String { let id = format!("tsy{}", maturity); let yield_rate = match maturity { 2=>0.045, 5=>0.048, 10=>0.050,_=>0.052 }; self.bonds.write().unwrap().insert(id.clone(), TreasuryBond { maturity, yield_rate, face_value }); id }
    pub fn yield_of(&self, bond_id: &str) -> f64 { self.bonds.read().unwrap().get(bond_id).map(|b| b.yield_rate).unwrap_or(0.0) }
}
impl Default for USTreasuryTokenService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = USTreasuryTokenService::new(); } }