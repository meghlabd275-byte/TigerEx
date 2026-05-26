//! Governance - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal { pub id: String, pub title: String, pub votes_for: u32, pub votes_against: u32, pub status: Status }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Status { Active, Passed, Rejected }

pub struct Governance { proposals: HashMap<String, Proposal> }

impl Governance { pub fn new() -> Self { Self { proposals: HashMap::new() } }
    pub fn create(&mut self, title: &str) -> String {
        let id = format!("PROP_{}", self.proposals.len());
        self.proposals.insert(id.clone(), Proposal { id: id.clone(), title: title.to_string(), votes_for: 0, votes_against: 0, status: Status::Active });
        id
    }
    pub fn vote(&mut self, id: &str, yay: bool) {
        if let Some(p) = self.proposals.get_mut(id) { if yay { p.votes_for += 1 } else { p.votes_against += 1 }; }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut g = Governance::new(); let id = g.create("Lower fees"); assert!(!id.is_empty()); } }
