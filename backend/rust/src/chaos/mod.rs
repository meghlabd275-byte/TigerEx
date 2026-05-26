//! Chaos Engineering - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChaosExperiment {
    pub id: String,
    pub name: String,
    pub fault: String,
    pub status: ExpStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExpStatus { Pending, Running, Success, Failed }

pub struct ChaosEngine {
    experiments: HashMap<String, ChaosExperiment>,
}

impl ChaosEngine {
    pub fn new() -> Self { Self { experiments: HashMap::new() } }
    pub fn create(&mut self, name: &str, fault: &str) -> String {
        let id = format!("CHAOS_{}", self.experiments.len());
        self.experiments.insert(id.clone(), ChaosExperiment { id: id.clone(), name: name.to_string(), fault: fault.to_string(), status: ExpStatus::Pending });
        id
    }
    pub fn run(&mut self, id: &str) -> Result<(), String> {
        let exp = self.experiments.get_mut(id).ok_or("Experiment not found")?;
        exp.status = ExpStatus::Running;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = ChaosEngine::new(); let id = c.create("latency", "network_delay"); assert!(!id.is_empty()); } }
