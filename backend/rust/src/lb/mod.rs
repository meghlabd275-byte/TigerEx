//! Load Balancer - Rust Implementation

use serde::{Serialize, Deserialize};

pub struct LoadBalancer {
    backends: Vec<Backend>,
    current: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backend { pub address: String, pub weight: u32 }

impl LoadBalancer {
    pub fn new() -> Self { Self { backends: vec![], current: 0 } }
    pub fn add_backend(&mut self, addr: &str, weight: u32) {
        self.backends.push(Backend { address: addr.to_string(), weight });
    }
    pub fn next(&mut self) -> Option<String> {
        if self.backends.is_empty() { return None; }
        self.current = (self.current + 1) % self.backends.len();
        Some(self.backends[self.current].address.clone())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut lb = LoadBalancer::new(); lb.add_backend("10.0.0.1", 100); } }
