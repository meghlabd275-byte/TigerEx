// Lending - Supply & Borrow in Rust
// Financial calculations with memory safety

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SEQ: AtomicU64 = AtomicU64::new(0);

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
    /// Price of the collateral asset in the account's valuation unit.
    pub collateral_price: f64,
    /// Price of the borrowed asset in the same unit.
    pub borrow_price: f64,
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
    pub fn new(
        borrower_id: &str,
        asset: &str,
        amount: f64,
        collateral_asset: &str,
        collateral_amount: f64,
        collateral_price: f64,
        borrow_price: f64,
    ) -> Self {
        Loan {
            id: format!("loan_{}_{}_{}_{}", borrower_id, asset, timestamp_ms(), SEQ.fetch_add(1, Ordering::Relaxed)),
            borrower_id: borrower_id.to_string(),
            asset: asset.to_string(),
            amount,
            collateral_asset: collateral_asset.to_string(),
            collateral_amount,
            collateral_price,
            borrow_price,
            start_time: timestamp_ms(),
            interest_accrued: 0.0,
            status: LoanStatus::Active,
        }
    }

    /// Loan-to-value: debt value over collateral value, both in the same unit.
    /// A loan with no usable collateral value is treated as under-collateralized.
    pub fn is_under_collateralized(&self, threshold: f64) -> bool {
        let collateral_value = self.collateral_amount * self.collateral_price;
        if collateral_value <= 0.0 {
            return true;
        }
        let debt_value = (self.amount + self.interest_accrued) * self.borrow_price;
        debt_value / collateral_value > threshold
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
            id: format!("margin_{}_{}_{}_{}", user_id, symbol, timestamp_ms(), SEQ.fetch_add(1, Ordering::Relaxed)),
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
        // PnL is the price move times the position quantity. Leverage scales
        // the margin required, not the PnL per unit; multiplying by it here
        // overstated every position's PnL by the leverage factor.
        self.unrealized_pnl = diff * self.amount;
    }

    /// Margin posted for this position: notional divided by leverage.
    pub fn margin(&self) -> f64 {
        if self.leverage <= 0.0 {
            return 0.0;
        }
        self.amount * self.entry_price / self.leverage
    }

    /// True when the loss has eaten through (1 - maintenance) of the margin.
    pub fn should_liquidate(&self, maintenance: f64) -> bool {
        let margin = self.margin();
        if margin <= 0.0 {
            return true;
        }
        let loss_ratio = (-self.unrealized_pnl) / margin;
        loss_ratio > (1.0 - maintenance)
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
        if !amount.is_finite() || amount <= 0.0 {
            return Err("supply amount must be positive and finite".to_string());
        }
        let pool = self.pools.get_mut(asset).ok_or("asset not found")?;
        pool.total_supplied += amount;
        pool.active_suppliers += 1;
        pool.update_utilization();
        Ok(())
    }

    pub fn borrow(
        &mut self,
        borrower_id: &str,
        asset: &str,
        amount: f64,
        collateral_asset: &str,
        collateral_amount: f64,
        collateral_price: f64,
        borrow_price: f64,
    ) -> Result<String, String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("borrow amount must be positive and finite".to_string());
        }
        if !collateral_amount.is_finite() || collateral_amount <= 0.0 {
            return Err("collateral amount must be positive and finite".to_string());
        }
        if !collateral_price.is_finite() || collateral_price <= 0.0 {
            return Err("collateral must be valued with a positive price".to_string());
        }
        if !borrow_price.is_finite() || borrow_price <= 0.0 {
            return Err("borrowed asset must be valued with a positive price".to_string());
        }

        let pool = self.pools.get_mut(asset).ok_or("asset not found")?;

        // Value both legs in the same unit so the LTV is dimensionless.
        let max_borrow_value = collateral_amount * collateral_price * pool.collateral_factor;
        if amount * borrow_price > max_borrow_value {
            return Err("insufficient collateral".to_string());
        }
        if !pool.can_borrow(amount) { return Err("insufficient liquidity".to_string()); }

        let loan = Loan::new(borrower_id, asset, amount, collateral_asset, collateral_amount, collateral_price, borrow_price);
        let loan_id = loan.id.clone();

        pool.total_borrowed += amount;
        pool.active_borrowers += 1;
        pool.update_utilization();

        self.loans.insert(loan_id.clone(), loan);
        Ok(loan_id)
    }

    pub fn open_margin(&mut self, user_id: &str, symbol: &str, side: PositionSide, amount: f64, leverage: f64, entry_price: f64) -> Result<String, String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("position amount must be positive and finite".to_string());
        }
        if !leverage.is_finite() || leverage <= 0.0 || leverage > 10.0 {
            return Err("max leverage 10x".to_string());
        }
        if !entry_price.is_finite() || entry_price <= 0.0 {
            return Err("entry price must be positive".to_string());
        }
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

    #[test]
    fn a_non_positive_supply_is_refused() {
        let mut svc = LendingService::new();
        assert!(svc.supply("u", "USDT", 0.0).is_err());
        assert!(svc.supply("u", "USDT", -1.0).is_err());
        assert!(svc.supply("u", "USDT", f64::NAN).is_err());
    }

    #[test]
    fn a_borrow_beyond_collateral_value_is_refused() {
        let mut svc = LendingService::new();
        svc.supply("u", "USDT", 1_000_000.0).unwrap();
        // 0.001 BTC at 60000 = 60 USD, 70% -> 42 USD. Borrow 100 USDT at 1.
        assert!(svc.borrow("u2", "USDT", 100.0, "BTC", 0.001, 60_000.0, 1.0).is_err());
        // 1 BTC at 60000 = 60000, 70% -> 42000. Borrow 100 USDT is fine.
        assert!(svc.borrow("u2", "USDT", 100.0, "BTC", 1.0, 60_000.0, 1.0).is_ok());
    }

    #[test]
    fn pnl_is_not_multiplied_by_leverage() {
        let mut pos = MarginPosition::new("u", "BTCUSDT", PositionSide::Long, 2.0, 10.0, 100.0);
        pos.update_price(110.0);
        // 2 units * 10 price move = 20, not 200.
        assert_eq!(pos.unrealized_pnl, 20.0);
    }

    #[test]
    fn a_long_liquidates_when_the_loss_exceeds_the_margin_buffer() {
        let mut pos = MarginPosition::new("u", "BTCUSDT", PositionSide::Long, 1.0, 10.0, 100.0);
        // margin = 10. A 9.5 move down loses 9.5 -> ratio 0.95 > 0.9 buffer.
        pos.update_price(90.5);
        assert!(pos.should_liquidate(0.1));
        // A 5 move down is ratio 0.5, safe.
        pos.update_price(95.0);
        assert!(!pos.should_liquidate(0.1));
    }
}