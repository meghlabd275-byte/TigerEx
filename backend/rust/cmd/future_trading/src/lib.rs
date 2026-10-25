//! Futures positions.
//!
//! The previous implementation ignored the contract size when computing PnL,
//! took `side` as a free-form string (so a typo silently became a short), let
//! `close_position` return a stale `unrealized_pnl` that was zero unless
//! `update_prices` had been called, and generated ids from the nanosecond
//! clock.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Contract {
    pub symbol: String,
    pub underlying: String,
    /// Delivery timestamp; 0 for a perpetual.
    pub expiry: u64,
    /// Units of the underlying per contract.
    pub contract_size: f64,
    pub max_leverage: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FuturesPosition {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    /// Number of contracts.
    pub size: f64,
    pub entry_price: f64,
    pub leverage: u32,
    /// Margin posted: notional divided by leverage.
    pub margin: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FuturesError {
    EmptyUser,
    UnknownContract(String),
    DuplicateContract(String),
    InvalidSize(f64),
    InvalidPrice(f64),
    InvalidContractSize(f64),
    InvalidLeverage(u32),
    LeverageTooHigh { requested: u32, max: u32 },
    UnknownPosition(String),
}

impl std::fmt::Display for FuturesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FuturesError::EmptyUser => write!(f, "user id must not be empty"),
            FuturesError::UnknownContract(s) => write!(f, "unknown contract: {s}"),
            FuturesError::DuplicateContract(s) => write!(f, "contract {s} is already listed"),
            FuturesError::InvalidSize(s) => write!(f, "size {s} must be finite and positive"),
            FuturesError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            FuturesError::InvalidContractSize(s) => {
                write!(f, "contract size {s} must be finite and positive")
            }
            FuturesError::InvalidLeverage(l) => write!(f, "leverage {l} must be at least 1"),
            FuturesError::LeverageTooHigh { requested, max } => {
                write!(f, "leverage {requested} exceeds the maximum of {max}")
            }
            FuturesError::UnknownPosition(id) => write!(f, "unknown position: {id}"),
        }
    }
}

impl std::error::Error for FuturesError {}

pub struct FuturesService {
    contracts: RwLock<HashMap<String, Contract>>,
    positions: RwLock<HashMap<String, FuturesPosition>>,
    next_id: RwLock<u64>,
}

impl FuturesService {
    pub fn new() -> Self {
        Self {
            contracts: RwLock::new(HashMap::new()),
            positions: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// List a contract. The symbol must be unique.
    pub fn list_contract(
        &self,
        symbol: &str,
        underlying: &str,
        expiry: u64,
        contract_size: f64,
        max_leverage: u32,
    ) -> Result<(), FuturesError> {
        if !contract_size.is_finite() || contract_size <= 0.0 {
            return Err(FuturesError::InvalidContractSize(contract_size));
        }
        if max_leverage == 0 {
            return Err(FuturesError::InvalidLeverage(max_leverage));
        }

        let mut contracts = self.contracts.write().unwrap();
        if contracts.contains_key(symbol) {
            return Err(FuturesError::DuplicateContract(symbol.to_string()));
        }
        contracts.insert(
            symbol.to_string(),
            Contract {
                symbol: symbol.to_string(),
                underlying: underlying.to_string(),
                expiry,
                contract_size,
                max_leverage,
            },
        );
        Ok(())
    }

    pub fn contract(&self, symbol: &str) -> Option<Contract> {
        self.contracts.read().unwrap().get(symbol).cloned()
    }

    /// Open a position.
    pub fn open_position(
        &self,
        user_id: &str,
        symbol: &str,
        side: Side,
        size: f64,
        entry_price: f64,
        leverage: u32,
    ) -> Result<FuturesPosition, FuturesError> {
        if user_id.trim().is_empty() {
            return Err(FuturesError::EmptyUser);
        }
        if !size.is_finite() || size <= 0.0 {
            return Err(FuturesError::InvalidSize(size));
        }
        if !entry_price.is_finite() || entry_price <= 0.0 {
            return Err(FuturesError::InvalidPrice(entry_price));
        }
        if leverage == 0 {
            return Err(FuturesError::InvalidLeverage(leverage));
        }

        let contract = self
            .contracts
            .read()
            .unwrap()
            .get(symbol)
            .cloned()
            .ok_or_else(|| FuturesError::UnknownContract(symbol.to_string()))?;

        if leverage > contract.max_leverage {
            return Err(FuturesError::LeverageTooHigh {
                requested: leverage,
                max: contract.max_leverage,
            });
        }

        let notional = size * contract.contract_size * entry_price;
        let margin = notional / f64::from(leverage);

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("fut_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let position = FuturesPosition {
            id: id.clone(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side,
            size,
            entry_price,
            leverage,
            margin,
        };
        self.positions
            .write()
            .unwrap()
            .insert(id, position.clone());
        Ok(position)
    }

    /// PnL for a position at `current_price`, scaled by the contract size.
    pub fn unrealized_pnl(
        &self,
        position_id: &str,
        current_price: f64,
    ) -> Result<f64, FuturesError> {
        if !current_price.is_finite() || current_price <= 0.0 {
            return Err(FuturesError::InvalidPrice(current_price));
        }
        let positions = self.positions.read().unwrap();
        let position = positions
            .get(position_id)
            .ok_or_else(|| FuturesError::UnknownPosition(position_id.to_string()))?;
        let contract_size = self
            .contracts
            .read()
            .unwrap()
            .get(&position.symbol)
            .map(|c| c.contract_size)
            .ok_or_else(|| FuturesError::UnknownContract(position.symbol.clone()))?;

        Ok(Self::pnl(position, current_price, contract_size))
    }

    fn pnl(position: &FuturesPosition, current_price: f64, contract_size: f64) -> f64 {
        let direction = match position.side {
            Side::Long => current_price - position.entry_price,
            Side::Short => position.entry_price - current_price,
        };
        direction * position.size * contract_size
    }

    /// Close a position at `exit_price`, returning the realised PnL.
    pub fn close_position(
        &self,
        position_id: &str,
        exit_price: f64,
    ) -> Result<f64, FuturesError> {
        if !exit_price.is_finite() || exit_price <= 0.0 {
            return Err(FuturesError::InvalidPrice(exit_price));
        }
        let position = {
            let mut positions = self.positions.write().unwrap();
            positions
                .remove(position_id)
                .ok_or_else(|| FuturesError::UnknownPosition(position_id.to_string()))?
        };
        let contract_size = self
            .contracts
            .read()
            .unwrap()
            .get(&position.symbol)
            .map(|c| c.contract_size)
            .ok_or_else(|| FuturesError::UnknownContract(position.symbol.clone()))?;

        Ok(Self::pnl(&position, exit_price, contract_size))
    }

    pub fn position(&self, id: &str) -> Option<FuturesPosition> {
        self.positions.read().unwrap().get(id).cloned()
    }

    pub fn open_count(&self) -> usize {
        self.positions.read().unwrap().len()
    }
}

impl Default for FuturesService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> FuturesService {
        let s = FuturesService::new();
        // 1 contract = 0.01 BTC.
        s.list_contract("BTC-PERP", "BTC", 0, 0.01, 125).unwrap();
        s
    }

    #[test]
    fn pnl_is_scaled_by_the_contract_size() {
        let svc = svc();
        let p = svc
            .open_position("alice", "BTC-PERP", Side::Long, 100.0, 50_000.0, 10)
            .unwrap();

        // 100 contracts * 0.01 BTC * 1,000 move = 1,000.
        assert_eq!(svc.unrealized_pnl(&p.id, 51_000.0).unwrap(), 1_000.0);
        assert_eq!(svc.close_position(&p.id, 51_000.0).unwrap(), 1_000.0);
    }

    #[test]
    fn margin_is_notional_over_leverage() {
        let svc = svc();
        let p = svc
            .open_position("alice", "BTC-PERP", Side::Long, 100.0, 50_000.0, 10)
            .unwrap();

        // Notional = 100 * 0.01 * 50,000 = 50,000; at 10x -> 5,000.
        assert_eq!(p.margin, 5_000.0);
    }

    #[test]
    fn long_and_short_pnl_have_opposite_signs() {
        let svc = svc();
        let long = svc
            .open_position("alice", "BTC-PERP", Side::Long, 10.0, 50_000.0, 5)
            .unwrap();
        let short = svc
            .open_position("bob", "BTC-PERP", Side::Short, 10.0, 50_000.0, 5)
            .unwrap();

        assert!(svc.unrealized_pnl(&long.id, 51_000.0).unwrap() > 0.0);
        assert!(svc.unrealized_pnl(&short.id, 51_000.0).unwrap() < 0.0);
    }

    #[test]
    fn closing_an_unknown_contract_is_rejected() {
        let svc = svc();
        assert!(matches!(
            svc.open_position("alice", "NOPE", Side::Long, 1.0, 100.0, 1).unwrap_err(),
            FuturesError::UnknownContract(_)
        ));
    }

    #[test]
    fn leverage_is_capped_by_the_contract() {
        let svc = svc();
        assert!(matches!(
            svc.open_position("alice", "BTC-PERP", Side::Long, 1.0, 100.0, 200).unwrap_err(),
            FuturesError::LeverageTooHigh { .. }
        ));
        assert!(svc.open_position("alice", "BTC-PERP", Side::Long, 1.0, 100.0, 0).is_err());
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = svc();
        assert!(svc.open_position("", "BTC-PERP", Side::Long, 1.0, 100.0, 1).is_err());
        assert!(svc.open_position("alice", "BTC-PERP", Side::Long, -1.0, 100.0, 1).is_err());
        assert!(svc.open_position("alice", "BTC-PERP", Side::Long, 1.0, f64::NAN, 1).is_err());
        assert!(svc.list_contract("X", "X", 0, 0.0, 10).is_err());
        assert!(matches!(
            svc.list_contract("BTC-PERP", "BTC", 0, 0.01, 125).unwrap_err(),
            FuturesError::DuplicateContract(_)
        ));
    }

    #[test]
    fn ids_are_unique() {
        let svc = svc();
        let a = svc
            .open_position("alice", "BTC-PERP", Side::Long, 1.0, 100.0, 1)
            .unwrap();
        let b = svc
            .open_position("alice", "BTC-PERP", Side::Long, 1.0, 100.0, 1)
            .unwrap();
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn closing_removes_the_position() {
        let svc = svc();
        let p = svc
            .open_position("alice", "BTC-PERP", Side::Long, 1.0, 100.0, 1)
            .unwrap();
        assert_eq!(svc.open_count(), 1);

        svc.close_position(&p.id, 110.0).unwrap();
        assert_eq!(svc.open_count(), 0);
        assert!(svc.close_position(&p.id, 110.0).is_err());
    }
}
