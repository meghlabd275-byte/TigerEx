// Grid - Grid Trading Strategies
// Rust for mathematical grid execution

use std::collections::HashMap;

// Grid position
#[derive(Debug, Clone)]
pub struct GridPos {
    pub id: String,
    pub level: i32,
    pub side: String,
    pub price: f64,
    pub size: f64,
    pub filled: bool,
}

// Grid strategy manager
pub struct GridManager {
    positions: HashMap<String, Vec<GridPos>>,
    profits: HashMap<String, f64>,
}

impl GridManager {
    pub fn new() -> Self {
        GridManager {
            positions: HashMap::new(),
            profits: HashMap::new(),
        }
    }

    /// Configure a grid only when its parameters are valid.
    pub fn init_grid(&mut self, strategy_id: &str, levels: i32, min_price: f64, max_price: f64) {
        if levels <= 0 || levels > 1000
            || !min_price.is_finite() || !max_price.is_finite()
            || min_price <= 0.0 || max_price <= min_price {
            return;
        }
        let spacing = (max_price - min_price) / levels as f64;
        let mut positions = Vec::with_capacity((levels as usize) * 2);
        for i in 0..levels {
            let price = min_price + spacing * i as f64;
            positions.push(GridPos {
                id: format!("gb_{}_{}", strategy_id, i),
                level: i,
                side: "buy".to_string(),
                price,
                size: 0.01,
                filled: false,
            });
            positions.push(GridPos {
                id: format!("gs_{}_{}", strategy_id, i),
                level: i,
                side: "sell".to_string(),
                price: price + spacing,
                size: 0.01,
                filled: false,
            });
        }
        self.positions.insert(strategy_id.to_string(), positions);
        self.profits.insert(strategy_id.to_string(), 0.0);
    }

    /// Mark configured grid orders as triggered. This method does not report
    /// profit: a trigger is not proof of an exchange fill or settlement.
    pub fn trigger_fill(&mut self, strategy_id: &str, current_price: f64) -> Vec<String> {
        if !current_price.is_finite() || current_price <= 0.0 {
            return Vec::new();
        }
        let mut filled = Vec::new();
        if let Some(positions) = self.positions.get_mut(strategy_id) {
            for pos in positions.iter_mut() {
                let should_fill = if pos.side == "buy" {
                    current_price <= pos.price
                } else {
                    current_price >= pos.price
                };
                if should_fill && !pos.filled {
                    pos.filled = true;
                    filled.push(pos.id.clone());
                }
            }
        }
        filled
    }

    pub fn get_grid_levels(&self, strategy_id: &str) -> Vec<(i32, String, f64, bool)> {
        self.positions.get(strategy_id)
            .map(|positions| positions.iter().map(|p| (p.level, p.side.clone(), p.price, p.filled)).collect())
            .unwrap_or_default()
    }

    /// Realized profit reported by the execution integration. Grid triggers
    /// never mutate this value; only reconciled execution events should do so.
    pub fn get_profit(&self, strategy_id: &str) -> f64 {
        self.profits.get(strategy_id).copied().unwrap_or(0.0)
    }

    pub fn record_realized_profit(&mut self, strategy_id: &str, realized_pnl: f64) -> Result<(), &'static str> {
        if !realized_pnl.is_finite() {
            return Err("realized PnL must be finite");
        }
        let profit = self.profits.get_mut(strategy_id).ok_or("unknown strategy")?;
        *profit += realized_pnl;
        Ok(())
    }

    pub fn calculate_spacing(&self, volatility: f64, levels: i32) -> f64 {
        if levels <= 0 || !volatility.is_finite() || volatility <= 0.0 {
            return 0.0;
        }
        volatility / levels as f64
    }

    /// Historical simulation using limit-price fills and inventory accounting.
    /// This is explicitly a backtest result, not live or settled profit.
    pub fn backtest(&self, strategy_id: &str, prices: &[f64]) -> f64 {
        let Some(configured) = self.positions.get(strategy_id) else { return 0.0; };
        let mut positions = configured.clone();
        let mut inventory_qty = 0.0;
        let mut inventory_cost = 0.0;
        let mut realized_pnl = 0.0;

        for current_price in prices.iter().copied() {
            if !current_price.is_finite() || current_price <= 0.0 {
                continue;
            }

            for pos in positions.iter_mut().filter(|p| p.side == "buy" && !p.filled) {
                if current_price <= pos.price {
                    pos.filled = true;
                    inventory_qty += pos.size;
                    inventory_cost += pos.size * pos.price;
                }
            }

            for pos in positions.iter_mut().filter(|p| p.side == "sell" && !p.filled) {
                if current_price >= pos.price && inventory_qty + f64::EPSILON >= pos.size {
                    let average_cost = inventory_cost / inventory_qty;
                    realized_pnl += (pos.price - average_cost) * pos.size;
                    inventory_qty = (inventory_qty - pos.size).max(0.0);
                    inventory_cost = (inventory_cost - average_cost * pos.size).max(0.0);
                    pos.filled = true;
                }
            }
        }
        realized_pnl
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_requires_valid_bounds() {
        let mut gm = GridManager::new();
        gm.init_grid("bad", 0, 10.0, 20.0);
        assert!(gm.get_grid_levels("bad").is_empty());
        gm.init_grid("bad2", 2, 20.0, 10.0);
        assert!(gm.get_grid_levels("bad2").is_empty());
    }

    #[test]
    fn backtest_calculates_spread_and_does_not_mutate_live_state() {
        let mut gm = GridManager::new();
        gm.init_grid("s1", 2, 10.0, 20.0);
        let pnl = gm.backtest("s1", &[10.0, 16.0]);
        assert!((pnl - 0.025).abs() < 1e-9, "unexpected PnL: {pnl}");
        assert_eq!(gm.get_profit("s1"), 0.0);
        assert!(gm.get_grid_levels("s1").iter().all(|level| !level.3));
    }

    #[test]
    fn trigger_does_not_fabricate_profit() {
        let mut gm = GridManager::new();
        gm.init_grid("s1", 2, 10.0, 20.0);
        assert!(gm.trigger_fill("s1", f64::NAN).is_empty());
        assert_eq!(gm.get_profit("s1"), 0.0);
    }
}
