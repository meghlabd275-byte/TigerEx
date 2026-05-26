//! Derivatives - Rust Implementation
//! Perpetual futures, options

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerpPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub size: f64,
    pub entry_px: f64,
    pub liq_px: f64,
    pub leverage: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side { Long, Short }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionContract {
    pub id: String,
    pub underlying: String,
    pub strike: f64,
    pub expiry: i64,
    pub option_type: OptType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptType { Call, Put }

pub struct DerivativesService {
    positions: HashMap<String, PerpPosition>,
    options: HashMap<String, OptionContract>,
}

impl DerivativesService {
    pub fn new() -> Self { Self { positions: HashMap::new(), options: HashMap::new() } }
    
    pub fn open_perp(&mut self, uid: &str, sym: &str, side: Side, size: f64, px: f64, lev: f64) -> String {
        let liq = match side { Side::Long => px * (1.0 - 1.0/lev + 0.005), Side::Short => px * (1.0 + 1.0/lev - 0.005) };
        let pos = PerpPosition { id: format!("PERP_{}", self.positions.len()), user_id: uid.to_string(), symbol: sym.to_string(), side, size, entry_px: px, liq_px: liq, leverage: lev };
        self.positions.insert(pos.id.clone(), pos);
        pos.id
    }
    
    pub fn check_liq(&self, pos_id: &str, cur_px: f64) -> bool {
        let p = match self.positions.get(pos_id) { Some(x) => x, None => return false };
        match p.side { Side::Long => cur_px <= p.liq_px, Side::Short => cur_px >= p.liq_px }
    }
    
    pub fn create_option(&mut self, und: &str, strike: f64, opt: OptType) -> String {
        let id = format!("OPT_{}_{}_{}", und, strike as i64, match opt { OptType::Call => "C", OptType::Put => "P" });
        self.options.insert(id.clone(), OptionContract { id: id.clone(), underlying: und.to_string(), strike, expiry: 0, option_type: opt });
        id
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_perp() { let mut s = DerivativesService::new(); let id = s.open_perp("user1", "BTC", Side::Long, 1.0, 50000.0, 10.0); assert!(!id.is_empty()); } }