//! Bond issuance and quoting.
//!
//! The previous implementation derived the bond id from the issuer name, so a
//! second issue by the same issuer silently overwrote the first, hardcoded
//! every bond's price at 100.0, and accepted negative coupons and zero
//! maturities.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Bond {
    pub id: String,
    pub issuer: String,
    /// Annual coupon rate as a fraction, e.g. 0.05 for 5%.
    pub coupon: f64,
    /// Term in years.
    pub maturity: u32,
    /// Clean price as a percentage of par.
    pub price: f64,
    /// Face value outstanding.
    pub face_value: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BondError {
    EmptyIssuer,
    InvalidCoupon(f64),
    InvalidMaturity(u32),
    InvalidPrice(f64),
    InvalidFaceValue(f64),
    UnknownBond(String),
}

impl std::fmt::Display for BondError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BondError::EmptyIssuer => write!(f, "issuer must not be empty"),
            BondError::InvalidCoupon(c) => write!(f, "coupon {c} must be finite and non-negative"),
            BondError::InvalidMaturity(m) => write!(f, "maturity {m} must be at least one year"),
            BondError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            BondError::InvalidFaceValue(v) => write!(f, "face value {v} must be finite and positive"),
            BondError::UnknownBond(id) => write!(f, "unknown bond: {id}"),
        }
    }
}

impl std::error::Error for BondError {}

pub struct BondMarketService {
    bonds: RwLock<HashMap<String, Bond>>,
    next_id: RwLock<u64>,
}

impl BondMarketService {
    pub fn new() -> Self {
        Self {
            bonds: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Issue a bond at par (price 100) with the given coupon and maturity.
    pub fn issue(
        &self,
        issuer: &str,
        coupon: f64,
        maturity: u32,
        face_value: f64,
    ) -> Result<String, BondError> {
        if issuer.trim().is_empty() {
            return Err(BondError::EmptyIssuer);
        }
        if !coupon.is_finite() || coupon < 0.0 {
            return Err(BondError::InvalidCoupon(coupon));
        }
        if maturity == 0 {
            return Err(BondError::InvalidMaturity(maturity));
        }
        if !face_value.is_finite() || face_value <= 0.0 {
            return Err(BondError::InvalidFaceValue(face_value));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("bond_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.bonds.write().unwrap().insert(
            id.clone(),
            Bond {
                id: id.clone(),
                issuer: issuer.to_string(),
                coupon,
                maturity,
                price: 100.0,
                face_value,
            },
        );
        Ok(id)
    }

    /// Record a traded price for a bond.
    pub fn update_price(&self, bond_id: &str, price: f64) -> Result<(), BondError> {
        if !price.is_finite() || price <= 0.0 {
            return Err(BondError::InvalidPrice(price));
        }
        let mut bonds = self.bonds.write().unwrap();
        let bond = bonds
            .get_mut(bond_id)
            .ok_or_else(|| BondError::UnknownBond(bond_id.to_string()))?;
        bond.price = price;
        Ok(())
    }

    pub fn quote(&self, bond_id: &str) -> f64 {
        self.bonds
            .read()
            .unwrap()
            .get(bond_id)
            .map(|b| b.price)
            .unwrap_or(0.0)
    }

    pub fn bond(&self, bond_id: &str) -> Option<Bond> {
        self.bonds.read().unwrap().get(bond_id).cloned()
    }

    /// Annual coupon payment on the face value.
    pub fn annual_coupon_payment(&self, bond_id: &str) -> Result<f64, BondError> {
        let bonds = self.bonds.read().unwrap();
        let bond = bonds
            .get(bond_id)
            .ok_or_else(|| BondError::UnknownBond(bond_id.to_string()))?;
        Ok(bond.face_value * bond.coupon)
    }
}

impl Default for BondMarketService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_issues_do_not_overwrite_each_other() {
        let svc = BondMarketService::new();
        let a = svc.issue("Treasury", 0.04, 5, 1_000_000.0).unwrap();
        let b = svc.issue("Treasury", 0.05, 10, 2_000_000.0).unwrap();

        // The old id was the issuer name, so b overwrote a.
        assert_ne!(a, b);
        assert_eq!(svc.bond(&a).unwrap().coupon, 0.04);
        assert_eq!(svc.bond(&b).unwrap().coupon, 0.05);
    }

    #[test]
    fn invalid_issues_are_rejected() {
        let svc = BondMarketService::new();
        assert!(svc.issue("", 0.04, 5, 1_000.0).is_err());
        assert!(svc.issue("T", -0.01, 5, 1_000.0).is_err());
        assert!(svc.issue("T", 0.04, 0, 1_000.0).is_err());
        assert!(svc.issue("T", 0.04, 5, -1_000.0).is_err());
        assert!(svc.issue("T", f64::NAN, 5, 1_000.0).is_err());
    }

    #[test]
    fn prices_can_be_updated_and_validated() {
        let svc = BondMarketService::new();
        let id = svc.issue("T", 0.04, 5, 1_000.0).unwrap();
        assert_eq!(svc.quote(&id), 100.0);

        svc.update_price(&id, 98.5).unwrap();
        assert_eq!(svc.quote(&id), 98.5);

        assert!(svc.update_price(&id, -1.0).is_err());
        assert!(svc.update_price("bond_missing", 100.0).is_err());
    }

    #[test]
    fn coupon_payments_follow_the_face_value() {
        let svc = BondMarketService::new();
        let id = svc.issue("T", 0.05, 10, 1_000_000.0).unwrap();
        assert_eq!(svc.annual_coupon_payment(&id).unwrap(), 50_000.0);
    }

    #[test]
    fn unknown_bonds_quote_zero() {
        let svc = BondMarketService::new();
        assert_eq!(svc.quote("nope"), 0.0);
        assert!(svc.annual_coupon_payment("nope").is_err());
    }
}
