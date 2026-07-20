//! Margin Trading - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)]
pub struct MarginPos { pub id: String, pub user_id: String, pub asset: String, pub side: String, pub size: f64, pub leverage: u32, pub entry: f64 }
pub struct MarginTradingService { positions: RwLock<HashMap<String, MarginPos>>, max_leverage: u32 }
impl MarginTradingService {
    pub fn new() -> Self { Self { positions: RwLock::new(HashMap::new()), max_leverage: 10 } }
    pub fn open(&self, user_id: &str, asset: &str, side: &str, size: f64, leverage: u32, entry: f64) -> Result<String, String> {
        if leverage > self.max_leverage { return Err("Too much leverage".to_string()); }
        let id = format!("mt_{}", self.positions.read().unwrap().len());
        self.positions.write().unwrap().insert(id.clone(), MarginPos { id: id.clone(), user_id: user_id.to_string(), asset: asset.to_string(), side: side.to_string(), size, leverage, entry });
        Ok(id)
    }
    pub fn close(&self, pos_id: &str, exit: f64) -> Result<f64, String> {
        let mut positions = self.positions.write().unwrap();
        if let Some(p) = positions.remove(pos_id) { let pnl = if p.side == "long" { (exit - p.entry) * p.size } else { (p.entry - exit) * p.size }; Ok(pnl) } else { Err("Position not found".to_string()) }
    }
}
impl Default for MarginTradingService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_margin() { let s = MarginTradingService::new(); } }