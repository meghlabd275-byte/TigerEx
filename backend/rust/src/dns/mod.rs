//! DNS Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DNSRecord { pub name: String, pub record_type: Type, pub value: String, pub ttl: u32 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Type { A, AAAA, CNAME, TXT }

pub struct DNSService {
    records: HashMap<String, DNSRecord>,
}

impl DNSService {
    pub fn new() -> Self { Self { records: HashMap::new() } }
    pub fn add_record(&mut self, name: &str, rt: Type, value: &str, ttl: u32) {
        self.records.insert(name.to_string(), DNSRecord { name: name.to_string(), record_type: rt, value: value.to_string(), ttl });
    }
    pub fn resolve(&self, name: &str) -> Option<String> { self.records.get(name).map(|r| r.value.clone()) }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut d = DNSService::new(); d.add_record("api.tigerex.com", Type::A, "1.2.3.4", 300); } }
