// Lending Pool - Money Path in Rust
// Lending and borrowing for margin trading

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Asset pool
#[derive(Debug, Clone)]
pub struct AssetPool {
    pub asset: String,
    pub total_supplied: f64,
    pub total_borrowed: f64,
    pub supply_rate: f64,
    pub borrow_rate: f64,
    pub collateral_factor: f64,
    pub liquidation_threshold: f64,
}

impl AssetPool {
    pub fn new(asset: &str, supply_rate: f64, collateral_factor: f64) -> Self {
        AssetPool {
            asset: asset.to_string(),
            total_supplied: 0.0,
            total_borrowed: 0.0,
            supply_rate,
            borrow_rate: supply_rate * 2.0,
            collateral_factor,
            liquidation_threshold: 0.8,
        }
    }
    
    pub fn utilization(&self) -> f64 {
        if self.total_supplied > 0.0 { self.total_borrowed / self.total_supplied } else { 0.0 }
    }
}

/// Borrow position
#[derive(Debug, Clone)]
pub struct BorrowPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub collateral_asset: String,
    pub collateral_amount: f64,
    pub interest_accrued: f64,
    pub status: PositionStatus,
}

#[derive(Debug, Clone, Copy)]
pub enum PositionStatus { Active, Repaying, Liquidated, Closed }

/// Supply position
#[derive(Debug, Clone)]
pub struct SupplyPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub accrued_interest: f64,
}

/// Lending Pool Service
pub struct LendingPoolService {
    pools: RwLock<HashMap<String, AssetPool>>,
    borrows: RwLock<HashMap<String, BorrowPosition>>,
    supplies: RwLock<HashMap<String, SupplyPosition>>,
}

impl LendingPoolService {
    pub fn new() -> Self {
        let svc = LendingPoolService {
            pools: RwLock::new(HashMap::new()),
            borrows: RwLock::new(HashMap::new()),
            supplies: RwLock::new(HashMap::new()),
        };
        svc.init_pools();
        svc
    }
    
    fn init_pools(&self) {
        let mut p = self.pools.write().unwrap();
        p.insert("USDT".to_string(), AssetPool::new("USDT", 0.05, 0.90));
        p.insert("BTC".to_string(), AssetPool::new("BTC", 0.02, 0.70));
        p.insert("ETH".to_string(), AssetPool::new("ETH", 0.03, 0.80));
    }
    
    /// Supply asset
    pub fn supply(&self, user_id: &str, asset: &str, amount: f64) -> Result<String, String> {
        if amount <= 0.0 { return Err("invalid amount".to_string()); }
        
        let mut pools = self.pools.write().unwrap();
        let pool = pools.get_mut(asset).ok_or("asset not found")?;
        pool.total_supplied += amount;
        
        let id = format!("supply_{}_{}", user_id, ts());
        let pos = SupplyPosition {
            id: id.clone(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            accrued_interest: 0.0,
        };
        
        self.supplies.write().unwrap().insert(id.clone(), pos);
        Ok(id)
    }
    
    /// Borrow against collateral
    pub fn borrow(&self, user_id: &str, asset: &str, amount: f64, coll_asset: &str, coll_amount: f64) -> Result<String, String> {
        if amount <= 0.0 { return Err("invalid amount".to_string()); }
        
        let mut pools = self.pools.write().unwrap();
        let pool = pools.get_mut(asset).ok_or("asset not found")?;
        
        let max_borrow = coll_amount * pool.collateral_factor;
        if amount > max_borrow { return Err("insufficient collateral".to_string()); }
        
        let available = pool.total_supplied - pool.total_borrowed;
        if amount > available { return Err("insufficient liquidity".to_string()); }
        
        pool.total_borrowed += amount;
        
        let id = format!("borrow_{}_{}", user_id, ts());
        let pos = BorrowPosition {
            id: id.clone(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            collateral_asset: coll_asset.to_string(),
            collateral_amount: coll_amount,
            interest_accrued: 0.0,
            status: PositionStatus::Active,
        };
        
        self.borrows.write().unwrap().insert(id.clone(), pos);
        Ok(id)
    }
    
    /// Check liquidations
    pub fn check_liquidations(&self) -> Vec<String> {
        let mut borrows = self.borrows.write().unwrap();
        let mut liquidations = Vec::new();
        
        for (id, pos) in borrows.iter_mut() {
            if pos.status != PositionStatus::Active { continue; }
            if pos.collateral_amount > 0.0 {
                let ltv = pos.amount / pos.collateral_amount;
                if ltv > 0.8 {
                    pos.status = PositionStatus::Liquidated;
                    liquidations.push(id.clone());
                }
            }
        }
        
        liquidations
    }
    
    pub fn get_pool(&self, asset: &str) -> Option<AssetPool> {
        self.pools.read().unwrap().get(asset).cloned()
    }
}

fn ts() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_pool() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 1000.0).unwrap();
        let r = svc.borrow("u2", "USDT", 500.0, "BTC", 1.0);
        assert!(r.is_ok());
    }
}