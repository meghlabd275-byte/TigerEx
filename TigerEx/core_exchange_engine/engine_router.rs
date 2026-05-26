//! Engine Router - Traffic routing with auto-failover
//! Migration: TypeScript -> Rust (critical low-latency)

use std::collections::HashMap;
use std::sync::RwLock;

/// Engine type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineType {
    Matching,
    Risk,
    Liquidation,
    Pricing,
}

/// Engine language
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineLang {
    Go,
    Rust,
    Cpp,
}

/// Engine status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineStatus {
    Active,
    Standby,
    Failed,
}

/// Engine instance
#[derive(Debug, Clone)]
pub struct Engine {
    pub id: String,
    pub engine_type: EngineType,
    pub language: EngineLang,
    pub status: EngineStatus,
    pub weight: u32,
    pub tps_capacity: u64,
}

/// Engine router with auto-failover
pub struct EngineRouter {
    engines: RwLock<HashMap<String, Engine>>,
    active_count: RwLock<HashMap<String, u64>>,
}

impl EngineRouter {
    pub fn new() -> Self {
        Self {
            engines: RwLock::new(HashMap::new()),
            active_count: RwLock::new(HashMap::new()),
        }
    }

    /// Register engine
    pub fn register(&self, id: &str, eng_type: EngineType, lang: EngineLang, capacity: u64) {
        let engine = Engine {
            id: id.to_string(),
            engine_type: eng_type,
            language: lang,
            status: EngineStatus::Standby,
            weight: 100,
            tps_capacity: capacity,
        };
        
        self.engines.write().unwrap().insert(id.to_string(), engine);
    }

    /// Get best engine for type
    pub fn route(&self, eng_type: EngineType) -> Option<String> {
        let engines = self.engines.read().unwrap();
        
        let mut candidates: Vec<_> = engines.values()
            .filter(|e| e.engine_type == eng_type && e.status == EngineStatus::Active)
            .collect();
        
        // Sort by capacity desc
        candidates.sort_by(|a, b| b.tps_capacity.cmp(&a.tps_capacity));
        
        candidates.first().map(|e| e.id.clone())
    }

    /// Failover to standby
    pub fn failover(&self, eng_type: EngineType) -> Option<String> {
        let mut engines = self.engines.write().unwrap();
        
        // Find standby
        for (_, engine) in engines.iter_mut() {
            if engine.engine_type == eng_type && engine.status == EngineStatus::Standby {
                engine.status = EngineStatus::Active;
                return Some(engine.id.clone());
            }
        }
        
        None
    }

    /// Record request
    pub fn record_request(&self, engine_id: &str) {
        let mut count = self.active_count.write().unwrap();
        *count.entry(engine_id.to_string()).or_insert(0) += 1;
    }

    /// Get stats
    pub fn stats(&self) -> (u64, u64) {
        let count = self.active_count.read().unwrap();
        let engines = self.engines.read().unwrap();
        
        let total_requests: u64 = count.values().sum();
        let active_engines = engines.values()
            .filter(|e| e.status == EngineStatus::Active)
            .count() as u64;
        
        (total_requests, active_engines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register() {
        let router = EngineRouter::new();
        router.register("matching-1", EngineType::Matching, EngineLang::Rust, 100_000);
        
        let id = router.route(EngineType::Matching);
        assert_eq!(id, None); // No active yet
    }

    #[test]
    fn test_failover() {
        let router = EngineRouter::new();
        router.register("risk-1", EngineType::Risk, EngineLang::Rust, 50_000);
        
        let new_id = router.failover(EngineType::Risk);
        assert!(new_id.is_some());
    }
}