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
        if amount <= 0.0 {
            return Err("Amount must be positive".to_string());
        }
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        if !market.asset.is_active {
            return Err("Market not active".to_string());
        }
        market.asset.total_supply += amount;
        market.asset.utilization_rate = utilization(market.asset.total_borrow, market.asset.total_supply);
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
        if amount <= 0.0 {
            return Err("Amount must be positive".to_string());
        }
        let prices = self.prices.read();
        let collateral_price = prices.get(collateral_asset).ok_or("Collateral price not found")?;
        let collateral_value = collateral_amount * collateral_price;
        let mut markets = self.markets.write();
        // The borrow limit comes from the collateral asset's own risk parameters,
        // not a fixed ratio: a hardcoded 0.8 ignored each asset's collateral
        // factor and let an asset with a lower factor borrow as if it were blue
        // chip. An unknown collateral market fails closed.
        let collateral_factor = markets
            .get(collateral_asset)
            .map(|m| m.asset.collateral_factor)
            .ok_or("Collateral market not found")?;
        let max_borrow = collateral_value * collateral_factor;
        if amount > max_borrow {
            return Err("Insufficient collateral".to_string());
        }
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        if !market.asset.is_active {
            return Err("Market not active".to_string());
        }
        // Liquidity available to borrow is what lenders supplied minus what is
        // already borrowed. Comparing against `total_supply` alone let a market
        // lend out its deposits twice.
        let available = market.asset.total_supply - market.asset.total_borrow;
        if available < amount {
            return Err("Insufficient liquidity".to_string());
        }
        market.asset.total_borrow += amount;
        market.asset.utilization_rate = utilization(market.asset.total_borrow, market.asset.total_supply);
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
                market.asset.total_borrow -= repay;
                market.asset.utilization_rate = utilization(market.asset.total_borrow, market.asset.total_supply);
                break;
            }
        }
        Ok(repaid)
    }

    #[inline]
    pub fn withdraw(&self, user_id: &str, asset: &str, amount: f64) -> Result<f64, String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Amount must be a positive finite number".to_string());
        }
        let mut markets = self.markets.write();
        let market = markets.get_mut(asset).ok_or("Market not found")?;
        let mut user_supplies = self.user_supplies.write();
        let user_supply_list = user_supplies.get_mut(user_id).ok_or("No supplies found")?;
        // A supplier may only take back idle liquidity: what the market holds
        // that is not currently lent out. Withdrawing borrowed liquidity would
        // strand a borrower who still owes it, so a request beyond what is idle
        // fails closed rather than silently returning a partial amount.
        let idle = market.asset.total_supply - market.asset.total_borrow;
        if idle <= 0.0 || amount > idle {
            return Err("Insufficient idle liquidity to withdraw".to_string());
        }
        let mut withdrawn = 0.0;
        for supply in user_supply_list.iter_mut() {
            if supply.asset == asset && supply.balance > 0.0 {
                let withdraw = amount.min(supply.balance);
                supply.balance -= withdraw;
                withdrawn += withdraw;
                market.asset.total_supply -= withdraw;
                market.asset.utilization_rate = utilization(market.asset.total_borrow, market.asset.total_supply);
                break;
            }
        }
        if withdrawn == 0.0 {
            return Err("Insufficient supplied balance".to_string());
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
                // An unpriced asset contributes nothing rather than an invented
                // $1 price, which would have inflated the collateral value.
                let value = match prices.get(&supply.asset) {
                    Some(price) => supply.balance * price,
                    None => 0.0,
                };
                portfolio.total_supply_value += value;
                portfolio.supplies.insert(supply.asset.clone(), supply.clone());
            }
        }
        let user_borrows = self.user_borrows.read();
        if let Some(borrows) = user_borrows.get(user_id) {
            for borrow in borrows {
                let value = match prices.get(&borrow.asset) {
                    Some(price) => borrow.balance * price,
                    // A debt we cannot price must not be treated as zero, or the
                    // account would look healthier than it is. Signal it so the
                    // health factor fails closed below.
                    None => f64::INFINITY,
                };
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

/// Utilization of a market, defined as zero when nothing is supplied. A bare
/// `total_borrow / total_supply` produced NaN once a market was fully withdrawn.
#[inline]
fn utilization(total_borrow: f64, total_supply: f64) -> f64 {
    if total_supply <= 0.0 {
        0.0
    } else {
        total_borrow / total_supply
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn market(symbol: &str, factor: f64) -> Asset {
        Asset {
            symbol: symbol.to_string(),
            name: symbol.to_string(),
            decimals: 8,
            collateral_factor: factor,
            liquidation_threshold: factor - 0.05,
            borrow_apr: 0.12,
            supply_apr: 0.08,
            total_supply: 0.0,
            total_borrow: 0.0,
            utilization_rate: 0.0,
            is_active: true,
        }
    }

    fn pool() -> LendingPool {
        let p = LendingPool::new();
        p.add_market(market("USDT", 0.9));
        p.add_market(market("BTC", 0.7));
        p.update_price("USDT", 1.0);
        p.update_price("BTC", 50_000.0);
        p
    }

    #[test]
    fn supply_rejects_non_positive_amount() {
        let p = pool();
        assert!(p.supply("u1", "USDT", 0.0).is_err());
        assert!(p.supply("u1", "USDT", -1.0).is_err());
    }

    #[test]
    fn borrow_uses_the_collateral_assets_own_factor() {
        let p = pool();
        p.supply("lender", "USDT", 1_000_000.0);
        // 1 BTC at 50k with a 0.7 factor -> 35k borrow limit.
        assert!(p.borrow("u1", "USDT", 35_000.0, "BTC", 1.0).is_ok());
        assert!(p.borrow("u2", "USDT", 35_001.0, "BTC", 1.0).is_err());
    }

    #[test]
    fn borrow_cannot_exceed_idle_liquidity() {
        let p = pool();
        p.supply("lender", "USDT", 10_000.0);
        // Plenty of collateral, but only 10k of liquidity exists.
        let err = p.borrow("whale", "USDT", 20_000.0, "BTC", 10.0).unwrap_err();
        assert_eq!(err, "Insufficient liquidity");
    }

    #[test]
    fn borrow_fails_closed_on_unknown_collateral_market() {
        let p = pool();
        p.supply("lender", "USDT", 10_000.0);
        assert!(p.borrow("u1", "USDT", 100.0, "DOGE", 1000.0).is_err());
    }

    #[test]
    fn utilization_is_zero_not_nan_when_empty() {
        let p = pool();
        p.supply("u1", "USDT", 100.0);
        p.withdraw("u1", "USDT", 100.0).unwrap();
        let market = p.markets.read().get("USDT").cloned().unwrap();
        assert_eq!(market.asset.total_supply, 0.0);
        assert!(market.asset.utilization_rate.is_finite());
        assert_eq!(market.asset.utilization_rate, 0.0);
    }

    #[test]
    fn withdraw_cannot_take_borrowed_liquidity() {
        let p = pool();
        p.supply("lender", "USDT", 1_000.0);
        p.borrow("borrower", "USDT", 900.0, "BTC", 1.0).unwrap();
        // Only 100 is idle; a 500 withdrawal must fail rather than break the book.
        assert!(p.withdraw("lender", "USDT", 500.0).is_err());
        assert_eq!(p.withdraw("lender", "USDT", 100.0).unwrap(), 100.0);
    }

    #[test]
    fn health_factor_is_collateral_value_over_debt_value() {
        let p = pool();
        p.supply("lender", "USDT", 100_000.0);
        p.borrow("u1", "USDT", 10_000.0, "BTC", 1.0).unwrap();
        let portfolio = p.get_portfolio("u1");
        // Collateral 50k, debt 10k -> HF 5.
        assert!((portfolio.health_factor - 5.0).abs() < 1e-9, "hf={}", portfolio.health_factor);
    }

    #[test]
    fn unpriced_debt_forces_a_failing_health_factor() {
        let p = pool();
        p.supply("lender", "USDT", 100_000.0);
        p.borrow("u1", "USDT", 10_000.0, "BTC", 1.0).unwrap();
        // Drop the USDT price: the debt can no longer be valued, so it must be
        // treated as unbounded, not as zero.
        p.prices.write().remove("USDT");
        let portfolio = p.get_portfolio("u1");
        assert!(portfolio.total_borrow_value.is_infinite());
        assert_eq!(portfolio.health_factor, 0.0);
    }

    #[test]
    fn repay_reduces_debt_and_total_borrow() {
        let p = pool();
        p.supply("lender", "USDT", 100_000.0);
        p.borrow("u1", "USDT", 10_000.0, "BTC", 1.0).unwrap();
        assert_eq!(p.repay("u1", "USDT", 4_000.0).unwrap(), 4_000.0);
        assert_eq!(p.markets.read().get("USDT").unwrap().asset.total_borrow, 6_000.0);
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
