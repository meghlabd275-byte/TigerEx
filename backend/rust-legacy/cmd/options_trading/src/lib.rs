//! TigerEx Options Trading Service - Rust
//! Handles options contract trading

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Option type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OptionType {
    Call,
    Put,
}

/// Option contract
#[derive(Debug, Clone)]
pub struct OptionContract {
    pub id: String,
    pub underlying: String,
    pub strike_price: f64,
    pub expiry: u64,
    pub option_type: OptionType,
    pub contract_size: f64,
    pub is_settled: bool,
}

impl OptionContract {
    pub fn new(underlying: &str, strike: f64, expiry: u64, option_type: OptionType) -> Self {
        Self {
            id: generate_id(),
            underlying: underlying.to_string(),
            strike_price: strike,
            expiry,
            option_type,
            contract_size: 100.0,
            is_settled: false,
        }
    }

    /// Calculate intrinsic value
    pub fn intrinsic_value(&self, spot_price: f64) -> f64 {
        match self.option_type {
            OptionType::Call => (spot_price - self.strike_price).max(0.0) * self.contract_size,
            OptionType::Put => (self.strike_price - spot_price).max(0.0) * self.contract_size,
        }
    }

    /// Check if expired
    pub fn is_expired(&self) -> bool {
        current_timestamp() > self.expiry
    }
}

/// Option position
#[derive(Debug, Clone)]
pub struct OptionPosition {
    pub contract_id: String,
    pub user_id: String,
    pub quantity: f64,
    pub entry_premium: f64,
    pub status: PositionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PositionStatus {
    Open,
    Exercised,
    Expired,
    Closed,
}

/// Options trading service
pub struct OptionsTradingService {
    contracts: RwLock<Vec<OptionContract>>,
    positions: RwLock<HashMap<String, Vec<OptionPosition>>>,
    prices: RwLock<HashMap<String, f64>>,
}

impl OptionsTradingService {
    pub fn new() -> Self {
        Self {
            contracts: RwLock::new(Vec::new()),
            prices: RwLock::new(HashMap::new()),
            positions: RwLock::new(HashMap::new()),
        }
    }

    /// Buy option contract
    pub fn buy_option(
        &self,
        user_id: &str,
        underlying: &str,
        strike_price: f64,
        expiry: u64,
        option_type: OptionType,
        premium: f64,
        quantity: f64,
    ) -> Result<OptionPosition, String> {
        let contract = OptionContract::new(underlying, strike_price, expiry, option_type);
        let contract_id = contract.id.clone();

        let position = OptionPosition {
            contract_id: contract_id.clone(),
            user_id: user_id.to_string(),
            quantity,
            entry_premium: premium,
            status: PositionStatus::Open,
        };

        // Store contract
        let mut contracts = self.contracts.write().unwrap();
        contracts.push(contract);

        // Store position
        let mut positions = self.positions.write().unwrap();
        positions
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(position.clone());

        Ok(position)
    }

    /// Exercise option
    pub fn exercise(&self, user_id: &str, contract_id: &str) -> Result<f64, String> {
        // Get underlying price
        let contract = {
            let contracts = self.contracts.read().unwrap();
            contracts.iter().find(|c| c.id == contract_id).cloned()
        };

        let contract = contract.ok_or("Contract not found")?;

        // Get spot price
        let prices = self.prices.read().unwrap();
        let spot_price = prices.get(&contract.underlying).ok_or("No spot price")?;

        // Calculate payout
        let payout = contract.intrinsic_value(spot_price);

        // Update position status
        let mut positions = self.positions.write().unwrap();
        
        if let Some(user_positions) = positions.get_mut(user_id) {
            if let Some(pos) = user_positions.iter_mut().find(|p| p.contract_id == contract_id) {
                pos.status = PositionStatus::Exercised;
            }
        }

        Ok(payout)
    }

    /// Update spot price
    pub fn update_spot_price(&self, symbol: &str, price: f64) {
        let mut prices = self.prices.write().unwrap();
        prices.insert(symbol.to_string(), price);
    }

    /// Get user's positions
    pub fn get_positions(&self, user_id: &str) -> Vec<OptionPosition> {
        let positions = self.positions.read().unwrap();
        positions.get(user_id).cloned().unwrap_or_default()
    }

    /// List available strikes
    pub fn get_strikes(&self, underlying: &str) -> Vec<f64> {
        let contracts = self.contracts.read().unwrap();
        let mut strikes: Vec<f64> = contracts
            .iter()
            .filter(|c| c.underlying == underlying)
            .map(|c| c.strike_price)
            .collect();
        
        strikes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        strikes.dedup();
        strikes
    }
}

impl Default for OptionsTradingService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("opt_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buy_option() {
        let service = OptionsTradingService::new();
        
        let expiry = current_timestamp() + 86400000; // 1 day
        
        let result = service.buy_option(
            "user1",
            "BTC",
            50000.0,
            expiry,
            OptionType::Call,
            500.0,
            1.0,
        ).unwrap();
        
        assert_eq!(result.status, PositionStatus::Open);
    }
}