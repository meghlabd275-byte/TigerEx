//! Incentive campaigns.
//!
//! The previous implementation returned a constant 100.0 from `claim` for every
//! user and campaign, never drew down the campaign budget, and had no cap on
//! how often a user could claim.

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum IncentiveError {
    UnknownCampaign(String),
    InvalidAmount(f64),
    AlreadyClaimed { user_id: String, campaign: String },
    BudgetExhausted { campaign: String, remaining: f64 },
}

impl std::fmt::Display for IncentiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IncentiveError::UnknownCampaign(c) => write!(f, "unknown campaign: {c}"),
            IncentiveError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            IncentiveError::AlreadyClaimed { user_id, campaign } => {
                write!(f, "{user_id} already claimed {campaign}")
            }
            IncentiveError::BudgetExhausted { campaign, remaining } => {
                write!(f, "campaign {campaign} has only {remaining} left")
            }
        }
    }
}

impl std::error::Error for IncentiveError {}

struct Campaign {
    budget: f64,
    /// Fixed reward paid per claim.
    reward_per_claim: f64,
}

pub struct IncentiveService {
    campaigns: RwLock<HashMap<String, Campaign>>,
    /// (campaign, user) pairs that have already claimed.
    claimed: RwLock<HashSet<(String, String)>>,
}

impl IncentiveService {
    pub fn new() -> Self {
        Self {
            campaigns: RwLock::new(HashMap::new()),
            claimed: RwLock::new(HashSet::new()),
        }
    }

    /// Create a campaign with a total budget and a per-claim reward.
    pub fn create_campaign(
        &self,
        campaign: &str,
        budget: f64,
        reward_per_claim: f64,
    ) -> Result<(), IncentiveError> {
        if !budget.is_finite() || budget <= 0.0 {
            return Err(IncentiveError::InvalidAmount(budget));
        }
        if !reward_per_claim.is_finite() || reward_per_claim <= 0.0 {
            return Err(IncentiveError::InvalidAmount(reward_per_claim));
        }
        self.campaigns.write().unwrap().insert(
            campaign.to_string(),
            Campaign {
                budget,
                reward_per_claim,
            },
        );
        Ok(())
    }

    /// Remaining budget for a campaign.
    pub fn remaining_budget(&self, campaign: &str) -> Result<f64, IncentiveError> {
        self.campaigns
            .read()
            .unwrap()
            .get(campaign)
            .map(|c| c.budget)
            .ok_or_else(|| IncentiveError::UnknownCampaign(campaign.to_string()))
    }

    /// Claim a campaign reward.
    ///
    /// Enforces one claim per user per campaign and draws down the budget, so
    /// the payout reflects the campaign rather than a fixed constant.
    pub fn claim(&self, user_id: &str, campaign: &str) -> Result<f64, IncentiveError> {
        let mut campaigns = self.campaigns.write().unwrap();
        let campaign_entry = campaigns
            .get_mut(campaign)
            .ok_or_else(|| IncentiveError::UnknownCampaign(campaign.to_string()))?;

        let key = (campaign.to_string(), user_id.to_string());
        if self.claimed.read().unwrap().contains(&key) {
            return Err(IncentiveError::AlreadyClaimed {
                user_id: user_id.to_string(),
                campaign: campaign.to_string(),
            });
        }

        if campaign_entry.budget < campaign_entry.reward_per_claim {
            return Err(IncentiveError::BudgetExhausted {
                campaign: campaign.to_string(),
                remaining: campaign_entry.budget,
            });
        }

        let reward = campaign_entry.reward_per_claim;
        campaign_entry.budget -= reward;
        self.claimed.write().unwrap().insert(key);
        Ok(reward)
    }
}

impl Default for IncentiveService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> IncentiveService {
        let svc = IncentiveService::new();
        svc.create_campaign("airdrop", 1_000.0, 100.0).unwrap();
        svc
    }

    #[test]
    fn claim_pays_the_campaign_reward_and_draws_down_budget() {
        let svc = service();

        assert_eq!(svc.claim("u1", "airdrop").unwrap(), 100.0);
        assert_eq!(svc.remaining_budget("airdrop").unwrap(), 900.0);
    }

    #[test]
    fn unknown_campaigns_are_rejected() {
        let svc = service();
        // The old implementation returned 100.0 for any campaign name.
        assert_eq!(
            svc.claim("u1", "ghost").unwrap_err(),
            IncentiveError::UnknownCampaign("ghost".to_string())
        );
    }

    #[test]
    fn a_user_cannot_claim_twice() {
        let svc = service();
        svc.claim("u1", "airdrop").unwrap();

        assert_eq!(
            svc.claim("u1", "airdrop").unwrap_err(),
            IncentiveError::AlreadyClaimed {
                user_id: "u1".to_string(),
                campaign: "airdrop".to_string()
            }
        );
        assert_eq!(svc.remaining_budget("airdrop").unwrap(), 900.0);
    }

    #[test]
    fn budget_is_exhausted_eventually() {
        let svc = IncentiveService::new();
        svc.create_campaign("small", 150.0, 100.0).unwrap();

        svc.claim("u1", "small").unwrap();
        assert!(matches!(
            svc.claim("u2", "small").unwrap_err(),
            IncentiveError::BudgetExhausted { .. }
        ));
    }

    #[test]
    fn invalid_campaign_parameters_are_rejected() {
        let svc = IncentiveService::new();
        assert!(svc.create_campaign("bad", -1.0, 10.0).is_err());
        assert!(svc.create_campaign("bad", 100.0, 0.0).is_err());
    }
}
