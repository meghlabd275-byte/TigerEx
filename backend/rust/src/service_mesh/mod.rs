//! Service Mesh - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceNode { pub name: String, pub address: String, pub weight: u32, pub healthy: bool }

pub struct ServiceMesh {
    services: HashMap<String, Vec<ServiceNode>>,
}

impl ServiceMesh {
    pub fn new() -> Self { Self { services: HashMap::new() } }
    pub fn register(&mut self, svc: &str, addr: &str, weight: u32) {
        let node = ServiceNode { name: svc.to_string(), address: addr.to_string(), weight, healthy: true };
        self.services.entry(svc.to_string()).or_insert_with(Vec::new).push(node);
    }
    pub fn healthy_services(&self, svc: &str) -> usize {
        self.services.get(svc).map(|v| v.iter().filter(|n| n.healthy).count()).unwrap_or(0)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut m = ServiceMesh::new(); m.register("api", "10.0.0.1", 100); } }
