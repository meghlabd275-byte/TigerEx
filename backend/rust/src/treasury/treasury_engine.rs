// Treasury Engine - Critical Money Path in Rust
// Manages reserves, liquidity, and capital

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Reserve type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveType {
    Operational,
    Risk,
    Insurance,
    ColdStorage,
}

/// Reserve fund
#[derive(Debug, Clone)]
pub struct Reserve {
    pub id: String,
    pub name: String,
    pub reserve_type: ReserveType,
    pub asset: String,
    pub balance: f64,
    pub target_ratio: f64,    // Target % of total
    pub min_ratio: f64,       // Minimum % required
    pub max_ratio: f64,       // Maximum % allowed
    pub updated_at: u64,
}

/// Liquidity pool
#[derive(Debug, Clone)]
pub struct LiquidityPool {
    pub id: String,
    pub asset: String,
    pub balance: f64,
    pub available: f64,
    pub locked: f64,
    pub utilization_rate: f64,
    pub updated_at: u64,
}

/// Treasury operation
#[derive(Debug, Clone)]
pub struct TreasuryOperation {
    pub id: String,
    pub operation_type: TreasuryOperationType,
    pub asset: String,
    pub amount: f64,
    pub from_reserve: Option<String>,
    pub to_reserve: Option<String>,
    pub status: TreasuryStatus,
    pub created_at: u64,
    pub executed_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreasuryOperationType {
    Deposit,
    Withdrawal,
    Transfer,
    Rebalance,
    TopUp,
    WithdrawExcess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreasuryStatus {
    Pending,
    Approved,
    Executed,
    Failed,
}

/// Treasury Engine
pub struct TreasuryEngine {
    // Reserves by type
    reserves: RwLock<HashMap<String, Reserve>>,
    
    // Liquidity pools
    pools: RwLock<HashMap<String, LiquidityPool>>,
    
    // Operations
    operations: RwLock<Vec<TreasuryOperation>>,
    
    // Total assets under management
    total_assets: RwLock<f64>,
    
    // Configuration
    min_operational_reserve_ratio: f64,
    risk_reserve_ratio: f64,
    insurance_reserve_ratio: f64,
}

impl TreasuryEngine {
    pub fn new() -> Self {
        TreasuryEngine {
            reserves: RwLock::new(HashMap::new()),
            pools: RwLock::new(HashMap::new()),
            operations: RwLock::new(Vec::new()),
            total_assets: RwLock::new(0.0),
            min_operational_reserve_ratio: 0.10, // 10%
            risk_reserve_ratio: 0.05,             // 5%
            insurance_reserve_ratio: 0.05,         // 5%
        }
    }
    
    /// Initialize default reserves
    pub fn init_reserves(&self, assets: Vec<(&str, &str, f64)>) {
        let mut reserves = self.reserves.write().unwrap();
        
        for (asset, name, balance) in assets {
            reserves.insert(asset.to_string(), Reserve {
                id: format!("reserve_{}", asset),
                name: name.to_string(),
                reserve_type: ReserveType::Operational,
                asset: asset.to_string(),
                balance,
                target_ratio: 0.10,
                min_ratio: 0.05,
                max_ratio: 0.20,
                updated_at: timestamp_ms(),
            });
        }
    }
    
    /// Get reserve balance
    pub fn get_reserve(&self, asset: &str) -> Option<Reserve> {
        self.reserves.read().unwrap().get(asset).cloned()
    }
    
    /// Get all reserves
    pub fn get_all_reserves(&self) -> Vec<Reserve> {
        self.reserves.read().unwrap().values().cloned().collect()
    }
    
    /// Check reserve adequacy
    pub fn check_reserve_adequacy(&self) -> ReserveAdequacyResult {
        let reserves = self.reserves.read().unwrap();
        let total = *self.total_assets.read().unwrap();
        
        let mut result = ReserveAdequacyResult {
            total_assets: total,
            reserves: Vec::new(),
            overall_status: ReserveStatus::Adequate,
        };
        
        for reserve in reserves.values() {
            let actual_ratio = if total > 0.0 { reserve.balance / total } else { 0.0 };
            
            let status = if actual_ratio < reserve.min_ratio {
                ReserveStatus::Critical
            } else if actual_ratio < reserve.target_ratio {
                ReserveStatus::Warning
            } else {
                ReserveStatus::Adequate
            };
            
            result.reserves.push(ReserveStatusDetail {
                asset: reserve.asset.clone(),
                balance: reserve.balance,
                actual_ratio,
                target_ratio: reserve.target_ratio,
                min_ratio: reserve.min_ratio,
                status,
            });
            
            if status == ReserveStatus::Critical {
                result.overall_status = ReserveStatus::Critical;
            } else if status == ReserveStatus::Warning && result.overall_status != ReserveStatus::Critical {
                result.overall_status = ReserveStatus::Warning;
            }
        }
        
        result
    }
    
    /// Top up reserve
    pub fn top_up_reserve(&self, asset: &str, amount: f64) -> Result<TreasuryOperation, String> {
        let mut reserves = self.reserves.write().unwrap();
        
        let reserve = reserves.get_mut(asset)
            .ok_or("reserve not found")?;
        
        // Move from operational pool
        reserve.balance += amount;
        reserve.updated_at = timestamp_ms();
        
        // Record operation
        let op = TreasuryOperation {
            id: generate_id("topup"),
            operation_type: TreasuryOperationType::TopUp,
            asset: asset.to_string(),
            amount,
            from_reserve: None,
            to_reserve: Some(asset.to_string()),
            status: TreasuryStatus::Executed,
            created_at: timestamp_ms(),
            executed_at: Some(timestamp_ms()),
        };
        
        self.operations.write().unwrap().push(op.clone());
        
        Ok(op)
    }
    
    /// Withdraw excess from reserve
    pub fn withdraw_excess(&self, asset: &str, amount: f64) -> Result<TreasuryOperation, String> {
        let mut reserves = self.reserves.write().unwrap();
        
        let reserve = reserves.get_mut(asset)
            .ok_or("reserve not found")?;
        
        // Check max ratio
        let total = *self.total_assets.read().unwrap();
        let new_balance = reserve.balance - amount;
        let new_ratio = if total > 0.0 { new_balance / total } else { 0.0 };
        
        if new_ratio < reserve.min_ratio {
            return Err("would breach minimum reserve ratio".to_string());
        }
        
        reserve.balance -= amount;
        reserve.updated_at = timestamp_ms();
        
        let op = TreasuryOperation {
            id: generate_id("wdrex"),
            operation_type: TreasuryOperationType::WithdrawExcess,
            asset: asset.to_string(),
            amount,
            from_reserve: Some(asset.to_string()),
            to_reserve: None,
            status: TreasuryStatus::Executed,
            created_at: timestamp_ms(),
            executed_at: Some(timestamp_ms()),
        };
        
        self.operations.write().unwrap().push(op.clone());
        
        Ok(op)
    }
    
    /// Rebalance reserves
    pub fn rebalance(&self) -> Result<Vec<TreasuryOperation>, String> {
        let adequacy = self.check_reserve_adequacy();
        let mut operations = Vec::new();
        
        for detail in &adequacy.reserves {
            if detail.status == ReserveStatus::Critical || detail.status == ReserveStatus::Warning {
                let needed = (detail.target_ratio - detail.actual_ratio) * adequacy.total_assets;
                if needed > 0.0 {
                    match self.top_up_reserve(&detail.asset, needed) {
                        Ok(op) => operations.push(op),
                        Err(e) => return Err(e),
                    }
                }
            }
        }
        
        Ok(operations)
    }
    
    /// Update total assets (called periodically)
    pub fn update_total_assets(&self, total: f64) {
        *self.total_assets.write().unwrap() = total;
    }
    
    /// Get liquidity pool
    pub fn get_pool(&self, asset: &str) -> Option<LiquidityPool> {
        self.pools.read().unwrap().get(asset).cloned()
    }
    
    /// Add liquidity
    pub fn add_liquidity(&self, asset: &str, amount: f64) -> Result<(), String> {
        let mut pools = self.pools.write().unwrap();
        
        let pool = pools.entry(asset.to_string())
            .or_insert_with(|| LiquidityPool {
                id: format!("pool_{}", asset),
                asset: asset.to_string(),
                balance: 0.0,
                available: 0.0,
                locked: 0.0,
                utilization_rate: 0.0,
                updated_at: timestamp_ms(),
            });
        
        pool.balance += amount;
        pool.available += amount;
        pool.updated_at = timestamp_ms();
        
        Ok(())
    }
}

#[derive(Debug)]
pub struct ReserveAdequacyResult {
    pub total_assets: f64,
    pub reserves: Vec<ReserveStatusDetail>,
    pub overall_status: ReserveStatus,
}

#[derive(Debug)]
pub struct ReserveStatusDetail {
    pub asset: String,
    pub balance: f64,
    pub actual_ratio: f64,
    pub target_ratio: f64,
    pub min_ratio: f64,
    pub status: ReserveStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveStatus {
    Adequate,
    Warning,
    Critical,
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    format!("{}_{}", prefix, timestamp_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_treasury() {
        let treasury = TreasuryEngine::new();
        treasury.init_reserves(vec![("USDT", "Operational", 1_000_000.0)]);
        
        treasury.update_total_assets(10_000_000.0);
        
        let result = treasury.check_reserve_adequacy();
        assert!(result.overall_status != ReserveStatus::Critical);
    }
}