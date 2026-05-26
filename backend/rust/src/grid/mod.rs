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

    // Initialize grid levels
    pub fn init_grid(&mut self, strategy_id: &str, levels: i32, min_price: f64, max_price: f64) {
        let spacing = (max_price - min_price) / levels as f64;
        let mut positions = Vec::new();

        for i in 0..levels {
            let price = min_price + (spacing * i as f64);

            // Buy grid
            positions.push(GridPos {
                id: format!("gb_{}_{}", strategy_id, i),
                level: i,
                side: "buy".to_string(),
                price,
                size: 0.01,
                filled: false,
            });

            // Sell grid
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

    // Trigger fill at price
    pub fn trigger_fill(&mut self, strategy_id: &str, current_price: f64) -> Vec<String> {
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

                    // Calculate profit (spread)
                    let profit = pos.size * 0.001 * pos.price; // Small fee capture
                    
                    if let Some(p) = self.profits.get_mut(strategy_id) {
                        *p += profit;
                    }
                }
            }
        }

        filled
    }

    // Get grid levels
    pub fn get_grid_levels(&self, strategy_id: &str) -> Vec<(i32, String, f64, bool)> {
        if let Some(positions) = self.positions.get(strategy_id) {
            positions
                .iter()
                .map(|p| (p.level, p.side.clone(), p.price, p.filled))
                .collect()
        } else {
            Vec::new()
        }
    }

    // Calculate profit
    pub fn get_profit(&self, strategy_id: &str) -> f64 {
        self.profits.get(strategy_id).unwrap_or(&0.0)
    }

    // Calculate optimal grid spacing (volatility-based)
    pub fn calculate_spacing(&self, volatility: f64, levels: i32) -> f64 {
        // Simple ATR-based spacing
        volatility / levels as f64
    }

    // Backtest grid
    pub fn backtest(&self, strategy_id: &str, prices: &[f64]) -> f64 {
        let mut simulated_profit = 0.0;

        for price in prices {
            let fills = self.trigger_fill(strategy_id, *price);
            simulated_profit += (fills.len() as f64) * 10.0; // Mock profit
        }

        simulated_profit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid() {
        let mut gm = GridManager::new();

        gm.init_grid("s1", 5, 60000.0, 70000.0);

        let levels = gm.get_grid_levels("s1");

        assert!(levels.len() > 0);
    }
}