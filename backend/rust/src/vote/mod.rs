//! Governance Vote - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    pub user_id: String,
    pub choice: Choice,
    pub weight: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Choice { For, Against, Abstain }

pub struct GovernanceVote {
    votes: HashMap<String, Vec<Vote>>,
}

impl GovernanceVote {
    pub fn new() -> Self { Self { votes: HashMap::new() } }
    pub fn cast(&mut self, proposal: &str, user: &str, choice: Choice, weight: f64) {
        self.votes.entry(proposal.to_string()).or_insert_with(Vec::new).push(Vote { user_id: user.to_string(), choice, weight });
    }
    pub fn tally(&self, proposal: &str) -> (f64, f64) {
        self.votes.get(proposal).map(|v| {
            let for_votes: f64 = v.iter().filter(|x| x.choice == Choice::For).map(|x| x.weight).sum();
            let against: f64 = v.iter().filter(|x| x.choice == Choice::Against).map(|x| x.weight).sum();
            (for_votes, against)
        }).unwrap_or((0.0, 0.0))
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut g = GovernanceVote::new(); g.cast("prop1", "user1", Choice::For, 1000.0); } }
