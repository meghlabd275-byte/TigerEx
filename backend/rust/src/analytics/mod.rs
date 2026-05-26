//! Analytics - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsData {
    pub metric: String,
    pub value: f64,
    pub timestamp: i64,
}

pub struct AnalyticsService {
    metrics: HashMap<String, Vec<AnalyticsData>>,
}

impl AnalyticsService {
    pub fn new() -> Self { Self { metrics: HashMap::new() } }
    pub fn track(&mut self, metric: &str, value: f64) {
        self.metrics.entry(metric.to_string()).or_insert_with(Vec::new).push(AnalyticsData { metric: metric.to_string(), value, timestamp: now_ms() });
    }
    pub fn get(&self, metric: &str) -> f64 {
        self.metrics.get(metric).map(|v| v.iter().map(|d| d.value).sum::<f64>() / v.len() as f64).unwrap_or(0.0)
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut a = AnalyticsService::new(); a.track("volume", 1000.0); assert!(a.get("volume") == 1000.0); } }
