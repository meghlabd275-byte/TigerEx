//! Regulatory compliance engine.
//!
//! The previous implementation built a `Regulation` with `compliant: true` and
//! returned `true` from `check_compliance` for every user and jurisdiction, so
//! nothing was ever blocked and `get_violations` always returned empty.

use std::collections::HashMap;
use std::sync::RwLock;

/// KYC tiers, ordered so they can be compared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KycLevel {
    None = 0,
    Basic = 1,
    Full = 2,
}

impl KycLevel {
    pub fn from_u8(level: u8) -> Self {
        match level {
            0 => KycLevel::None,
            1 => KycLevel::Basic,
            _ => KycLevel::Full,
        }
    }
}

/// Attributes a compliance decision depends on.
#[derive(Debug, Clone)]
pub struct UserProfile {
    pub user_id: String,
    pub kyc_level: KycLevel,
    pub country: String,
    pub sanctions_flagged: bool,
    pub account_age_days: u32,
}

/// Rules that apply in a jurisdiction.
#[derive(Debug, Clone)]
pub struct JurisdictionRules {
    pub jurisdiction: String,
    /// Whether the exchange is licensed to serve this jurisdiction at all.
    pub served: bool,
    pub min_kyc: KycLevel,
    /// Withdrawal ceiling in USD for a user at `min_kyc`.
    pub max_withdrawal_usd: f64,
    /// Minimum account age before withdrawals are permitted.
    pub min_account_age_days: u32,
}

/// Outcome of a compliance evaluation.
#[derive(Debug, Clone)]
pub struct ComplianceDecision {
    pub compliant: bool,
    pub violations: Vec<String>,
    /// Withdrawal ceiling that applies to this user, zero when non-compliant.
    pub max_withdrawal_usd: f64,
}

pub struct RegulatoryAIService {
    rules: RwLock<HashMap<String, JurisdictionRules>>,
    decisions: RwLock<HashMap<String, ComplianceDecision>>,
}

impl RegulatoryAIService {
    pub fn new() -> Self {
        let mut rules = HashMap::new();
        // Jurisdictions the exchange serves, with their requirements.
        rules.insert(
            "EU".to_string(),
            JurisdictionRules {
                jurisdiction: "EU".to_string(),
                served: true,
                min_kyc: KycLevel::Basic,
                max_withdrawal_usd: 10_000.0,
                min_account_age_days: 1,
            },
        );
        rules.insert(
            "US".to_string(),
            JurisdictionRules {
                jurisdiction: "US".to_string(),
                served: true,
                min_kyc: KycLevel::Full,
                max_withdrawal_usd: 5_000.0,
                min_account_age_days: 7,
            },
        );
        rules.insert(
            "SG".to_string(),
            JurisdictionRules {
                jurisdiction: "SG".to_string(),
                served: true,
                min_kyc: KycLevel::Basic,
                max_withdrawal_usd: 8_000.0,
                min_account_age_days: 3,
            },
        );
        // Explicitly unserved, sanctioned jurisdictions.
        for blocked in ["KP", "IR", "SY", "CU"] {
            rules.insert(
                blocked.to_string(),
                JurisdictionRules {
                    jurisdiction: blocked.to_string(),
                    served: false,
                    min_kyc: KycLevel::Full,
                    max_withdrawal_usd: 0.0,
                    min_account_age_days: u32::MAX,
                },
            );
        }

        Self {
            rules: RwLock::new(rules),
            decisions: RwLock::new(HashMap::new()),
        }
    }

    /// Register or replace the rules for a jurisdiction.
    pub fn set_rules(&self, rules: JurisdictionRules) {
        self.rules
            .write()
            .unwrap()
            .insert(rules.jurisdiction.clone(), rules);
    }

    /// Evaluate a user against the rules of `jurisdiction`.
    ///
    /// Fails closed: an unknown jurisdiction is treated as unserved.
    pub fn check_compliance(&self, profile: &UserProfile, jurisdiction: &str) -> ComplianceDecision {
        let rules = self.rules.read().unwrap();
        let mut violations = Vec::new();

        let Some(rules) = rules.get(jurisdiction) else {
            let decision = ComplianceDecision {
                compliant: false,
                violations: vec![format!("unknown jurisdiction: {jurisdiction}")],
                max_withdrawal_usd: 0.0,
            };
            self.decisions
                .write()
                .unwrap()
                .insert(profile.user_id.clone(), decision.clone());
            return decision;
        };

        if !rules.served {
            violations.push(format!("jurisdiction {} is not served", rules.jurisdiction));
        }
        if profile.sanctions_flagged {
            violations.push("user appears on a sanctions list".to_string());
        }
        if profile.kyc_level < rules.min_kyc {
            violations.push(format!(
                "KYC level {:?} is below the required {:?}",
                profile.kyc_level, rules.min_kyc
            ));
        }
        if profile.account_age_days < rules.min_account_age_days {
            violations.push(format!(
                "account age {}d is below the required {}d",
                profile.account_age_days, rules.min_account_age_days
            ));
        }

        let compliant = violations.is_empty();
        let decision = ComplianceDecision {
            compliant,
            violations,
            max_withdrawal_usd: if compliant { rules.max_withdrawal_usd } else { 0.0 },
        };

        self.decisions
            .write()
            .unwrap()
            .insert(profile.user_id.clone(), decision.clone());
        decision
    }

    /// Violations from the most recent evaluation of a user.
    pub fn get_violations(&self, user_id: &str) -> Vec<String> {
        self.decisions
            .read()
            .unwrap()
            .get(user_id)
            .map(|d| d.violations.clone())
            .unwrap_or_default()
    }
}

impl Default for RegulatoryAIService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(kyc: KycLevel, country: &str) -> UserProfile {
        UserProfile {
            user_id: "u1".to_string(),
            kyc_level: kyc,
            country: country.to_string(),
            sanctions_flagged: false,
            account_age_days: 30,
        }
    }

    #[test]
    fn fully_verified_user_is_compliant() {
        let svc = RegulatoryAIService::new();
        let decision = svc.check_compliance(&profile(KycLevel::Full, "US"), "US");

        assert!(decision.compliant);
        assert!(decision.violations.is_empty());
        assert_eq!(decision.max_withdrawal_usd, 5_000.0);
    }

    #[test]
    fn insufficient_kyc_is_blocked() {
        let svc = RegulatoryAIService::new();
        // The old implementation returned true regardless of KYC level.
        let decision = svc.check_compliance(&profile(KycLevel::None, "EU"), "EU");

        assert!(!decision.compliant);
        assert_eq!(decision.max_withdrawal_usd, 0.0);
        assert!(svc.get_violations("u1").iter().any(|v| v.contains("KYC")));
    }

    #[test]
    fn sanctions_and_unserved_jurisdictions_are_blocked() {
        let svc = RegulatoryAIService::new();

        let mut flagged = profile(KycLevel::Full, "US");
        flagged.sanctions_flagged = true;
        assert!(!svc.check_compliance(&flagged, "US").compliant);

        assert!(!svc.check_compliance(&profile(KycLevel::Full, "IR"), "IR").compliant);
    }

    #[test]
    fn unknown_jurisdiction_fails_closed() {
        let svc = RegulatoryAIService::new();
        let decision = svc.check_compliance(&profile(KycLevel::Full, "ZZ"), "ZZ");
        assert!(!decision.compliant);
        assert!(decision.violations[0].contains("unknown jurisdiction"));
    }

    #[test]
    fn minimum_account_age_is_enforced() {
        let svc = RegulatoryAIService::new();
        let mut fresh = profile(KycLevel::Full, "US");
        fresh.account_age_days = 0;

        assert!(!svc.check_compliance(&fresh, "US").compliant);
    }
}
