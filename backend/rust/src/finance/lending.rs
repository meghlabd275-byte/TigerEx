// Lending - Supply & Borrow in Rust
// Financial calculations with memory safety

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct LendingPool {
    pub asset: String,
    pub total_supplied: f64,
    pub total_borrowed: f64,
    pub supply_rate: f64,
    pub borrow_rate: f64,
    pub utilization: f64,
    pub collateral_factor: f64,
    pub liquidation_threshold: f64,
    pub active_suppliers: u32,
    pub active_borrowers: u32,
}

impl LendingPool {
    pub fn new(asset: &str, supply_rate: f64, collateral_factor: f64) -> Self {
        LendingPool {
            asset: asset.to_string(),
            total_supplied: 0.0,
            total_borrowed: 0.0,
            supply_rate,
            borrow_rate: supply_rate * 2.0,
            utilization: 0.0,
            collateral_factor,
            liquidation_threshold: 0.8,
            active_suppliers: 0,
            active_borrowers: 0,
        }
    }
    
    pub fn update_utilization(&mut self) {
        if self.total_supplied > 0.0 {
            self.utilization = self.total_borrowed / self.total_supplied;
        }
    }
    
    pub fn can_borrow(&self, amount: f64) -> bool {
        self.total_supplied - self.total_borrowed >= amount
    }
}

#[derive(Debug, Clone)]
pub struct Loan {
    pub id: String,
    pub borrower_id: String,
    pub asset: String,
    pub amount: f64,
    pub collateral_asset: String,
    pub collateral_amount: f64,
    pub start_time: u64,
    pub interest_accrued: f64,
    pub status: LoanStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoanStatus {
    Active,
    Repaying,
    Liquidated,
    Closed,
}

impl Loan {
    pub fn new(borrower_id: &str, asset: &str, amount: f64, collateral_asset: &str, collateral_amount: f64) -> Self {
        Loan {
            id: format!("loan_{}_{}_{}", borrower_id, asset, timestamp_ms()),
            borrower_id: borrower_id.to_string(),
            asset: asset.to_string(),
            amount,
            collateral_asset: collateral_asset.to_string(),
            collateral_amount,
            start_time: timestamp_ms(),
            interest_accrued: 0.0,
            status: LoanStatus::Active,
        }
    }
    
    pub fn is_under_collateralized(&self, threshold: f64) -> bool {
        if self.collateral_amount == 0.0 { return true; }
        let ltv = self.amount / self.collateral_amount;
        ltv > threshold
    }
}

#[derive(Debug, Clone)]
pub struct MarginPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub amount: f64,
    pub leverage: f64,
    pub entry_price: f64,
    pub current_price: f64,
    pub unrealized_pnl: f64,
    pub status: PositionStatus,
    pub opened_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionSide { Long, Short }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus { Open, Closing, Closed, Liquidated }

impl MarginPosition {
    pub fn new(user_id: &str, symbol: &str, side: PositionSide, amount: f64, leverage: f64, entry_price: f64) -> Self {
        MarginPosition {
            id: format!("margin_{}_{}_{}", user_id, symbol, timestamp_ms()),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            amount,
            leverage,
            entry_price,
            current_price: entry_price,
            unrealized_pnl: 0.0,
            status: PositionStatus::Open,
            opened_at: timestamp_ms(),
        }
    }
    
    pub fn update_price(&mut self, current_price: f64) {
        self.current_price = current_price;
        let diff = match self.side {
            PositionSide::Long => current_price - self.entry_price,
            PositionSide::Short => self.entry_price - current_price,
        };
        self.unrealized_pnl = diff * self.amount * self.leverage;
    }
    
    pub fn should_liquidate(&self, maintenance: f64) -> bool {
        let loss = -self.unrealized_pnl / (self.amount * self.leverage);
        loss > maintenance
    }
}

pub struct LendingService {
    pools: HashMap<String, LendingPool>,
    loans: HashMap<String, Loan>,
    positions: HashMap<String, MarginPosition>,
}

impl LendingService {
    pub fn new() -> Self {
        let mut svc = LendingService {
            pools: HashMap::new(),
            loans: HashMap::new(),
            positions: HashMap::new(),
        };
        svc.pools.insert("USDT".to_string(), LendingPool::new("USDT", 0.05, 0.90));
        svc.pools.insert("BTC".to_string(), LendingPool::new("BTC", 0.02, 0.70));
        svc.pools.insert("ETH".to_string(), LendingPool::new("ETH", 0.03, 0.80));
        svc
    }
    
    pub fn supply(&mut self, _user_id: &str, asset: &str, amount: f64) -> Result<(), String> {
        let pool = self.pools.get_mut(asset).ok_or("asset not found")?;
        pool.total_supplied += amount;
        pool.active_suppliers += 1;
        pool.update_utilization();
        Ok(())
    }
    
    pub fn borrow(&mut self, borrower_id: &str, asset: &str, amount: f64, collateral_asset: &str, collateral_amount: f64) -> Result<String, String> {
        let pool = self.pools.get_mut(asset).ok_or("asset not found")?;
        
        let max_borrow = collateral_amount * pool.collateral_factor;
        if amount > max_borrow { return Err("insufficient collateral".to_string()); }
        if !pool.can_borrow(amount) { return Err("insufficient liquidity".to_string()); }
        
        let loan = Loan::new(borrower_id, asset, amount, collateral_asset, collateral_amount);
        let loan_id = loan.id.clone();
        
        pool.total_borrowed += amount;
        pool.active_borrowers += 1;
        pool.update_utilization();
        
        self.loans.insert(loan_id.clone(), loan);
        Ok(loan_id)
    }
    
    pub fn open_margin(&mut self, user_id: &str, symbol: &str, side: PositionSide, amount: f64, leverage: f64, entry_price: f64) -> Result<String, String> {
        if leverage > 10.0 { return Err("max leverage 10x".to_string()); }
        let pos = MarginPosition::new(user_id, symbol, side, amount, leverage, entry_price);
        let pos_id = pos.id.clone();
        self.positions.insert(pos_id.clone(), pos);
        Ok(pos_id)
    }
    
    pub fn close_margin(&mut self, pos_id: &str) -> Result<f64, String> {
        let pos = self.positions.get_mut(pos_id).ok_or("position not found")?;
        let pnl = pos.unrealized_pnl;
        pos.status = PositionStatus::Closed;
        Ok(pnl)
    }
    
    pub fn get_pool(&self, asset: &str) -> Option<&LendingPool> {
        self.pools.get(asset)
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_supply() {
        let mut svc = LendingService::new();
        svc.supply("user1", "USDT", 1000.0).unwrap();
        assert!(svc.get_pool("USDT").is_some());
    }
}