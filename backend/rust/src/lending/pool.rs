// Lending Pool - Money Path in Rust
// Lending and borrowing for margin trading.
//
// Solvency rules:
//   * A borrow draws only liquidity that was actually supplied: it is capped at
//     `total_supplied - total_borrowed`.
//   * Collateral is valued in a common unit with `collateral_price`, so the
//     loan-to-value ratio is dimensionless. Collateral must be valued before it
//     can back a loan; a borrow without a price fails closed.
//   * LTV is computed from the position's own liquidation threshold.
//   * A liquidation repays the debt out of the seized collateral and marks the
//     position liquidated; it never credits a balance that was not posted.

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
        if self.total_supplied > 0.0 {
            self.total_borrowed / self.total_supplied
        } else {
            0.0
        }
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
    /// Price of the collateral asset in the account's common valuation unit
    /// (e.g. USD). Supplied by the oracle layer.
    pub collateral_price: f64,
    /// Price of the borrowed asset in the same unit, used to value the debt.
    pub borrow_price: f64,
    pub interest_accrued: f64,
    pub status: PositionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Active,
    Repaying,
    Liquidated,
    Closed,
}

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
    counter: RwLock<u64>,
}

impl LendingPoolService {
    pub fn new() -> Self {
        let svc = LendingPoolService {
            pools: RwLock::new(HashMap::new()),
            borrows: RwLock::new(HashMap::new()),
            supplies: RwLock::new(HashMap::new()),
            counter: RwLock::new(0),
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

    fn next_id(&self, prefix: &str) -> String {
        let mut c = self.counter.write().unwrap();
        *c += 1;
        format!("{}_{}_{}", prefix, ts(), *c)
    }

    /// Supply asset
    pub fn supply(&self, user_id: &str, asset: &str, amount: f64) -> Result<String, String> {
        if user_id.trim().is_empty() {
            return Err("user id is required".to_string());
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err("invalid amount".to_string());
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools.get_mut(asset).ok_or("asset not found")?;
        pool.total_supplied += amount;

        let id = self.next_id("supply");
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

    /// Borrow against collateral.
    ///
    /// `collateral_price` and `borrow_price` value the two legs in a common
    /// unit; a non-positive price fails closed because the LTV would be
    /// meaningless.
    pub fn borrow(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        coll_asset: &str,
        coll_amount: f64,
        collateral_price: f64,
        borrow_price: f64,
    ) -> Result<String, String> {
        if user_id.trim().is_empty() {
            return Err("user id is required".to_string());
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err("invalid amount".to_string());
        }
        if !coll_amount.is_finite() || coll_amount <= 0.0 {
            return Err("invalid collateral amount".to_string());
        }
        if !collateral_price.is_finite() || collateral_price <= 0.0 {
            return Err("collateral must be valued with a positive price".to_string());
        }
        if !borrow_price.is_finite() || borrow_price <= 0.0 {
            return Err("borrowed asset must be valued with a positive price".to_string());
        }

        let mut pools = self.pools.write().unwrap();
        // The collateral asset's own pool sets the factor; read it by value so
        // the borrow ends before the mutable lookup below.
        let coll_factor = pools
            .get(coll_asset)
            .ok_or("collateral asset not found")?
            .collateral_factor;

        let pool = pools.get_mut(asset).ok_or("asset not found")?;

        let collateral_value = coll_amount * collateral_price;
        let max_borrow_value = collateral_value * coll_factor;
        let borrow_value = amount * borrow_price;
        if borrow_value > max_borrow_value {
            return Err("insufficient collateral".to_string());
        }

        let available = pool.total_supplied - pool.total_borrowed;
        if amount > available {
            return Err("insufficient liquidity".to_string());
        }

        pool.total_borrowed += amount;

        let id = self.next_id("borrow");
        let pos = BorrowPosition {
            id: id.clone(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            collateral_asset: coll_asset.to_string(),
            collateral_amount: coll_amount,
            collateral_price,
            borrow_price,
            interest_accrued: 0.0,
            status: PositionStatus::Active,
        };

        self.borrows.write().unwrap().insert(id.clone(), pos);
        Ok(id)
    }

    /// Check liquidations. Returns the ids of positions whose LTV exceeds the
    /// borrowed asset's liquidation threshold.
    pub fn check_liquidations(&self) -> Vec<String> {
        let thresholds: HashMap<String, f64> = self
            .pools
            .read()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.liquidation_threshold))
            .collect();

        let mut borrows = self.borrows.write().unwrap();
        let mut liquidations = Vec::new();

        for (id, pos) in borrows.iter_mut() {
            if pos.status != PositionStatus::Active {
                continue;
            }
            if pos.collateral_amount <= 0.0 || pos.collateral_price <= 0.0 {
                continue;
            }
            let collateral_value = pos.collateral_amount * pos.collateral_price;
            let debt_value = (pos.amount + pos.interest_accrued) * pos.borrow_price;
            let threshold = thresholds.get(&pos.asset).copied().unwrap_or(0.8);
            if collateral_value <= 0.0 {
                pos.status = PositionStatus::Liquidated;
                liquidations.push(id.clone());
                continue;
            }
            let ltv = debt_value / collateral_value;
            if ltv > threshold {
                pos.status = PositionStatus::Liquidated;
                liquidations.push(id.clone());
            }
        }

        liquidations
    }

    pub fn get_pool(&self, asset: &str) -> Option<AssetPool> {
        self.pools.read().unwrap().get(asset).cloned()
    }

    pub fn get_borrow(&self, id: &str) -> Option<BorrowPosition> {
        self.borrows.read().unwrap().get(id).cloned()
    }
}

impl Default for LendingPoolService {
    fn default() -> Self {
        Self::new()
    }
}

fn ts() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 1000.0).unwrap();
        // 1 BTC at 60000 backs 70% -> 42000 USDT of borrowing power; a 500 USDT
        // loan is well within it and within the supplied liquidity.
        let r = svc.borrow("u2", "USDT", 500.0, "BTC", 1.0, 60_000.0, 1.0);
        assert!(r.is_ok());
    }

    #[test]
    fn a_borrow_beyond_collateral_is_refused() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 1_000_000.0).unwrap();
        // 0.001 BTC at 60000 = 60 USD collateral, 70% -> 42 USD. Borrow 100.
        let r = svc.borrow("u2", "USDT", 100.0, "BTC", 0.001, 60_000.0, 1.0);
        assert!(r.is_err());
    }

    #[test]
    fn a_borrow_beyond_supplied_liquidity_is_refused() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 100.0).unwrap();
        // Plenty of collateral, but only 100 USDT was ever supplied.
        let r = svc.borrow("u2", "USDT", 500.0, "BTC", 1.0, 60_000.0, 1.0);
        assert!(r.is_err());
    }

    #[test]
    fn a_borrow_without_a_price_fails_closed() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 1000.0).unwrap();
        assert!(svc.borrow("u2", "USDT", 100.0, "BTC", 1.0, 0.0, 1.0).is_err());
        assert!(svc.borrow("u2", "USDT", 100.0, "BTC", 1.0, f64::NAN, 1.0).is_err());
    }

    #[test]
    fn liquidation_triggers_when_ltv_exceeds_the_threshold() {
        let svc = LendingPoolService::new();
        svc.supply("u1", "USDT", 100_000.0).unwrap();
        // 1 BTC at 1000 = 1000 collateral; 70% factor allows a 700 USDT loan,
        // so this borrow is accepted at LTV 0.7.
        let id = svc.borrow("u2", "USDT", 700.0, "BTC", 1.0, 1000.0, 1.0).unwrap();
        assert!(svc.check_liquidations().is_empty());

        // The collateral price falls to 800: debt 700 / value 800 = 0.875 > 0.8.
        svc.borrows.write().unwrap().get_mut(&id).unwrap().collateral_price = 800.0;
        let liquidations = svc.check_liquidations();
        assert!(liquidations.contains(&id));
        assert_eq!(svc.get_borrow(&id).unwrap().status, PositionStatus::Liquidated);
    }
}
