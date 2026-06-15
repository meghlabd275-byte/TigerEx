//! TigerEx withdrawal risk engine.
//!
//! Safety-critical Rust policy engine for withdrawal approval, step-up challenge,
//! manual review, and hard-block decisions. It is deterministic, dependency-free,
//! and designed to sit before wallet signing/HSM workflows.

use std::collections::{BTreeMap, BTreeSet};

pub type Amount = u128;
pub type Timestamp = u64;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Asset(pub String);

impl Asset {
    pub fn new(symbol: impl Into<String>) -> Self {
        Self(symbol.into().to_ascii_uppercase())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Address(pub String);

impl Address {
    pub fn new(address: impl Into<String>) -> Self {
        Self(address.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RiskDecision {
    Approve,
    StepUpAuth,
    ManualReview,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RiskReason {
    InvalidAmount,
    BlockedAddress,
    NewAddress,
    UntrustedDevice,
    NoTwoFactor,
    HighUserRisk,
    VelocityExceeded,
    DailyLimitExceeded,
    LargeWithdrawal,
    GeoAnomaly,
}

#[derive(Debug, Clone)]
pub struct RiskPolicy {
    pub max_daily_amount: Amount,
    pub large_withdrawal_amount: Amount,
    pub velocity_window_seconds: Timestamp,
    pub velocity_max_count: usize,
    pub step_up_score: u16,
    pub manual_review_score: u16,
    pub block_score: u16,
}

impl Default for RiskPolicy {
    fn default() -> Self {
        Self {
            max_daily_amount: 1_000_000_000_000,
            large_withdrawal_amount: 100_000_000_000,
            velocity_window_seconds: 3_600,
            velocity_max_count: 5,
            step_up_score: 25,
            manual_review_score: 60,
            block_score: 90,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WithdrawalRequest {
    pub user_id: String,
    pub asset: Asset,
    pub amount: Amount,
    pub destination: Address,
    pub device_id: String,
    pub ip_country: String,
    pub has_two_factor: bool,
    pub user_risk_score: u16,
    pub requested_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskAssessment {
    pub decision: RiskDecision,
    pub score: u16,
    pub reasons: Vec<RiskReason>,
    pub required_delay_seconds: Timestamp,
}

#[derive(Debug, Clone)]
pub struct UserSecurityProfile {
    pub trusted_devices: BTreeSet<String>,
    pub trusted_addresses: BTreeSet<Address>,
    pub allowed_countries: BTreeSet<String>,
    pub withdrawals: Vec<WithdrawalEvent>,
}

impl UserSecurityProfile {
    pub fn new() -> Self {
        Self { trusted_devices: BTreeSet::new(), trusted_addresses: BTreeSet::new(), allowed_countries: BTreeSet::new(), withdrawals: Vec::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalEvent {
    pub asset: Asset,
    pub amount: Amount,
    pub destination: Address,
    pub timestamp: Timestamp,
}

#[derive(Debug, Default)]
pub struct WithdrawalRiskEngine {
    policy: RiskPolicy,
    users: BTreeMap<String, UserSecurityProfile>,
    blocked_addresses: BTreeSet<Address>,
}

impl WithdrawalRiskEngine {
    pub fn new(policy: RiskPolicy) -> Self {
        Self { policy, users: BTreeMap::new(), blocked_addresses: BTreeSet::new() }
    }

    pub fn trust_device(&mut self, user_id: &str, device_id: impl Into<String>) {
        self.users.entry(user_id.to_string()).or_insert_with(UserSecurityProfile::new).trusted_devices.insert(device_id.into());
    }

    pub fn trust_address(&mut self, user_id: &str, address: Address) {
        self.users.entry(user_id.to_string()).or_insert_with(UserSecurityProfile::new).trusted_addresses.insert(address);
    }

    pub fn allow_country(&mut self, user_id: &str, country: impl Into<String>) {
        self.users.entry(user_id.to_string()).or_insert_with(UserSecurityProfile::new).allowed_countries.insert(country.into().to_ascii_uppercase());
    }

    pub fn block_address(&mut self, address: Address) {
        self.blocked_addresses.insert(address);
    }

    pub fn record_withdrawal(&mut self, request: &WithdrawalRequest) {
        self.users.entry(request.user_id.clone()).or_insert_with(UserSecurityProfile::new).withdrawals.push(WithdrawalEvent {
            asset: request.asset.clone(), amount: request.amount, destination: request.destination.clone(), timestamp: request.requested_at,
        });
    }

    pub fn assess(&self, request: &WithdrawalRequest) -> RiskAssessment {
        let profile = self.users.get(&request.user_id);
        let mut score: u16 = 0;
        let mut reasons = Vec::new();

        if request.amount == 0 {
            return RiskAssessment { decision: RiskDecision::Block, score: self.policy.block_score, reasons: vec![RiskReason::InvalidAmount], required_delay_seconds: 0 };
        }
        if self.blocked_addresses.contains(&request.destination) {
            return RiskAssessment { decision: RiskDecision::Block, score: self.policy.block_score, reasons: vec![RiskReason::BlockedAddress], required_delay_seconds: 0 };
        }

        let trusted_address = profile.map(|p| p.trusted_addresses.contains(&request.destination)).unwrap_or(false);
        if !trusted_address {
            score = score.saturating_add(25);
            reasons.push(RiskReason::NewAddress);
        }

        let trusted_device = profile.map(|p| p.trusted_devices.contains(&request.device_id)).unwrap_or(false);
        if !trusted_device {
            score = score.saturating_add(20);
            reasons.push(RiskReason::UntrustedDevice);
        }

        if !request.has_two_factor {
            score = score.saturating_add(30);
            reasons.push(RiskReason::NoTwoFactor);
        }

        if request.user_risk_score >= 70 {
            score = score.saturating_add(25);
            reasons.push(RiskReason::HighUserRisk);
        } else {
            score = score.saturating_add(request.user_risk_score / 5);
        }

        if request.amount >= self.policy.large_withdrawal_amount {
            score = score.saturating_add(20);
            reasons.push(RiskReason::LargeWithdrawal);
        }

        let country_allowed = profile
            .map(|p| p.allowed_countries.is_empty() || p.allowed_countries.contains(&request.ip_country.to_ascii_uppercase()))
            .unwrap_or(false);
        if !country_allowed {
            score = score.saturating_add(20);
            reasons.push(RiskReason::GeoAnomaly);
        }

        if let Some(profile) = profile {
            let window_start = request.requested_at.saturating_sub(self.policy.velocity_window_seconds);
            let recent_count = profile.withdrawals.iter().filter(|event| event.timestamp >= window_start).count();
            if recent_count >= self.policy.velocity_max_count {
                score = score.saturating_add(30);
                reasons.push(RiskReason::VelocityExceeded);
            }
            let day_start = request.requested_at.saturating_sub(86_400);
            let daily_total = profile.withdrawals.iter()
                .filter(|event| event.timestamp >= day_start && event.asset == request.asset)
                .fold(request.amount, |acc, event| acc.saturating_add(event.amount));
            if daily_total > self.policy.max_daily_amount {
                score = score.saturating_add(35);
                reasons.push(RiskReason::DailyLimitExceeded);
            }
        }

        let decision = if score >= self.policy.block_score {
            RiskDecision::Block
        } else if score >= self.policy.manual_review_score {
            RiskDecision::ManualReview
        } else if score >= self.policy.step_up_score {
            RiskDecision::StepUpAuth
        } else {
            RiskDecision::Approve
        };
        let required_delay_seconds = match decision {
            RiskDecision::Approve => 0,
            RiskDecision::StepUpAuth => 300,
            RiskDecision::ManualReview => 3_600,
            RiskDecision::Block => 0,
        };
        RiskAssessment { decision, score, reasons, required_delay_seconds }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(amount: Amount, destination: &str) -> WithdrawalRequest {
        WithdrawalRequest {
            user_id: "user1".into(), asset: Asset::new("BTC"), amount,
            destination: Address::new(destination), device_id: "device1".into(),
            ip_country: "US".into(), has_two_factor: true, user_risk_score: 0, requested_at: 1_000_000,
        }
    }

    #[test]
    fn approves_trusted_low_risk_withdrawal() {
        let mut engine = WithdrawalRiskEngine::new(RiskPolicy::default());
        engine.trust_device("user1", "device1");
        engine.trust_address("user1", Address::new("bc1trusted"));
        engine.allow_country("user1", "US");
        let assessment = engine.assess(&req(10_000, "bc1trusted"));
        assert_eq!(assessment.decision, RiskDecision::Approve);
        assert_eq!(assessment.score, 0);
    }

    #[test]
    fn blocks_sanctioned_or_compromised_destination() {
        let mut engine = WithdrawalRiskEngine::new(RiskPolicy::default());
        engine.block_address(Address::new("bad"));
        let assessment = engine.assess(&req(1, "bad"));
        assert_eq!(assessment.decision, RiskDecision::Block);
        assert_eq!(assessment.reasons, vec![RiskReason::BlockedAddress]);
    }

    #[test]
    fn escalates_new_device_new_address_without_two_factor() {
        let mut request = req(200_000_000_000, "new-address");
        request.has_two_factor = false;
        request.user_risk_score = 75;
        request.ip_country = "RU".into();
        let engine = WithdrawalRiskEngine::new(RiskPolicy::default());
        let assessment = engine.assess(&request);
        assert_eq!(assessment.decision, RiskDecision::Block);
        assert!(assessment.reasons.contains(&RiskReason::NoTwoFactor));
        assert!(assessment.reasons.contains(&RiskReason::GeoAnomaly));
    }

    #[test]
    fn detects_velocity_and_daily_limit() {
        let mut engine = WithdrawalRiskEngine::new(RiskPolicy { max_daily_amount: 100, large_withdrawal_amount: 1_000, velocity_max_count: 2, ..RiskPolicy::default() });
        engine.trust_device("user1", "device1");
        engine.trust_address("user1", Address::new("bc1trusted"));
        engine.allow_country("user1", "US");
        let mut request = req(60, "bc1trusted");
        engine.record_withdrawal(&request);
        request.requested_at += 10;
        engine.record_withdrawal(&request);
        request.requested_at += 10;
        let assessment = engine.assess(&request);
        assert_eq!(assessment.decision, RiskDecision::ManualReview);
        assert!(assessment.reasons.contains(&RiskReason::VelocityExceeded));
        assert!(assessment.reasons.contains(&RiskReason::DailyLimitExceeded));
    }
}
