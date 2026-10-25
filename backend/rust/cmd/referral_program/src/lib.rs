//! Referral program.
//!
//! The previous implementation returned a constant 50.0 from `reward` for any
//! user, whether or not they had referred anyone, and `generate_link` was just
//! `format!("ref.{user_id}")` with no validation.

use std::collections::HashMap;
use std::sync::RwLock;

/// Referral commission as a share of the referee's trading fees.
pub const COMMISSION_RATE: f64 = 0.40;

#[derive(Debug, Clone, PartialEq)]
pub enum ReferralError {
    UnknownReferrer(String),
    SelfReferral,
    AlreadyReferred(String),
    InvalidAmount(f64),
}

impl std::fmt::Display for ReferralError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReferralError::UnknownReferrer(r) => write!(f, "unknown referrer: {r}"),
            ReferralError::SelfReferral => write!(f, "a user cannot refer themselves"),
            ReferralError::AlreadyReferred(u) => write!(f, "{u} already has a referrer"),
            ReferralError::InvalidAmount(a) => write!(f, "fee {a} must be finite and non-negative"),
        }
    }
}

impl std::error::Error for ReferralError {}

pub struct ReferralService {
    /// referee -> referrer.
    referrals: RwLock<HashMap<String, String>>,
    /// referrer -> accrued commission.
    earnings: RwLock<HashMap<String, f64>>,
    /// Referrers approved to receive commission.
    approved: RwLock<HashMap<String, ()>>,
}

impl ReferralService {
    pub fn new() -> Self {
        Self {
            referrals: RwLock::new(HashMap::new()),
            earnings: RwLock::new(HashMap::new()),
            approved: RwLock::new(HashMap::new()),
        }
    }

    /// Register a referrer so they can accrue commission.
    pub fn register_referrer(&self, user_id: &str) -> String {
        self.approved.write().unwrap().insert(user_id.to_string(), ());
        self.link_for(user_id)
    }

    /// Build a referral link. The code is derived from the user id, so it is
    /// stable and can be reversed to find the referrer.
    pub fn link_for(&self, user_id: &str) -> String {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in user_id.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("https://tigerex.example/ref/{hash:016x}")
    }

    /// Resolve a referral code back to the referrer's user id, if it matches
    /// an approved referrer.
    pub fn referrer_for_code(&self, code: &str) -> Option<String> {
        let code = code.rsplit('/').next().unwrap_or(code);
        self.approved
            .read()
            .unwrap()
            .keys()
            .find(|user_id| self.link_for(user_id).ends_with(code))
            .cloned()
    }

    /// Record that `referee` was referred by `referrer`.
    pub fn track(&self, referrer: &str, referee: &str) -> Result<(), ReferralError> {
        if referrer == referee {
            return Err(ReferralError::SelfReferral);
        }
        if !self.approved.read().unwrap().contains_key(referrer) {
            return Err(ReferralError::UnknownReferrer(referrer.to_string()));
        }

        let mut referrals = self.referrals.write().unwrap();
        if referrals.contains_key(referee) {
            return Err(ReferralError::AlreadyReferred(referee.to_string()));
        }
        referrals.insert(referee.to_string(), referrer.to_string());
        Ok(())
    }

    /// Accrue commission on a referee's trading fee.
    pub fn record_fee(&self, referee: &str, fee: f64) -> Result<f64, ReferralError> {
        if !fee.is_finite() || fee < 0.0 {
            return Err(ReferralError::InvalidAmount(fee));
        }
        let Some(referrer) = self.referrals.read().unwrap().get(referee).cloned() else {
            return Ok(0.0);
        };

        let commission = fee * COMMISSION_RATE;
        *self.earnings.write().unwrap().entry(referrer).or_insert(0.0) += commission;
        Ok(commission)
    }

    /// Accrued commission for a user.
    pub fn reward(&self, user_id: &str) -> f64 {
        self.earnings
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(0.0)
    }

    pub fn referee_count(&self, referrer: &str) -> usize {
        self.referrals
            .read()
            .unwrap()
            .values()
            .filter(|r| r.as_str() == referrer)
            .count()
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
    fn reward_is_earned_not_a_constant() {
        let svc = ReferralService::new();
        svc.register_referrer("alice");

        // The old implementation returned 50.0 for everyone, including users
        // with no referees at all.
        assert_eq!(svc.reward("alice"), 0.0);
        assert_eq!(svc.reward("nobody"), 0.0);

        svc.track("alice", "bob").unwrap();
        let commission = svc.record_fee("bob", 100.0).unwrap();

        assert_eq!(commission, 40.0);
        assert_eq!(svc.reward("alice"), 40.0);
    }

    #[test]
    fn self_referral_and_unknown_referrers_are_rejected() {
        let svc = ReferralService::new();
        assert_eq!(svc.track("alice", "alice").unwrap_err(), ReferralError::SelfReferral);
        assert_eq!(
            svc.track("ghost", "bob").unwrap_err(),
            ReferralError::UnknownReferrer("ghost".to_string())
        );
    }

    #[test]
    fn a_referee_cannot_be_claimed_twice() {
        let svc = ReferralService::new();
        svc.register_referrer("alice");
        svc.register_referrer("carol");

        svc.track("alice", "bob").unwrap();
        assert_eq!(
            svc.track("carol", "bob").unwrap_err(),
            ReferralError::AlreadyReferred("bob".to_string())
        );
        assert_eq!(svc.referee_count("alice"), 1);
    }

    #[test]
    fn codes_round_trip_to_the_referrer() {
        let svc = ReferralService::new();
        let link = svc.register_referrer("alice");

        assert!(!link.contains("alice"));
        let code = link.rsplit('/').next().unwrap();
        assert_eq!(svc.referrer_for_code(code).as_deref(), Some("alice"));
    }

    #[test]
    fn fees_without_a_referrer_earn_nothing() {
        let svc = ReferralService::new();
        assert_eq!(svc.record_fee("lonely", 100.0).unwrap(), 0.0);
        assert!(svc.record_fee("lonely", -1.0).is_err());
    }
}
