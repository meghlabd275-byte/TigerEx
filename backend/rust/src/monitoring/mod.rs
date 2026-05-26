//! Monitoring - Rust Implementation
//! Health checks, metrics, alerts

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub service: String,
    pub status: Status,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Healthy, Degraded, Down }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metric {
    pub name: String,
    pub value: f64,
    pub labels: HashMap<String, String>,
    pub timestamp: i64,
}

pub struct Monitor {
    services: HashMap<String, Status>,
    metrics: Vec<Metric>,
}

impl Monitor {
    pub fn new() -> Self { Self { services: HashMap::new(), metrics: vec![] } }
    
    pub fn register(&mut self, svc: &str) { self.services.insert(svc.to_string(), Status::Healthy); }
    
    pub fn set_status(&mut self, svc: &str, st: Status) {
        self.services.insert(svc.to_string(), st);
    }
    
    pub fn check(&self, svc: &str) -> Status {
        *self.services.get(svc).unwrap_or(&Status::Down)
    }
    
    pub fn record_metric(&mut self, name: &str, value: f64) {
        self.metrics.push(Metric {
            name: name.to_string(),
            value,
            labels: HashMap::new(),
            timestamp: current_ts(),
        });
    }
    
    pub fn all_healthy(&self) -> bool {
        !self.services.values().any(|s| *s == Status::Down)
    }
}

fn current_ts() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_monitor() { let mut m = Monitor::new(); m.register("api"); m.set_status("api", Status::Healthy); assert!(m.all_healthy()); } }