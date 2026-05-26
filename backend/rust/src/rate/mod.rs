// Rate - Interest Rates and Borrowing
// Rust for lending/borrowing rates

use std::collections::HashMap;

// Lending pool
#[derive(Debug, Clone)]
pub struct LendingPool {
    pub asset: String,
    pub supplied: f64,
    pub borrowed: f64,
    pub utilization: f64,
    pub supply_rate: f64,
    pub borrow_rate: f64,
}

impl LendingPool {
    pub fn new(asset: &str) -> Self {
        LendingPool {
            asset: asset.to_string(),
            supplied: 0.0,
            borrowed: 0.0,
            utilization: 0.0,
            supply_rate: 0.0,
            borrow_rate: 0.0,
        }
    }

    pub fn update_rates(&mut self) {
        self.utilization = if self.supplied > 0.0 {
            self.borrowed / self.supplied
        } else {
            0.0
        };

        // Supply rate decreases as utilization increases
        let base_supply = 0.02; // 2% base
        self.supply_rate = base_supply * (1.0 - self.utilization);

        // Borrow rate increases as utilization increases
        let base_borrow = 0.05; // 5% base
        let kink = 0.8; // Utilization kink point
        let jump = 0.5; // Rate jump at kink

        if self.utilization < kink {
            self.borrow_rate = base_borrow + self.utilization * 0.1;
        } else {
            self.borrow_rate = base_borrow + kink * 0.1 + (self.utilization - kink) * jump;
        }
    }

    pub fn deposit(&mut self, amount: f64) {
        self.supplied += amount;
        self.update_rates();
    }

    pub fn borrow(&mut self, amount: f64) -> Result<(), String> {
        let available = self.supplied - self.borrowed;
        
        if amount > available * 0.9 { // 90% of available
            return Err("insufficient liquidity".to_string());
        }

        self.borrowed += amount;
        self.update_rates();
        
        Ok(())
    }

    pub fn repay(&mut self, amount: f64) {
        self.borrowed -= amount;
        self.update_rates();
    }
}

// Interest calculator
pub struct InterestCalc {
    principal: f64,
    rate: f64,
    compounding: i32, // Times per year
}

impl InterestCalc {
    pub fn new(principal: f64, rate: f64, compounding: i32) -> Self {
        InterestCalc {
            principal,
            rate,
            compounding,
        }
    }

    // Simple interest
    pub fn simple(&self, time_years: f64) -> f64 {
        self.principal * (1.0 + self.rate * time_years)
    }

    // Compound interest
    pub fn compound(&self, time_years: f64) -> f64 {
        let periods = self.compounding as f64 * time_years;
        self.principal * (1.0 + self.rate / self.compounding as f64).powf(periods)
    }

    // Continuous compounding
    pub fn continuous(&self, time_years: f64) -> f64 {
        self.principal * self.rate.exp() * time_years
    }
}

// Supply borrow rate cache
pub struct RateCache {
    pools: HashMap<String, LendingPool>,
}

impl RateCache {
    pub fn new() -> Self {
        RateCache {
            pools: HashMap::new(),
        }
    }

    pub fn get_pool(&mut self, asset: &str) -> &mut LendingPool {
        self.pools.entry(asset.to_string()).or_insert_with(|| LendingPool::new(asset))
    }

    pub fn get_supply_rate(&self, asset: &str) -> f64 {
        self.pools.get(asset).map(|p| p.supply_rate).unwrap_or(0.02)
    }

    pub fn get_borrow_rate(&self, asset: &str) -> f64 {
        self.pools.get(asset).map(|p| p.borrow_rate).unwrap_or(0.05)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lending() {
        let mut pool = LendingPool::new("USDT");
        
        pool.deposit(10000.0);
        
        assert!(pool.supplied > 0.0);
    }
}