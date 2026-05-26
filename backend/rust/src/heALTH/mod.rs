//! Health Check - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub component: String,
    pub status: ComponentStatus,
    pub latency_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComponentStatus { Healthy, Degraded, Down }

pub struct HealthService {
    checks: HashMap<String, HealthStatus>,
}

impl HealthService {
    pub fn new() -> Self { Self { checks: HashMap::new() } }
    pub fn register(&mut self, comp: &str) {
        self.checks.insert(comp.to_string(), HealthStatus { component: comp.to_string(), status: ComponentStatus::Healthy, latency_ms: 0 });
    }
    pub fn check(&self, comp: &str) -> ComponentStatus {
        self.checks.get(comp).map(|c| c.status).unwrap_or(ComponentStatus::Down)
    }
    pub fn all_healthy(&self) -> bool {
        self.checks.values().all(|c| c.status == ComponentStatus::Healthy)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut h = HealthService::new(); h.register("matching"); assert!(h.all_healthy()); } }
