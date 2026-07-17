//! TigerEx Futures Trading Service - Rust

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Futures contract
#[derive(Debug, Clone)]
pub struct Contract {
    pub symbol: String,
    pub underlying: String,
    pub expiry: u64,
    pub contract_size: f64,
    pub max_leverage: u32,
}

/// Futures position
#[derive(Debug, Clone)]
pub struct FuturesPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub entry_price: f64,
    pub leverage: u32,
    pub unrealized_pnl: f64,
}

/// Futures service
pub struct FuturesService {
    contracts: RwLock<Vec<Contract>>,
    positions: RwLock<HashMap<String, FuturesPosition>>,
}

impl FuturesService {
    pub fn new() -> Self {
        let svc = Self { contracts: RwLock::new(Vec::new()), positions: RwLock::new(HashMap::new()) };
        svc.contracts.write().unwrap().push(Contract { symbol: "BTC-PERP".to_string(), underlying: "BTC".to_string(), expiry: 0, contract_size: 100.0, max_leverage: 125 });
        svc
    }

    pub fn open_position(&self, user_id: &str, symbol: &str, side: &str, size: f64, entry_price: f64, leverage: u32) -> Result<FuturesPosition, String> {
        let contracts = self.contracts.read().unwrap();
        let contract = contracts.iter().find(|c| c.symbol == symbol).ok_or("Contract not found")?;
        if leverage > contract.max_leverage { return Err("Leverage too high".to_string()); }
        
        let position = FuturesPosition { id: generate_id(), user_id: user_id.to_string(), symbol: symbol.to_string(), side: side.to_string(), size, entry_price, leverage, unrealized_pnl: 0.0 };
        let id = position.id.clone();
        self.positions.write().unwrap().insert(id, position.clone());
        Ok(position)
    }

    pub fn close_position(&self, position_id: &str) -> Result<f64, String> {
        let mut positions = self.positions.write().unwrap();
        if let Some(p) = positions.remove(position_id) { Ok(p.unrealized_pnl) } else { Err("Position not found".to_string()) }
    }

    pub fn update_prices(&self, symbol: &str, current_price: f64) {
        let mut positions = self.positions.write().unwrap();
        for p in positions.values_mut() { if p.symbol == symbol {
            p.unrealized_pnl = if p.side == "long" { (current_price - p.entry_price) * p.size } else { (p.entry_price - current_price) * p.size };
        }}
    }
}

impl Default for FuturesService { fn default() -> Self { Self::new() } }

fn generate_id() -> String { format!("fut_{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()) }

#[cfg(test)] mod tests { use super::*; #[test] fn test_open() { let s = FuturesService::new(); } }