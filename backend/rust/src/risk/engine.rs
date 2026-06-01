// Production Risk Engine - Money Path in Rust
// calculates liquidation, margin, position limits

use std::collections::HashMap;

/// Risk level
#[derive(Debug, Clone, Copy)]
pub enum RiskLevel {
    Low,
    Medium, 
    High,
    Critical,
}

/// Position
#[derive(Debug, Clone)]
pub struct Position {
    pub symbol: String,
    pub quantity: f64,
    pub entry_price: f64,
    pub side: Side,
    pub leverage: f64,
}

#[derive(Debug, Clone, Copy)]
pub enum Side { Long, Short }

/// Risk metrics
#[derive(Debug, Clone)]
pub struct RiskMetrics {
    pub unrealized_pnl: f64,
    pub margin_used: f64,
    pub available_balance: f64,
    pub total_exposure: f64,
    pub leverage_used: f64,
    pub risk_level: RiskLevel,
    pub liquidation_price: Option<f64>,
}

/// Risk Engine - production risk enforcement
pub struct RiskEngine {
    max_leverage: f64,
    max_position_size: f64,
    liquidation_buffer: f64,
    maintenance_margin_ratio: f64,
}

impl RiskEngine {
    pub fn new() -> Self {
        RiskEngine {
            max_leverage: 125.0,
            max_position_size: 1_000_000.0,
            liquidation_buffer: 0.005,
            maintenance_margin_ratio: 0.005,
        }
    }
    
    /// Calculate risk metrics - called for every position check
    pub fn calculate_risk(
        &self,
        positions: &[Position],
        balance: f64,
        current_prices: &HashMap<String, f64>,
    ) -> RiskMetrics {
        let mut total_exposure = 0.0;
        let mut unrealized_pnl = 0.0;
        let mut margin_used = 0.0;
        
        for pos in positions {
            let current_price = current_prices.get(&pos.symbol).copied().unwrap_or(pos.entry_price);
            
            // PnL
            let pnl = match pos.side {
                Side::Long => (current_price - pos.entry_price) * pos.quantity,
                Side::Short => (pos.entry_price - current_price) * pos.quantity,
            };
            unrealized_pnl += pnl;
            
            // Margin
            let position_value = current_price * pos.quantity;
            let margin = position_value / pos.leverage;
            margin_used += margin;
            total_exposure += position_value;
        }
        
        let available_balance = balance - margin_used + unrealized_pnl;
        let leverage_used = if balance > 0.0 { total_exposure / balance } else { 0.0 };
        
        let risk_level = self.determine_risk_level(leverage_used, available_balance, balance);
        let liquidation_price = self.calculate_liquidation_price(positions, current_prices);
        
        RiskMetrics {
            unrealized_pnl,
            margin_used,
            available_balance,
            total_exposure,
            leverage_used,
            risk_level,
            liquidation_price,
        }
    }
    
    fn determine_risk_level(&self, leverage: f64, available: f64, total: f64) -> RiskLevel {
        if leverage > 20.0 { RiskLevel::Critical }
        else if leverage > 10.0 { RiskLevel::High }
        else if leverage > 5.0 || available < total * 0.1 { RiskLevel::Medium }
        else { RiskLevel::Low }
    }
    
    fn calculate_liquidation_price(&self, positions: &[Position], prices: &HashMap<String, f64>) -> Option<f64> {
        let mut min_liq = None;
        
        for pos in positions {
            let current = prices.get(&pos.symbol).copied().unwrap_or(pos.entry_price);
            let liq = match pos.side {
                Side::Long => current * (1.0 - self.maintenance_margin_ratio - self.liquidation_buffer),
                Side::Short => current * (1.0 + self.maintenance_margin_ratio + self.liquidation_buffer),
            };
            
            match min_liq {
                None => min_liq = Some(liq),
                Some(m) => { if liq < m { min_liq = Some(liq); } }
            }
        }
        
        min_liq
    }
    
    /// Check if position can be opened
    pub fn can_open_position(&self, symbol: &str, amount: f64, price: f64, current_balance: f64, open_positions: &[Position]) -> Result<(), String> {
        let total_value = amount * price;
        let margin_required = total_value / self.max_leverage;
        
        // Check position size
        if total_value > self.max_position_size {
            return Err("exceeds max position size".to_string());
        }
        
        // Check margin availability
        if margin_required > current_balance {
            return Err("insufficient margin".to_string());
        }
        
        // Check leverage
        let current_exposure: f64 = open_positions.iter()
            .map(|p| p.quantity * p.entry_price)
            .sum();
        
        let new_exposure = current_exposure + total_value;
        let new_leverage = new_exposure / current_balance;
        
        if new_leverage > self.max_leverage {
            return Err("would exceed max leverage".to_string());
        }
        
        Ok(())
    }
    
    /// Force liquidation check
    pub fn should_liquidate(&self, margin_used: f64, balance: f64) -> bool {
        let ratio = margin_used / balance;
        ratio >= 1.0 - self.liquidation_buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_risk() {
        let engine = RiskEngine::new();
        let pos = vec![Position {
            symbol: "BTCUSDT".to_string(),
            quantity: 1.0,
            entry_price: 50000.0,
            side: Side::Long,
            leverage: 10.0,
        }];
        
        let mut prices = HashMap::new();
        prices.insert("BTCUSDT".to_string(), 45000.0);
        
        let result = engine.calculate_risk(&pos, 50000.0, &prices);
        
        assert!(matches!(result.risk_level, RiskLevel::High | RiskLevel::Critical));
    }
}