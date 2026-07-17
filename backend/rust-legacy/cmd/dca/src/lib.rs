//! DCA Service - Rust (Dollar Cost Averaging)
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct DCAPosition { pub id: String, pub asset: String, pub amount: f64, pub intervals: u32, pub purchased: u32 }
pub struct DCAService { positions: RwLock<HashMap<String, DCAPosition>> }
impl DCAService {
    pub fn new() -> Self { Self { positions: RwLock::new(HashMap::new()) } }
    pub fn start(&self, user_id: &str, asset: &str, amount: f64, intervals: u32) -> String { let id = format!("dca_{}", intervals); self.positions.write().unwrap().insert(id.clone(), DCAPosition { id: id.clone(), asset: asset.to_string(), amount, intervals, purchased: 0 }); id }
    pub fn execute_step(&self, pos_id: &str) -> Result<(), String> { if let Some(p) = self.positions.write().unwrap().get_mut(pos_id) { p.purchased += 1; Ok(()) } else { Err("Not found".to_string()) } }
}
impl Default for DCAService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = DCAService::new(); } }