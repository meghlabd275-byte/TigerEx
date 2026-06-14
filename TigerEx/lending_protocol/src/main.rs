//! TigerEx Lending & Borrowing Protocol
//! High-performance Rust implementation for DeFi lending

use std::collections::HashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub collateral_factor: f64,
    pub liquidation_threshold: f64,
    pub borrow_apr: f64,
    pub supply_apr: f64,
    pub total_supply: f64,
    pub total_borrow: f64,
    pub utilization_rate: f64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub id: String,
    pub asset: Asset,
    pub exchange_rate: f64,
    pub borrow_index: f64,
    pub supply_index: f64,
    pub accrual_block: i64,
    pub last_accrual_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Loan {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub collateral_amount: f64,
    pub collateral_asset: String,
    pub borrow_rate: f64,
    pub status: LoanStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoanStatus {
    Active,
    Liquidated,
    Repaid,
    Undercollateralized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplyPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub balance: f64,
    pub accrued_supply_interest: f64,
    pub exchange_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorrowPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub balance: f64,
    pub borrowed_amount: f64,
    pub accrued_borrow_interest: f64,
    pub borrow_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPortfolio {
    pub user_id: String,
    pub supplies: HashMap<String, SupplyPosition>,
    pub borrows: HashMap<String, BorrowPosition>,
    pub collaterals: HashMap<String, f64>,
    pub total_supply_value: f64,
    pub total_borrow_value: f64,
    pub net_value: f64,
    pub health_factor: f64,
}

impl UserPortfolio {
    pub fn new(user_id: String) -> Self {
        Self {
            user_id,
            supplies: HashMap::new(),
            borrows: HashMap::new(),
            collaterals: HashMap::new(),
            total_supply_value: 0.0,
            total_borrow_value: 0.0,
            net_value: 0.0,
            health_factor: 0.0,
        }
    }

    #[inline]
    pub fn calculate_health_factor(&mut self, prices: &HashMap<String, f64>) {
        let mut collateral_value = 0.0;
        for (asset, amount) in &self.collaterals {
            if let Some(price) = prices.get(asset) {
                collateral_value += amount * price;
            }
        }
        if self.total_borrow_value > 0.0 {
            self.health_factor = collateral_value / self.total_borrow_value;
        } else {
            self.health_factor = f64::INFINITY;
        }
        self.net_value = collateral_value - self.total_borrow_value;
    }
}

pub struct LendingPool {
    markets: RwLock<HashMap<String, Market>>,
    loans: RwLock<HashMap<String, Loan>>,
    user_supplies: RwLock<HashMap<String, Vec<SupplyPosition>>>,
    user_borrows: RwLock<HashMap<String, Vec<BorrowPosition>>>,
    prices: RwLock<HashMap<String, f64>>,
}

impl LendingPool {
    pub fn new() -> Self {
        Self {
            markets: RwLock::new(HashMap::new()),
            loans: RwLock::new(HashMap::new()),
            user_supplies: RwLock::new(HashMap::new()),
            user_borrows: RwLock::new(HashMap::new()),
            prices: RwLock::new(HashMap::new()),
        }
    }

    #[inline]
    pub fn add_market(&self, asset: Asset) {
        let market = Market {
            id: Uuid::new_v4().to_string(),
            asset,
            exchange_rate: 1.0,
            borrow_index: 1.0,
            supply_index: 1.0,
            accrual_block: 0,
            last_accrual_time: chrono::Utc::now().timestamp(),
        };
        self.markets.write().insert(market.asset.symbol.clone(), market);
    }

    #[inline]
    pub fn supply(&self, user_id: &str, asset: &str, amount: f64) -> Result<SupplyPosition, String> {
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        if !market.asset.is_active {
            return Err("Market not active".to_string());
        }
        market.total_supply += amount;
        market.utilization_rate = market.total_borrow / market.total_supply;
        let supply_interest = amount * market.supply_index;
        let position = SupplyPosition {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            balance: amount,
            accrued_supply_interest: supply_interest,
            exchange_rate: market.exchange_rate,
        };
        self.user_supplies.write()
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(position.clone());
        Ok(position)
    }

    #[inline]
    pub fn borrow(&self, user_id: &str, asset: &str, amount: f64, collateral_asset: &str, collateral_amount: f64) -> Result<BorrowPosition, String> {
        let prices = self.prices.read();
        let collateral_price = prices.get(collateral_asset).ok_or("Collateral price not found")?;
        let collateral_value = collateral_amount * collateral_price;
        let max_borrow = collateral_value * 0.8;
        if amount > max_borrow {
            return Err("Insufficient collateral".to_string());
        }
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        if !market.asset.is_active {
            return Err("Market not active".to_string());
        }
        if market.total_supply < amount {
            return Err("Insufficient liquidity".to_string());
        }
        market.total_borrow += amount;
        market.utilization_rate = market.total_borrow / market.total_supply;
        let borrow_interest = amount * market.borrow_index;
        let position = BorrowPosition {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            balance: amount,
            borrowed_amount: amount,
            accrued_borrow_interest: borrow_interest,
            borrow_rate: market.asset.borrow_apr,
        };
        let loan = Loan {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            collateral_amount,
            collateral_asset: collateral_asset.to_string(),
            borrow_rate: market.asset.borrow_apr,
            status: LoanStatus::Active,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        self.user_borrows.write()
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(position.clone());
        self.loans.write().insert(loan.id.clone(), loan);
        Ok(position)
    }

    #[inline]
    pub fn repay(&self, user_id: &str, asset: &str, amount: f64) -> Result<f64, String> {
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        let mut user_borrows = self.user_borrows.write();
        let user_borrow_list = user_borrows.get_mut(user_id).ok_or("No borrows found")?;
        let mut repaid = 0.0;
        for borrow in user_borrow_list.iter_mut() {
            if borrow.asset == asset && borrow.balance > 0.0 {
                let repay = amount.min(borrow.balance);
                borrow.balance -= repay;
                borrow.borrowed_amount -= repay;
                repaid += repay;
                market.total_borrow -= repay;
                market.utilization_rate = market.total_borrow / market.total_supply;
                break;
            }
        }
        Ok(repaid)
    }

    #[inline]
    pub fn withdraw(&self, user_id: &str, asset: &str, amount: f64) -> Result<f64, String> {
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        let mut user_supplies = self.user_supplies.write();
        let user_supply_list = user_supplies.get_mut(user_id).ok_or("No supplies found")?;
        let mut withdrawn = 0.0;
        for supply in user_supply_list.iter_mut() {
            if supply.asset == asset && supply.balance > 0.0 {
                let withdraw = amount.min(supply.balance);
                supply.balance -= withdraw;
                withdrawn += withdraw;
                market.total_supply -= withdraw;
                market.utilization_rate = market.total_borrow / market.total_supply;
                break;
            }
        }
        Ok(withdrawn)
    }

    #[inline]
    pub fn get_portfolio(&self, user_id: &str) -> UserPortfolio {
        let prices = self.prices.read();
        let mut portfolio = UserPortfolio::new(user_id.to_string());
        let user_supplies = self.user_supplies.read();
        if let Some(supplies) = user_supplies.get(user_id) {
            for supply in supplies {
                let value = supply.balance * prices.get(&supply.asset).unwrap_or(&1.0);
                portfolio.total_supply_value += value;
                portfolio.supplies.insert(supply.asset.clone(), supply.clone());
            }
        }
        let user_borrows = self.user_borrows.read();
        if let Some(borrows) = user_borrows.get(user_id) {
            for borrow in borrows {
                let value = borrow.balance * prices.get(&borrow.asset).unwrap_or(&1.0);
                portfolio.total_borrow_value += value;
                portfolio.borrows.insert(borrow.asset.clone(), borrow.clone());
            }
        }
        let loans = self.loans.read();
        for loan in loans.values() {
            if loan.user_id == user_id && loan.status == LoanStatus::Active {
                portfolio.collaterals.insert(loan.collateral_asset.clone(), loan.collateral_amount);
            }
        }
        portfolio.calculate_health_factor(&prices);
        portfolio
    }

    #[inline]
    pub fn update_price(&self, asset: &str, price: f64) {
        self.prices.write().insert(asset.to_string(), price);
    }
}

fn main() {
    println!("TigerEx Lending & Borrowing Protocol v1.0\n");
    let pool = Arc::new(LendingPool::new());
    pool.add_market(Asset {
        symbol: "USDT".to_string(),
        name: "Tether USD".to_string(),
        decimals: 6,
        collateral_factor: 0.9,
        liquidation_threshold: 0.85,
        borrow_apr: 0.12,
        supply_apr: 0.08,
        total_supply: 0.0,
        total_borrow: 0.0,
        utilization_rate: 0.0,
        is_active: true,
    });
    pool.update_price("USDT", 1.0);
    pool.update_price("BTC", 50000.0);
    let supply = pool.supply("user1", "USDT", 10000.0).unwrap();
    println!("Supplied: {} {}", supply.balance, supply.asset);
}
