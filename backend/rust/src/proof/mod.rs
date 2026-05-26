//! Proof of Reserves - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReserveProof {
    pub id: String,
    pub total_liabilities: f64,
    pub total_assets: f64,
    pub merkle_root: String,
    pub timestamp: i64,
    pub verified: bool,
}

pub struct ProofOfReserve {
    proofs: HashMap<String, ReserveProof>,
}

impl ProofOfReserve {
    pub fn new() -> Self { Self { proofs: HashMap::new() } }
    pub fn generate(&mut self, liabilities: f64, assets: f64) -> String {
        let id = format!("POR_{}", self.proofs.len());
        let root = format!("{:032x}", (liabilities + assets) as u64);
        self.proofs.insert(id.clone(), ReserveProof { id: id.clone(), total_liabilities: liabilities, total_assets: assets, merkle_root: root, timestamp: now_ms(), verified: false });
        id
    }
    pub fn verify(&mut self, id: &str) -> Result<bool, String> {
        let p = self.proofs.get_mut(id).ok_or("Proof not found")?;
        p.verified = p.total_assets >= p.total_liabilities;
        Ok(p.verified)
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut p = ProofOfReserve::new(); let id = p.generate(1000000.0, 1100000.0); assert!(!id.is_empty()); } }
