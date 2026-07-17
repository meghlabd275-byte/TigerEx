//! Metrics - Rust (analytics)
use std::collections::HashMap;
use std::sync::RwLock;
pub struct MetricsService { counters: RwLock<HashMap<String, u64>>, gauges: RwLock<HashMap<String, f64>> }
impl MetricsService {
    pub fn new() -> Self { Self { counters: RwLock::new(HashMap::new()), gauges: RwLock::new(HashMap::new()) } }
    pub fn inc(&self, key: &str) { *self.counters.write().unwrap().entry(key.to_string()).or_insert(0) += 1; }
    pub fn gauge(&self, key: &str, val: f64) { self.gauges.write().unwrap().insert(key.to_string(), val); }
    pub fn get_counter(&self, key: &str) -> u64 { *self.counters.read().unwrap().get(key).unwrap_or(&0) }
}
impl Default for MetricsService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let m = MetricsService::new(); m.inc("requests"); } }