//! Referral links and commissions.
//!
//! The previous implementation never credited any reward (`get_reward` always
//! returned zero because nothing wrote to the rewards map), allowed a user to
//! refer themselves, and let a referee be attributed to more than one referrer.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum ReferralError {
    EmptyUser,
    SelfReferral,
    AlreadyReferred(String),
    NotReferred(String),
    InvalidAmount(f64),
}

impl std::fmt::Display for ReferralError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReferralError::EmptyUser => write!(f, "user id must not be empty"),
            ReferralError::SelfReferral => write!(f, "a user cannot refer themselves"),
            ReferralError::AlreadyReferred(r) => write!(f, "user {r} already has a referrer"),
            ReferralError::NotReferred(r) => write!(f, "user {r} has no referrer"),
            ReferralError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
        }
    }
}

impl std::error::Error for ReferralError {}

pub struct ReferralService {
    /// referee -> referrer.
    referrers: RwLock<HashMap<String, String>>,
    /// referrer -> referees.
    referrals: RwLock<HashMap<String, Vec<String>>>,
    /// referrer -> accrued commission.
    rewards: RwLock<HashMap<String, f64>>,
    /// Commission rate applied to trading fees.
    commission_rate: f64,
}

impl ReferralService {
    pub fn new() -> Self {
        Self {
            referrers: RwLock::new(HashMap::new()),
            referrals: RwLock::new(HashMap::new()),
            rewards: RwLock::new(HashMap::new()),
            commission_rate: 0.4,
        }
    }

    pub fn with_commission_rate(mut self, rate: f64) -> Result<Self, ReferralError> {
        if !rate.is_finite() || rate <= 0.0 || rate > 1.0 {
            return Err(ReferralError::InvalidAmount(rate));
        }
        self.commission_rate = rate;
        Ok(self)
    }

    pub fn create_link(&self, user_id: &str) -> Result<String, ReferralError> {
        if user_id.trim().is_empty() {
            return Err(ReferralError::EmptyUser);
        }
        Ok(format!("ref_{user_id}"))
    }

    /// Attribute a referee to a referrer. Each referee may have only one
    /// referrer, and self-referral is refused.
    pub fn add_referral(&self, referrer: &str, referee: &str) -> Result<(), ReferralError> {
        if referrer.trim().is_empty() || referee.trim().is_empty() {
            return Err(ReferralError::EmptyUser);
        }
        if referrer == referee {
            return Err(ReferralError::SelfReferral);
        }

        let mut referrers = self.referrers.write().unwrap();
        if let Some(existing) = referrers.get(referee) {
            return Err(ReferralError::AlreadyReferred(existing.clone()));
        }
        referrers.insert(referee.to_string(), referrer.to_string());
        drop(referrers);

        self.referrals
            .write()
            .unwrap()
            .entry(referrer.to_string())
            .or_default()
            .push(referee.to_string());
        Ok(())
    }

    /// Accrue commission to a referee's referrer from the trading fee they
    /// paid. Returns the commission credited.
    pub fn accrue_commission(&self, referee: &str, fee_paid: f64) -> Result<f64, ReferralError> {
        if !fee_paid.is_finite() || fee_paid <= 0.0 {
            return Err(ReferralError::InvalidAmount(fee_paid));
        }

        let referrer = self
            .referrers
            .read()
            .unwrap()
            .get(referee)
            .cloned()
            .ok_or_else(|| ReferralError::NotReferred(referee.to_string()))?;

        let commission = fee_paid * self.commission_rate;
        *self
            .rewards
            .write()
            .unwrap()
            .entry(referrer)
            .or_insert(0.0) += commission;
        Ok(commission)
    }

    pub fn get_reward(&self, user_id: &str) -> f64 {
        self.rewards
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(0.0)
    }

    /// Claim and reset a referrer's accrued commission.
    pub fn claim_reward(&self, user_id: &str) -> f64 {
        self.rewards
            .write()
            .unwrap()
            .remove(user_id)
            .unwrap_or(0.0)
    }

    pub fn referees(&self, user_id: &str) -> Vec<String> {
        self.referrals
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for ReferralService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commissions_actually_accrue() {
        let svc = ReferralService::new();
        svc.add_referral("alice", "bob").unwrap();

        // The old implementation never credited anything.
        let commission = svc.accrue_commission("bob", 100.0).unwrap();
        assert_eq!(commission, 40.0); // 40% of the fee
        assert_eq!(svc.get_reward("alice"), 40.0);
    }

    #[test]
    fn claiming_resets_the_balance() {
        let svc = ReferralService::new();
        svc.add_referral("alice", "bob").unwrap();
        svc.accrue_commission("bob", 100.0).unwrap();

        assert_eq!(svc.claim_reward("alice"), 40.0);
        assert_eq!(svc.get_reward("alice"), 0.0);
    }

    #[test]
    fn self_referral_is_rejected() {
        let svc = ReferralService::new();
        assert!(matches!(
            svc.add_referral("alice", "alice").unwrap_err(),
            ReferralError::SelfReferral
        ));
    }

    #[test]
    fn a_referee_cannot_have_two_referrers() {
        let svc = ReferralService::new();
        svc.add_referral("alice", "bob").unwrap();
        assert!(matches!(
            svc.add_referral("carol", "bob").unwrap_err(),
            ReferralError::AlreadyReferred(_)
        ));
        assert_eq!(svc.referees("alice"), vec!["bob".to_string()]);
        assert!(svc.referees("carol").is_empty());
    }

    #[test]
    fn commission_requires_a_referrer_and_a_valid_fee() {
        let svc = ReferralService::new();
        assert!(matches!(
            svc.accrue_commission("nobody", 100.0).unwrap_err(),
            ReferralError::NotReferred(_)
        ));

        svc.add_referral("alice", "bob").unwrap();
        assert!(svc.accrue_commission("bob", -1.0).is_err());
        assert!(svc.accrue_commission("bob", f64::NAN).is_err());
    }
}
