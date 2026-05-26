//! TigerEx Derivatives Service
//! Futures and Options Trading

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Perpetual contract definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerpetualContract {
    pub symbol: &'static str,
    pub underlying: &'static str,
    pub max_leverage: u32,
}

/// Initial perpetual contracts
pub fn get_perpetual_contracts() -> Vec<PerpetualContract> {
    vec![
        PerpetualContract {
            symbol: "BTCUSDT-PERP",
            underlying: "BTC",
            max_leverage: 125,
        },
        PerpetualContract {
            symbol: "ETHUSDT-PERP",
            underlying: "ETH",
            max_leverage: 100,
        },
    ]
}

/// Derivative position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub leverage: u32,
    pub margin: f64,
    pub unrealized_pnl: f64,
    pub status: PositionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionSide {
    Long,
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum PositionStatus {
    Open,
    Closed,
    Liquidated,
}

/// OpenPositionRequest
#[derive(Debug, Clone, Deserialize)]
pub struct OpenPositionRequest {
    pub user_id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub price: f64,
    pub leverage: u32,
}

/// FundingRate representation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundingRate {
    pub rate: f64,
    pub next_update: i64,
}

/// DerivativesService handles perpetual contracts
pub struct DerivativesService {
    contracts: HashMap<String, PerpetualContract>,
    positions: HashMap<String, Position>,
}

impl DerivativesService {
    /// Create new derivatives service
    pub fn new() -> Self {
        let contracts = get_perpetual_contracts();
        let mut contract_map = HashMap::new();
        
        for contract in contracts {
            contract_map.insert(contract.symbol.to_string(), contract);
        }
        
        Self {
            contracts: contract_map,
            positions: HashMap::new(),
        }
    }

    /// Open a position
    pub fn open_position(&mut self, req: OpenPositionRequest) -> Result<Position, String> {
        let contract = self.contracts
            .get(&req.symbol)
            .ok_or_else(|| "Unknown contract".to_string())?;
        
        if req.leverage > contract.max_leverage {
            return Err("Max leverage exceeded".to_string());
        }
        
        let margin = (req.price * req.quantity) / req.leverage as f64;
        
        let position = Position {
            id: generate_uuid(),
            user_id: req.user_id,
            symbol: req.symbol,
            side: req.side,
            quantity: req.quantity,
            entry_price: req.price,
            leverage: req.leverage,
            margin,
            unrealized_pnl: 0.0,
            status: PositionStatus::Open,
        };
        
        let id = position.id.clone();
        self.positions.insert(id, position.clone());
        
        Ok(position)
    }

    /// Get funding rate for symbol
    pub fn get_funding_rate(&self, symbol: &str) -> Result<FundingRate, String> {
        // Would fetch from oracle in production
        Ok(FundingRate {
            rate: 0.0001,
            next_update: current_timestamp() + 28800000,
        })
    }

    /// Get position by ID
    pub fn get_position(&self, id: &str) -> Option<&Position> {
        self.positions.get(id)
    }

    /// Close position
    pub fn close_position(&mut self, id: &str) -> Result<Position, String> {
        let position = self.positions
            .get_mut(id)
            .ok_or_else(|| "Position not found".to_string())?;
        
        position.status = PositionStatus::Closed;
        
        Ok(position.clone())
    }

    /// Calculate unrealized PnL
    pub fn calculate_unrealized_pnl(&self, id: &str, current_price: f64) -> f64 {
        let position = match self.positions.get(id) {
            Some(p) => p,
            None => return 0.0,
        };
        
        let pnl = match position.side {
            PositionSide::Long => current_price - position.entry_price,
            PositionSide::Short => position.entry_price - current_price,
        };
        
        pnl * position.quantity
    }
}

impl Default for DerivativesService {
    fn default() -> Self {
        Self::new()
    }
}

/// Option contract
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionContract {
    pub id: String,
    pub symbol: String,
    pub underlying: String,
    pub strike_price: f64,
    pub expiry: i64,
    pub option_type: OptionType,
    pub premium: f64,
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OptionType {
    Call,
    Put,
}

/// OptionsService handles options trading
pub struct OptionsService {
    options: HashMap<String, OptionContract>,
}

impl OptionsService {
    pub fn new() -> Self {
        Self {
            options: HashMap::new(),
        }
    }

    /// Buy an option
    pub fn buy_option(&mut self, params: BuyOptionParams) -> Result<OptionContract, String> {
        let premium = params.price * params.quantity;
        
        let option = OptionContract {
            id: generate_uuid(),
            symbol: params.symbol.clone(),
            underlying: params.underlying.clone(),
            strike_price: params.strike_price,
            expiry: params.expiry,
            option_type: params.option_type,
            premium,
            status: "OPEN".to_string(),
        };
        
        let id = option.id.clone();
        self.options.insert(id, option.clone());
        
        Ok(option)
    }

    /// Exercise an option
    pub fn exercise(&self, option_id: &str, current_price: f64) -> Result<f64, String> {
        let option = self.options
            .get(option_id)
            .ok_or_else(|| "Option not found".to_string())?;
        
        let intrinsic_value = match option.option_type {
            OptionType::Call => (current_price - option.strike_price).max(0.0),
            OptionType::Put => (option.strike_price - current_price).max(0.0),
        };
        
        Ok(intrinsic_value * 100.0) // Would multiply by contract size
    }
}

impl Default for OptionsService {
    fn default() -> Self {
        Self::new()
    }
}

/// Parameters for buying an option
#[derive(Debug, Clone, Deserialize)]
pub struct BuyOptionParams {
    pub user_id: String,
    pub symbol: String,
    pub underlying: String,
    pub strike_price: f64,
    pub quantity: f64,
    pub price: f64,
    pub expiry: i64,
    pub option_type: OptionType,
}

/// Helpers
fn generate_uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    
    format!("{:x}-{:x}", timestamp, rand_u64())
}

fn rand_u64() -> u64 {
    // Simplified - would use proper randomness
    1234567890
}

fn current_timestamp() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_position() {
        let mut service = DerivativesService::new();
        
        let req = OpenPositionRequest {
            user_id: "user1".to_string(),
            symbol: "BTCUSDT-PERP".to_string(),
            side: PositionSide::Long,
            quantity: 0.1,
            price: 50000.0,
            leverage: 10,
        };
        
        let position = service.open_position(req).unwrap();
        
        assert_eq!(position.margin, 500.0);
        assert_eq!(position.status, PositionStatus::Open);
    }
}