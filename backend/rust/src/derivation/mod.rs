//! Derivation Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedWallet { pub parent: String, pub path: String, pub address: String }

pub struct DerivationService { wallets: HashMap<String, DerivedWallet> }

impl DerivationService { pub fn new() -> Self { Self { wallets: HashMap::new() } }
    pub fn derive(&mut self, parent: &str, path: &str) -> String {
        let addr = format!("0x{}{:08x}", &parent[2..6], path.len() * 1234);
        self.wallets.insert(addr.clone(), DerivedWallet { parent: parent.to_string(), path: path.to_string(), address: addr.clone() });
        addr
    }
    pub fn get(&self, addr: &str) -> Option<&DerivedWallet> { self.wallets.get(addr) }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut d = DerivationService::new(); let addr = d.derive("0xParent", "m/44'/0'/0'/0/0"); assert!(!addr.is_empty()); } }
