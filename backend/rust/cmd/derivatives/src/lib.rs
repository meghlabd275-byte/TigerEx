//! Derivative clearing and initial-margin calculation.
//!
//! The previous implementation returned a formatted string from `clear` and
//! charged a flat 10% of notional as margin for every contract type, ignoring
//! the contract's actual risk parameters and accepting any notional.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Contract {
    pub symbol: String,
    /// Initial margin as a fraction of notional.
    pub initial_margin_rate: f64,
    /// Maintenance margin as a fraction of notional.
    pub maintenance_margin_rate: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClearingRecord {
    pub id: String,
    pub symbol: String,
    pub notional: f64,
    pub initial_margin: f64,
    pub maintenance_margin: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DerivativeError {
    InvalidNotional(f64),
    UnknownContract(String),
    InvalidMarginRate(f64),
}

impl std::fmt::Display for DerivativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DerivativeError::InvalidNotional(n) => {
                write!(f, "notional {n} must be finite and positive")
            }
            DerivativeError::UnknownContract(s) => write!(f, "unknown contract: {s}"),
            DerivativeError::InvalidMarginRate(r) => {
                write!(f, "margin rate {r} must be finite and within (0, 1)")
            }
        }
    }
}

impl std::error::Error for DerivativeError {}

pub struct DerivativesService {
    contracts: RwLock<HashMap<String, Contract>>,
    cleared: RwLock<Vec<ClearingRecord>>,
    next_id: RwLock<u64>,
}

impl DerivativesService {
    pub fn new() -> Self {
        Self {
            contracts: RwLock::new(HashMap::new()),
            cleared: RwLock::new(Vec::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Register a contract with its real margin parameters.
    pub fn register_contract(
        &self,
        symbol: &str,
        initial_margin_rate: f64,
        maintenance_margin_rate: f64,
    ) -> Result<(), DerivativeError> {
        for rate in [initial_margin_rate, maintenance_margin_rate] {
            if !rate.is_finite() || rate <= 0.0 || rate >= 1.0 {
                return Err(DerivativeError::InvalidMarginRate(rate));
            }
        }
        if maintenance_margin_rate > initial_margin_rate {
            return Err(DerivativeError::InvalidMarginRate(maintenance_margin_rate));
        }
        self.contracts.write().unwrap().insert(
            symbol.to_string(),
            Contract {
                symbol: symbol.to_string(),
                initial_margin_rate,
                maintenance_margin_rate,
            },
        );
        Ok(())
    }

    /// Margin required for a notional on a contract.
    pub fn margin_calc(
        &self,
        contract_type: &str,
        notional: f64,
    ) -> Result<(f64, f64), DerivativeError> {
        if !notional.is_finite() || notional <= 0.0 {
            return Err(DerivativeError::InvalidNotional(notional));
        }
        let contracts = self.contracts.read().unwrap();
        let contract = contracts
            .get(contract_type)
            .ok_or_else(|| DerivativeError::UnknownContract(contract_type.to_string()))?;
        Ok((
            notional * contract.initial_margin_rate,
            notional * contract.maintenance_margin_rate,
        ))
    }

    /// Clear a position, recording the margin held.
    pub fn clear(&self, contract: &str, notional: f64) -> Result<ClearingRecord, DerivativeError> {
        let (initial_margin, maintenance_margin) = self.margin_calc(contract, notional)?;

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("clr_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let record = ClearingRecord {
            id,
            symbol: contract.to_string(),
            notional,
            initial_margin,
            maintenance_margin,
        };
        self.cleared.write().unwrap().push(record.clone());
        Ok(record)
    }

    pub fn cleared_count(&self) -> usize {
        self.cleared.read().unwrap().len()
    }

    pub fn contract(&self, symbol: &str) -> Option<Contract> {
        self.contracts.read().unwrap().get(symbol).cloned()
    }
}

impl Default for DerivativesService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> DerivativesService {
        let s = DerivativesService::new();
        s.register_contract("BTC-PERP", 0.01, 0.005).unwrap();
        s
    }

    #[test]
    fn margin_uses_the_contract_rates_not_a_constant() {
        let s = svc();
        let (initial, maintenance) = s.margin_calc("BTC-PERP", 100_000.0).unwrap();

        // The old implementation always returned 10% of notional.
        assert_eq!(initial, 1_000.0);
        assert_eq!(maintenance, 500.0);
    }

    #[test]
    fn clearing_records_the_margin() {
        let s = svc();
        let record = s.clear("BTC-PERP", 50_000.0).unwrap();

        assert_eq!(record.initial_margin, 500.0);
        assert_eq!(record.maintenance_margin, 250.0);
        assert_eq!(s.cleared_count(), 1);
        // The old clear returned a formatted string and recorded nothing.
        assert!(record.id.starts_with("clr_"));
    }

    #[test]
    fn invalid_notionals_are_rejected() {
        let s = svc();
        assert!(s.margin_calc("BTC-PERP", -1.0).is_err());
        assert!(s.margin_calc("BTC-PERP", f64::NAN).is_err());
        assert!(s.clear("BTC-PERP", 0.0).is_err());
        assert_eq!(s.cleared_count(), 0);
    }

    #[test]
    fn unknown_contracts_are_rejected() {
        let s = svc();
        assert!(s.margin_calc("NOPE", 1.0).is_err());
        assert!(s.clear("NOPE", 1.0).is_err());
    }

    #[test]
    fn invalid_margin_rates_are_rejected() {
        let s = DerivativesService::new();
        assert!(s.register_contract("X", 0.0, 0.005).is_err());
        assert!(s.register_contract("X", 1.5, 0.005).is_err());
        // Maintenance must not exceed initial.
        assert!(s.register_contract("X", 0.005, 0.01).is_err());
    }
}
