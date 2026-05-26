//! Snapshot Voting - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub title: String,
    pub description: String,
    pub votes: u64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Active, Closed }

pub struct SnapshotVoting {
    proposals: HashMap<String, Proposal>,
}

impl SnapshotVoting {
    pub fn new() -> Self { Self { proposals: HashMap::new() } }
    pub fn create(&mut self, title: &str, desc: &str) -> String {
        let id = format!("SNAP_{}", self.proposals.len());
        self.proposals.insert(id.clone(), Proposal { id: id.clone(), title: title.to_string(), description: desc.to_string(), votes: 0, status: Status::Active });
        id
    }
    pub fn vote(&mut self, id: &str) -> Result<(), String> {
        let p = self.proposals.get_mut(id).ok_or("Proposal not found")?;
        p.votes += 1;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = SnapshotVoting::new(); let id = s.create("Reduce Fees", "Lower trading fees"); assert!(!id.is_empty()); } }
