// Delegate - Validator Delegation Logic
// Rust for staking delegation and governance voting

use std::collections::HashMap;

// Validator performance
#[derive(Debug, Clone)]
pub struct ValidatorPerf {
    pub validator_id: String,
    pub blocks_proposed: i32,
    pub blocks_missed: i32,
    pub uptime_percent: f64,
    pub slashes: i32,
}

impl ValidatorPerf {
    pub fn new(id: &str) -> Self {
        ValidatorPerf {
            validator_id: id.to_string(),
            blocks_proposed: 0,
            blocks_missed: 0,
            uptime_percent: 100.0,
            slashes: 0,
        }
    }

    pub fn update_uptime(&mut self, online: bool) {
        if !online {
            self.blocks_missed += 1;
            let total = self.blocks_proposed + self.blocks_missed;
            if total > 0 {
                self.uptime_percent = (self.blocks_proposed as f64 / total as f64) * 100.0;
            }
        } else {
            self.blocks_proposed += 1;
        }
    }
}

// Delegation manager
pub struct DelegationMgr {
    delegations: HashMap<String, DelegationInfo>,
    validators: HashMap<String, ValidatorPerf>,
    pending_undelegations: HashMap<String, UnbondingInfo>,
}

#[derive(Debug, Clone)]
pub struct DelegationInfo {
    pub id: String,
    pub user_id: String,
    pub validator_id: String,
    pub amount: f64,
    pub rewards: f64,
}

#[derive(Debug, Clone)]
pub struct UnbondingInfo {
    pub id: String,
    pub delegation_id: String,
    pub amount: f64,
    pub complete_ts: i64,
    pub claimed: bool,
}

impl DelegationMgr {
    pub fn new() -> Self {
        DelegationMgr {
            delegations: HashMap::new(),
            validators: HashMap::new(),
            pending_undelegations: HashMap::new(),
        }
    }

    // Delegate
    pub fn delegate(&mut self, user_id: &str, validator_id: &str, amount: f64) -> String {
        let id = format!("del_{}", now_ms());

        let del = DelegationInfo {
            id: id.clone(),
            user_id: user_id.to_string(),
            validator_id: validator_id.to_string(),
            amount,
            rewards: 0.0,
        };

        self.delegations.insert(id.clone(), del);
        id
    }

    // Undelegate
    pub fn undelegate(&mut self, delegation_id: &str) -> Result<String, String> {
        let del = self.delegations.get(delegation_id)
            .ok_or("delegation not found")?;

        let unbond_id = format!("unb_{}", now_ms());
        
        let unbond = UnbondingInfo {
            id: unbond_id.clone(),
            delegation_id: delegation_id.to_string(),
            amount: del.amount,
            complete_ts: now_ms() + 21 * 24 * 3600 * 1000, // 21 days
            claimed: false,
        };

        self.pending_undelegations.insert(unbond_id.clone(), unbond);
        
        Ok(unbond_id)
    }

    // Claim unbonded
    pub fn claim_unbonded(&mut self, unbond_id: &str) -> Result<f64, String> {
        let mut unbond = self.pending_undelegations.get_mut(unbond_id)
            .ok_or("unbonding not found")?;

        if unbond.complete_ts > now_ms() {
            return Err("still unbonding".to_string());
        }

        if unbond.claimed {
            return Err("already claimed".to_string());
        }

        unbond.claimed = true;
        Ok(unbond.amount)
    }

    // Calculate pending rewards
    pub fn pending_rewards(&self, user_id: &str) -> f64 {
        let mut total = 0.0;
        
        for (_, del) in &self.delegations {
            if del.user_id == user_id {
                total += del.rewards;
            }
        }
        
        total
    }

    // Select best validator (highest uptime, lowest commission)
    pub fn select_validator(&self, validators: &[(&String, f64, f64)]) -> Option<String> {
        // Score = uptime * 1000 - commission
        let mut best = None;
        let mut best_score = f64::MIN;

        for (id, uptime, comm) in validators {
            let score = uptime * 1000.0 - comm;
            if score > best_score {
                best_score = score;
                best = Some(id.clone());
            }
        }

        best
    }
}

// Governance voting
pub struct GovernanceVote {
    pub proposal_id: String,
    pub voter: String,
    pub vote: String, // yes, no, abstain
    pub weight: f64,
}

pub struct Governance {
    proposals: HashMap<String, ProposalInfo>,
    votes: HashMap<String, Vec<GovernanceVote>>,
}

#[derive(Debug, Clone)]
pub struct ProposalInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub votes_for: f64,
    pub votes_against: f64,
    pub status: String, // voting, passed, rejected
}

impl Governance {
    pub fn new() -> Self {
        Governance {
            proposals: HashMap::new(),
            votes: HashMap::new(),
        }
    }

    pub fn create_proposal(&mut self, title: &str, desc: &str) -> String {
        let id = format!("prop_{}", now_ms());

        let prop = ProposalInfo {
            id: id.clone(),
            title: title.to_string(),
            description: desc.to_string(),
            votes_for: 0.0,
            votes_against: 0.0,
            status: "voting".to_string(),
        };

        self.proposals.insert(id.clone(), prop);
        id
    }

    pub fn vote(&mut self, proposal_id: &str, voter: &str, vote: &str, weight: f64) -> Result<(), String> {
        let prop = self.proposals.get_mut(proposal_id)
            .ok_or("proposal not found")?;

        if vote == "yes" {
            prop.votes_for += weight;
        } else if vote == "no" {
            prop.votes_against += weight;
        }

        // Auto-close if threshold reached
        let total = prop.votes_for + prop.votes_against;
        if total > 1000000.0 { // Quorum
            if prop.votes_for > prop.votes_against {
                prop.status = "passed";
            } else {
                prop.status = "rejected";
            }
        }

        self.votes
            .entry(proposal_id.to_string())
            .or_insert_with(Vec::new)
            .push(GovernanceVote {
                proposal_id: proposal_id.to_string(),
                voter: voter.to_string(),
                vote: vote.to_string(),
                weight,
            });

        Ok(())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delegate() {
        let mut mgr = DelegationMgr::new();
        
        let id = mgr.delegate("u1", "v1", 1000.0);
        
        assert!(!id.is_empty());
    }
}