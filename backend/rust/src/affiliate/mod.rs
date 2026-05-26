//! Affiliate Program - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affiliate {
    pub id: String,
    pub user_id: String,
    pub commission: f64,
    pub recruits: u32,
    pub earnings: f64,
}

pub struct AffiliateProgram {
    affiliates: HashMap<String, Affiliate>,
}

impl AffiliateProgram {
    pub fn new() -> Self { Self { affiliates: HashMap::new() } }
    pub fn register(&mut self, uid: &str) -> String {
        let id = format!("AFF_{}", self.affiliates.len());
        self.affiliates.insert(id.clone(), Affiliate { id: id.clone(), user_id: uid.to_string(), commission: 0.10, recruits: 0, earnings: 0.0 });
        id
    }
    pub fn add_commission(&mut self, id: &str, amount: f64) -> Result<(), String> {
        let a = self.affiliates.get_mut(id).ok_or("Affiliate not found")?;
        a.earnings += amount;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut p = AffiliateProgram::new(); let id = p.register("user1"); assert!(!id.is_empty()); } }
