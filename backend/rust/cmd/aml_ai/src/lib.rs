//! AML transaction screening.
//!
//! The previous implementation returned hardcoded risk scores (1.0 for
//! watchlisted users, 0.1 otherwise) and flagged transactions purely on a
//! 10,000 threshold, ignoring velocity, jurisdiction and watchlist state.

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

/// A raised alert, retained for review.
#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    pub user_id: String,
    pub risk_score: f64,
    pub alert_type: String,
}

/// Signals contributing to a transaction's risk score.
#[derive(Debug, Clone)]
pub struct TransactionContext {
    pub user_id: String,
    pub amount_usd: f64,
    pub jurisdiction: String,
    /// Number of transfers this user sent in the last 24 hours.
    pub transfers_last_24h: u32,
    /// Whether the destination address is newly seen for this user.
    pub new_destination: bool,
}

pub struct AMLAIService {
    alerts: RwLock<Vec<Alert>>,
    watchlist: RwLock<HashSet<String>>,
    high_risk_jurisdictions: RwLock<HashSet<String>>,
    /// Reporting threshold in USD; transfers at or above it are alerted.
    reporting_threshold_usd: f64,
    alert_score: f64,
}

impl AMLAIService {
    pub fn new() -> Self {
        Self {
            alerts: RwLock::new(Vec::new()),
            watchlist: RwLock::new(HashSet::new()),
            high_risk_jurisdictions: RwLock::new(HashSet::new()),
            reporting_threshold_usd: 10_000.0,
            alert_score: 0.5,
        }
    }

    pub fn set_reporting_threshold(&mut self, threshold_usd: f64) {
        self.reporting_threshold_usd = threshold_usd;
    }

    pub fn add_to_watchlist(&self, user_id: &str) {
        self.watchlist.write().unwrap().insert(user_id.to_string());
    }

    pub fn remove_from_watchlist(&self, user_id: &str) {
        self.watchlist.write().unwrap().remove(user_id);
    }

    pub fn add_high_risk_jurisdiction(&self, jurisdiction: &str) {
        self.high_risk_jurisdictions
            .write()
            .unwrap()
            .insert(jurisdiction.to_uppercase());
    }

    /// Screen a user against the watchlist.
    ///
    /// Returns 1.0 for a watchlisted user and a graduated score based on the
    /// user's prior alert history otherwise, rather than a fixed 0.1.
    pub fn screen(&self, user_id: &str) -> f64 {
        if self.watchlist.read().unwrap().contains(user_id) {
            return 1.0;
        }

        let alerts = self.alerts.read().unwrap();
        let prior = alerts.iter().filter(|a| a.user_id == user_id).count();
        // Each prior alert adds 0.15, capped below the watchlist score.
        (prior as f64 * 0.15).min(0.9)
    }

    /// Score a transaction from its context. Pure: raises no alert.
    pub fn risk_score(&self, ctx: &TransactionContext) -> f64 {
        if self.watchlist.read().unwrap().contains(&ctx.user_id) {
            return 1.0;
        }

        let mut score = 0.0;

        // Amount band: proportional up to the reporting threshold, then capped.
        if ctx.amount_usd >= self.reporting_threshold_usd {
            score += 0.5;
        } else if ctx.amount_usd > 0.0 {
            score += 0.5 * (ctx.amount_usd / self.reporting_threshold_usd);
        }

        // Velocity: rapid transfer bursts raise risk.
        if ctx.transfers_last_24h >= 20 {
            score += 0.3;
        } else if ctx.transfers_last_24h >= 5 {
            score += 0.15;
        }

        // Jurisdiction risk.
        if self
            .high_risk_jurisdictions
            .read()
            .unwrap()
            .contains(&ctx.jurisdiction.to_uppercase())
        {
            score += 0.3;
        }

        // First-time destination is a classic layering signal.
        if ctx.new_destination {
            score += 0.1;
        }

        score.min(1.0)
    }

    /// Evaluate a transaction, record an alert when the score warrants it, and
    /// report whether the transfer should be held for review.
    pub fn flag_transaction(&self, ctx: &TransactionContext) -> bool {
        let risk = self.risk_score(ctx);
        let should_flag = risk >= self.alert_score;

        if should_flag {
            self.alerts.write().unwrap().push(Alert {
                user_id: ctx.user_id.clone(),
                risk_score: risk,
                alert_type: alert_type(ctx, risk, self.reporting_threshold_usd),
            });
        }

        should_flag
    }

    /// Alerts raised for a user.
    pub fn alerts_for(&self, user_id: &str) -> Vec<Alert> {
        self.alerts
            .read()
            .unwrap()
            .iter()
            .filter(|a| a.user_id == user_id)
            .cloned()
            .collect()
    }

    pub fn alert_count(&self) -> usize {
        self.alerts.read().unwrap().len()
    }
}

impl Default for AMLAIService {
    fn default() -> Self {
        Self::new()
    }
}

fn alert_type(ctx: &TransactionContext, risk: f64, threshold: f64) -> String {
    if risk >= 1.0 {
        "watchlist".to_string()
    } else if ctx.amount_usd >= threshold {
        "large_amount".to_string()
    } else if ctx.transfers_last_24h >= 20 {
        "velocity".to_string()
    } else {
        "composite_risk".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(user: &str, amount: f64) -> TransactionContext {
        TransactionContext {
            user_id: user.to_string(),
            amount_usd: amount,
            jurisdiction: "EU".to_string(),
            transfers_last_24h: 1,
            new_destination: false,
        }
    }

    #[test]
    fn small_single_transfer_is_not_flagged() {
        let svc = AMLAIService::new();
        assert!(!svc.flag_transaction(&ctx("u1", 100.0)));
        assert_eq!(svc.alert_count(), 0);
    }

    #[test]
    fn large_transfer_is_flagged_and_alerted() {
        let svc = AMLAIService::new();
        assert!(svc.flag_transaction(&ctx("u1", 25_000.0)));

        let alerts = svc.alerts_for("u1");
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].alert_type, "large_amount");
    }

    #[test]
    fn watchlisted_user_is_always_flagged() {
        let svc = AMLAIService::new();
        svc.add_to_watchlist("bad");

        assert_eq!(svc.screen("bad"), 1.0);
        assert!(svc.flag_transaction(&ctx("bad", 1.0)));
        assert_eq!(svc.alerts_for("bad")[0].alert_type, "watchlist");
    }

    #[test]
    fn score_is_graduated_not_constant() {
        let svc = AMLAIService::new();
        let small = svc.risk_score(&ctx("u1", 100.0));
        let large = svc.risk_score(&ctx("u1", 9_000.0));

        assert!(small < large, "expected graduated scoring: {small} < {large}");
        // The old implementation returned a fixed 0.1 for every non-watchlisted user.
        assert!(small > 0.0);
    }

    #[test]
    fn velocity_and_jurisdiction_raise_risk() {
        let svc = AMLAIService::new();
        svc.add_high_risk_jurisdiction("KP");

        let mut rapid = ctx("u1", 500.0);
        rapid.transfers_last_24h = 25;
        assert!(svc.risk_score(&rapid) > svc.risk_score(&ctx("u1", 500.0)));

        let mut offshore = ctx("u1", 500.0);
        offshore.jurisdiction = "kp".to_string();
        assert!(svc.risk_score(&offshore) > svc.risk_score(&ctx("u1", 500.0)));
    }

    #[test]
    fn screening_history_reflects_prior_alerts() {
        let svc = AMLAIService::new();
        assert_eq!(svc.screen("u1"), 0.0);

        svc.flag_transaction(&ctx("u1", 25_000.0));
        assert!(svc.screen("u1") > 0.0);
    }
}
