//! Grid Trading - Rust (automated price grids)
use std::collections::VecDeque;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Grid { pub id: String, pub symbol: String, pub lower: f64, pub upper: f64, pub levels: u32 }
pub struct GridTradingService { grids: RwLock<Vec<Grid>>, active: RwLock<Vec<String>> }
impl GridTradingService {
    pub fn new() -> Self { Self { grids: RwLock::new(Vec::new()), active: RwLock::new(Vec::new()) } }
    pub fn create_grid(&self, symbol: &str, lower: f64, upper: f64, levels: u32) -> String { let id = format!("grid_{}", symbol); self.grids.write().unwrap().push(Grid { id: id.clone(), symbol: symbol.to_string(), lower, upper, levels }); id }
    pub fn start_grid(&self, grid_id: &str) { self.active.write().unwrap().push(grid_id.to_string()); }
    pub fn stop_grid(&self, grid_id: &str) { self.active.write().unwrap().retain(|g| g != grid_id); }
}
impl Default for GridTradingService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_grid() { let g = GridTradingService::new(); } }