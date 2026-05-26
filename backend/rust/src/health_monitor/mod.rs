//! Monitoring Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metric {
    pub name: String,
    pub value: f64,
    pub timestamp: i64,
}

pub struct MonitoringService {
    metrics: HashMap<String, Vec<Metric>>,
}

impl MonitoringService {
    pub fn new() -> Self { Self { metrics: HashMap::new() } }
    pub fn record(&mut self, name: &str, value: f64) {
        self.metrics.entry(name.to_string()).or_insert_with(Vec::new).push(Metric { name: name.to_string(), value, timestamp: now_ms() });
    }
    pub fn avg(&self, name: &str) -> f64 {
        self.metrics.get(name).map(|v| v.iter().map(|m| m.value).sum::<f64>() / v.len() as f64).unwrap_or(0.0)
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut m = MonitoringService::new(); m.record("cpu", 0.5); assert!(m.avg("cpu") == 0.5); } }
