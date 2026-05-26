// Liquidation Engine
// Migrated from TypeScript to Rust for margin liquidations

use std::collections::HashMap;

// Position state
#[derive(Debug, Clone)]
pub struct Position {
    pub user_id: String,
    pub symbol: String,
    pub size: f64,
    pub entry_price: f64,
    pub margin: f64,
    pub leverage: f64,
}

// Liquidation event
#[derive(Debug, Clone)]
pub struct LiquidationEvent {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub position_value: f64,
    pub remaining_collateral: f64,
    pub liquidator_reward: f64,
    pub timestamp: i64,
}

// Liquidation engine
pub struct LiquidationEngine {
    positions: HashMap<String, Position>,
    events: Vec<LiquidationEvent>,
    reserve_ratio: f64, // 5% default
}

impl LiquidationEngine {
    pub fn new() -> Self {
        LiquidationEngine {
            positions: HashMap::new(),
            events: Vec::new(),
            reserve_ratio: 0.05,
        }
    }

    // Open position
    pub fn open_position(&mut self, user_id: &str, symbol: &str, size: f64, entry_price: f64, margin: f64, leverage: f64) -> String {
        let id = format!("pos_{}", random_id());
        
        let position = Position {
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            size,
            entry_price,
            margin,
            leverage,
        };
        
        self.positions.insert(id.clone(), position);
        id
    }

    // Calculate liquidation price
    pub fn calc_liquidation_price(&self, position: &Position) -> f64 {
        let margin_ratio = position.margin / (position.size * position.entry_price);
        let threshold = self.reserve_ratio / position.leverage;
        
        position.entry_price * (1.0 - threshold + margin_ratio)
    }

    // Check liquidation needed
    pub fn check_liquidation(&self, position_id: &str, current_price: f64) -> bool {
        if let Some(position) = self.positions.get(position_id) {
            let liq_price = self.calc_liquidation_price(position);
            return current_price <= liq_price;
        }
        false
    }

    // Execute liquidation
    pub fn liquidate(&mut self, position_id: &str, current_price: f64) -> Result<LiquidationEvent, String> {
        let position = match self.positions.get(position_id) {
            Some(p) => p,
            None => return Err("position not found".to_string()),
        };

        let position_value = position.size * current_price;
        let remaining = position.margin - (position.size * (position.entry_price - current_price));
        let reward = position_value * 0.025; // 2.5% liquidator fee

        let event = LiquidationEvent {
            id: format!("liq_{}", random_id()),
            user_id: position.user_id.clone(),
            symbol: position.symbol.clone(),
            position_value,
            remaining_collateral: remaining.max(0.0),
            liquidator_reward: reward,
            timestamp: now_ms(),
        };

        self.events.push(event);
        self.positions.remove(position_id);

        Ok(event)
    }

    // Get liquidations for user
    pub fn get_user_liquidations(&self, user_id: &str) -> Vec<&LiquidationEvent> {
        self.events
            .iter()
            .filter(|e| e.user_id == user_id)
            .collect()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn random_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(16)
        .map(|c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_liquidation() {
        let mut engine = LiquidationEngine::new();
        
        let pos_id = engine.open_position("user1", "BTC", 1.0, 50000.0, 5000.0, 10.0);
        
        assert!(engine.check_liquidation(&pos_id, 45000.0));
    }
}