//! Tokenised US Treasury bonds for TigerEx.
//!
//! A bond's yield is supplied by the caller from the real curve; nothing is
//! hard-coded. Maturities, face values and yields are validated.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct TreasuryBond {
    /// Term in years.
    pub maturity_years: u32,
    /// Annualised yield as a fraction, e.g. 0.045 for 4.5%.
    pub yield_rate: f64,
    pub face_value: f64,
    pub cusip: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TreasuryError {
    EmptyCusip,
    InvalidMaturity(u32),
    InvalidYield(f64),
    InvalidFaceValue(f64),
    UnknownBond(String),
    DuplicateCusip(String),
}

impl std::fmt::Display for TreasuryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TreasuryError::EmptyCusip => write!(f, "cusip must not be empty"),
            TreasuryError::InvalidMaturity(years) => write!(f, "maturity {years}y is out of range"),
            TreasuryError::InvalidYield(rate) => write!(f, "yield {rate} must be positive and finite"),
            TreasuryError::InvalidFaceValue(value) => {
                write!(f, "face value {value} must be positive and finite")
            }
            TreasuryError::UnknownBond(id) => write!(f, "unknown bond: {id}"),
            TreasuryError::DuplicateCusip(cusip) => write!(f, "bond {cusip} already exists"),
        }
    }
}

impl std::error::Error for TreasuryError {}

/// Maturities the exchange lists, in years.
const SUPPORTED_MATURITIES: [u32; 6] = [1, 2, 3, 5, 7, 10];

pub struct USTreasuryTokenService {
    bonds: RwLock<HashMap<String, TreasuryBond>>,
}

impl Default for USTreasuryTokenService {
    fn default() -> Self {
        Self::new()
    }
}

impl USTreasuryTokenService {
    pub fn new() -> Self {
        Self {
            bonds: RwLock::new(HashMap::new()),
        }
    }

    /// Register a bond. The yield must come from the live curve.
    pub fn mint(
        &self,
        cusip: &str,
        maturity_years: u32,
        face_value: f64,
        yield_rate: f64,
    ) -> Result<String, TreasuryError> {
        if cusip.trim().is_empty() {
            return Err(TreasuryError::EmptyCusip);
        }
        if !SUPPORTED_MATURITIES.contains(&maturity_years) {
            return Err(TreasuryError::InvalidMaturity(maturity_years));
        }
        if !yield_rate.is_finite() || yield_rate <= 0.0 || yield_rate >= 1.0 {
            return Err(TreasuryError::InvalidYield(yield_rate));
        }
        if !face_value.is_finite() || face_value <= 0.0 {
            return Err(TreasuryError::InvalidFaceValue(face_value));
        }

        let mut bonds = self.bonds.write().unwrap();
        if bonds.contains_key(cusip) {
            return Err(TreasuryError::DuplicateCusip(cusip.to_string()));
        }

        bonds.insert(
            cusip.to_string(),
            TreasuryBond {
                maturity_years,
                yield_rate,
                face_value,
                cusip: cusip.to_string(),
            },
        );
        Ok(cusip.to_string())
    }

    pub fn bond(&self, cusip: &str) -> Option<TreasuryBond> {
        self.bonds.read().unwrap().get(cusip).cloned()
    }

    /// Price a bond using the standard present-value formula for a semi-annual
    /// coupon bond, where the coupon equals the yield (priced at par adjusted
    /// for the compounding convention).
    pub fn price(&self, cusip: &str) -> Result<f64, TreasuryError> {
        let bonds = self.bonds.read().unwrap();
        let bond = bonds
            .get(cusip)
            .ok_or_else(|| TreasuryError::UnknownBond(cusip.to_string()))?;

        let periods = bond.maturity_years * 2;
        let coupon = bond.face_value * bond.yield_rate / 2.0;
        let rate = bond.yield_rate / 2.0;
        let mut price = 0.0;
        for period in 1..=periods {
            price += coupon / (1.0 + rate).powi(period as i32);
        }
        price += bond.face_value / (1.0 + rate).powi(periods as i32);
        Ok(price)
    }

    /// Accrued value of `units` of face value after `days` at the bond yield.
    pub fn accrued(&self, cusip: &str, units: f64, days: u32) -> Result<f64, TreasuryError> {
        if !units.is_finite() || units <= 0.0 {
            return Err(TreasuryError::InvalidFaceValue(units));
        }
        let bonds = self.bonds.read().unwrap();
        let bond = bonds
            .get(cusip)
            .ok_or_else(|| TreasuryError::UnknownBond(cusip.to_string()))?;
        let notional = units * bond.face_value;
        Ok(notional * bond.yield_rate * (days as f64 / 365.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_bonds() {
        let service = USTreasuryTokenService::new();
        assert_eq!(service.mint("", 10, 1000.0, 0.045).unwrap_err(), TreasuryError::EmptyCusip);
        assert!(matches!(
            service.mint("A", 4, 1000.0, 0.045).unwrap_err(),
            TreasuryError::InvalidMaturity(4)
        ));
        assert!(matches!(
            service.mint("A", 10, 1000.0, -0.01).unwrap_err(),
            TreasuryError::InvalidYield(_)
        ));
        assert!(matches!(
            service.mint("A", 10, 0.0, 0.045).unwrap_err(),
            TreasuryError::InvalidFaceValue(_)
        ));
    }

    #[test]
    fn rejects_duplicate_cusip() {
        let service = USTreasuryTokenService::new();
        service.mint("912796", 10, 1000.0, 0.045).unwrap();
        assert!(matches!(
            service.mint("912796", 10, 1000.0, 0.05).unwrap_err(),
            TreasuryError::DuplicateCusip(_)
        ));
    }

    #[test]
    fn prices_at_par_when_coupon_equals_yield() {
        let service = USTreasuryTokenService::new();
        service.mint("912796", 10, 1000.0, 0.05).unwrap();
        // Semi-annual coupon equal to the yield prices at par.
        assert!((service.price("912796").unwrap() - 1000.0).abs() < 1e-6);
    }

    #[test]
    fn accrual_is_time_weighted() {
        let service = USTreasuryTokenService::new();
        service.mint("912796", 10, 1000.0, 0.05).unwrap();
        // 1 unit face, 365 days at 5% -> 50.
        assert!((service.accrued("912796", 1.0, 365).unwrap() - 50.0).abs() < 1e-9);
    }
}
