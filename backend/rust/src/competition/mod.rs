//! Trading Competition - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Competition {
    pub id: String,
    pub name: String,
    pub participants: u32,
    pub prize_pool: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Upcoming, Active, Completed }

pub struct CompetitionService {
    competitions: HashMap<String, Competition>,
    rankings: HashMap<String, Vec<(String, f64)>>,
}

impl CompetitionService {
    pub fn new() -> Self { Self { competitions: HashMap::new(), rankings: HashMap::new() } }
    pub fn create(&mut self, name: &str, participants: u32, prize: f64) -> String {
        let id = format!("COMP_{}", self.competitions.len());
        self.competitions.insert(id.clone(), Competition { id: id.clone(), name: name.to_string(), participants, prize_pool: prize, status: Status::Upcoming });
        id
    }
    pub fn start(&mut self, id: &str) -> Result<(), String> {
        let c = self.competitions.get_mut(id).ok_or("Competition not found")?;
        c.status = Status::Active;
        Ok(())
    }
    pub fn update_rank(&mut self, comp_id: &str, user: &str, pnl: f64) {
        self.rankings.entry(comp_id.to_string()).or_insert_with(Vec::new).push((user.to_string(), pnl));
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = CompetitionService::new(); let id = c.create("Winter Cup", 100, 10000.0); assert!(!id.is_empty()); } }
