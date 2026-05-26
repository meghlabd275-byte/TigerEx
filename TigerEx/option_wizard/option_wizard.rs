//! Option Wizard - Smart options strategy builder
//! Migration from TypeScript to Rust

use std::collections::HashMap;

/// Option type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionType {
    Call,
    Put,
}

/// Option side
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionSide {
    Buy,
    Sell,
}

/// Option leg
#[derive(Debug, Clone)]
pub struct OptionLeg {
    pub option_type: OptionType,
    pub side: OptionSide,
    pub strike: f64,
    pub expiry: i64,
    pub quantity: f64,
}

/// Strategy
#[derive(Debug, Clone)]
pub struct Strategy {
    pub id: String,
    pub name: String,
    pub legs: Vec<OptionLeg>,
    pub max_profit: f64,
    pub max_loss: f64,
    pub breakeven: Vec<f64>,
    pub cost: f64,
}

/// Option wizard
#[derive(Default)]
pub struct OptionWizard {
    strategies: HashMap<String, Strategy>,
    counter: u64,
}

impl OptionWizard {
    /// Create new wizard
    pub fn new() -> Self {
        Self::default()
    }

    /// Build covered call strategy
    pub fn build_covered_call(&mut self, strike: f64, expiry: i64, budget: f64) -> Strategy {
        self.counter += 1;
        let id = format!("strategy_{}", self.counter);
        
        let cost = strike * 0.1; // Premium
        
        let strategy = Strategy {
            id: id.clone(),
            name: "Covered Call".to_string(),
            legs: vec![OptionLeg {
                option_type: OptionType::Call,
                side: OptionSide::Sell,
                strike,
                expiry,
                quantity: 1.0,
            }],
            max_profit: strike * 0.3, // Cap at 30%
            max_loss: cost,
            breakeven: vec![strike - cost],
            cost,
        };
        
        self.strategies.insert(id, strategy.clone());
        strategy
    }

    /// Build protective put strategy
    pub fn build_protective_put(&mut self, strike: f64, expiry: i64, budget: f64) -> Strategy {
        self.counter += 1;
        let id = format!("strategy_{}", self.counter);
        
        let cost = strike * 0.05;
        
        let strategy = Strategy {
            id: id.clone(),
            name: "Protective Put".to_string(),
            legs: vec![OptionLeg {
                option_type: OptionType::Put,
                side: OptionSide::Buy,
                strike,
                expiry,
                quantity: 1.0,
            }],
            max_profit: f64::MAX,
            max_loss: cost + (strike * 0.1),
            breakeven: vec![strike + cost],
            cost,
        };
        
        self.strategies.insert(id, strategy.clone());
        strategy
    }

    /// Build straddle
    pub fn build_straddle(&mut self, strike: f64, expiry: i64, budget: f64) -> Strategy {
        self.counter += 1;
        let id = format!("strategy_{}", self.counter);
        
        let call_cost = strike * 0.05;
        let put_cost = strike * 0.05;
        let total_cost = call_cost + put_cost;
        
        let strategy = Strategy {
            id: id.clone(),
            name: "Long Straddle".to_string(),
            legs: vec![
                OptionLeg {
                    option_type: OptionType::Call,
                    side: OptionSide::Buy,
                    strike,
                    expiry,
                    quantity: 1.0,
                },
                OptionLeg {
                    option_type: OptionType::Put,
                    side: OptionSide::Buy,
                    strike,
                    expiry,
                    quantity: 1.0,
                },
            ],
            max_profit: f64::MAX,
            max_loss: total_cost,
            breakeven: vec![strike - total_cost, strike + total_cost],
            cost: total_cost,
        };
        
        self.strategies.insert(id, strategy.clone());
        strategy
    }

    /// Get strategy
    pub fn get_strategy(&self, id: &str) -> Option<&Strategy> {
        self.strategies.get(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_covered_call() {
        let mut wizard = OptionWizard::new();
        
        let strategy = wizard.build_covered_call(50000.0, 1700000000, 5000.0);
        
        assert_eq!(strategy.name, "Covered Call");
        assert!(strategy.max_profit > 0.0);
    }

    #[test]
    fn test_straddle() {
        let mut wizard = OptionWizard::new();
        
        let strategy = wizard.build_straddle(50000.0, 1700000000, 5000.0);
        
        assert_eq!(strategy.legs.len(), 2);
    }
}