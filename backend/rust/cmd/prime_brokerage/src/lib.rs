//! Prime brokerage accounts.
//!
//! The previous implementation hardcoded a 10% fee discount for every
//! account regardless of tier, derived ids from the account count (so ids
//! were reused), and accepted any tier.

use std::collections::HashMap;
use std::sync::RwLock;

/// Highest supported tier.
pub const MAX_TIER: u8 = 5;

/// Fee discount for a tier, in basis points off the standard fee.
///
/// Tier 0 pays the standard fee; each tier up to `MAX_TIER` takes a further
/// step off.
pub fn discount_for_tier(tier: u8) -> Option<f64> {
    match tier {
        0 => Some(0.0),
        1 => Some(0.05),
        2 => Some(0.10),
        3 => Some(0.20),
        4 => Some(0.30),
        5 => Some(0.40),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrimeAccount {
    pub id: String,
    pub institution: String,
    pub tier: u8,
    pub fee_discount: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PrimeError {
    EmptyInstitution,
    InvalidTier(u8),
    UnknownAccount(String),
}

impl std::fmt::Display for PrimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PrimeError::EmptyInstitution => write!(f, "institution must not be empty"),
            PrimeError::InvalidTier(t) => write!(f, "tier {t} is out of range (0..={MAX_TIER})"),
            PrimeError::UnknownAccount(id) => write!(f, "unknown account: {id}"),
        }
    }
}

impl std::error::Error for PrimeError {}

pub struct PrimeBrokerageService {
    accounts: RwLock<HashMap<String, PrimeAccount>>,
    next_id: RwLock<u64>,
}

impl PrimeBrokerageService {
    pub fn new() -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Onboard an institution at a tier. The fee discount follows from the
    /// tier.
    pub fn onboard(&self, institution: &str, tier: u8) -> Result<String, PrimeError> {
        if institution.trim().is_empty() {
            return Err(PrimeError::EmptyInstitution);
        }
        let fee_discount =
            discount_for_tier(tier).ok_or(PrimeError::InvalidTier(tier))?;

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("prime_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.accounts.write().unwrap().insert(
            id.clone(),
            PrimeAccount {
                id: id.clone(),
                institution: institution.to_string(),
                tier,
                fee_discount,
            },
        );
        Ok(id)
    }

    /// Move an account to a new tier, updating its discount.
    pub fn set_tier(&self, account_id: &str, tier: u8) -> Result<PrimeAccount, PrimeError> {
        let fee_discount = discount_for_tier(tier).ok_or(PrimeError::InvalidTier(tier))?;
        let mut accounts = self.accounts.write().unwrap();
        let account = accounts
            .get_mut(account_id)
            .ok_or_else(|| PrimeError::UnknownAccount(account_id.to_string()))?;
        account.tier = tier;
        account.fee_discount = fee_discount;
        Ok(account.clone())
    }

    pub fn get_tier(&self, account_id: &str) -> u8 {
        self.accounts
            .read()
            .unwrap()
            .get(account_id)
            .map(|a| a.tier)
            .unwrap_or(0)
    }

    pub fn account(&self, account_id: &str) -> Option<PrimeAccount> {
        self.accounts.read().unwrap().get(account_id).cloned()
    }
}

impl Default for PrimeBrokerageService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_discount_follows_the_tier() {
        let svc = PrimeBrokerageService::new();
        let low = svc.onboard("Fund A", 1).unwrap();
        let high = svc.onboard("Fund B", 4).unwrap();

        // The old implementation gave both a flat 10% discount.
        assert_eq!(svc.account(&low).unwrap().fee_discount, 0.05);
        assert_eq!(svc.account(&high).unwrap().fee_discount, 0.30);
        assert_eq!(svc.account(&low).unwrap().fee_discount, 0.05);
        assert_ne!(
            svc.account(&low).unwrap().fee_discount,
            svc.account(&high).unwrap().fee_discount
        );
    }

    #[test]
    fn invalid_tiers_are_rejected() {
        let svc = PrimeBrokerageService::new();
        assert!(svc.onboard("Fund", MAX_TIER + 1).is_err());
        assert!(svc.onboard("Fund", 255).is_err());
        assert!(svc.onboard("", 1).is_err());
    }

    #[test]
    fn tiers_can_be_changed_and_update_the_discount() {
        let svc = PrimeBrokerageService::new();
        let id = svc.onboard("Fund", 0).unwrap();
        assert_eq!(svc.account(&id).unwrap().fee_discount, 0.0);

        let updated = svc.set_tier(&id, 3).unwrap();
        assert_eq!(updated.tier, 3);
        assert_eq!(updated.fee_discount, 0.20);

        assert!(svc.set_tier(&id, 99).is_err());
        assert!(svc.set_tier("prime_missing", 1).is_err());
    }

    #[test]
    fn ids_are_unique() {
        let svc = PrimeBrokerageService::new();
        let a = svc.onboard("A", 1).unwrap();
        let b = svc.onboard("B", 1).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn unknown_accounts_report_tier_zero() {
        let svc = PrimeBrokerageService::new();
        assert_eq!(svc.get_tier("nope"), 0);
    }
}
