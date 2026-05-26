//! Custody Protection - Cold storage & insurance
//! Migration: TypeScript -> Rust (security-critical)

use std::collections::HashMap;
use std::sync::Mutex;

/// Network type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Network {
    Bitcoin,
    Ethereum,
    BSC,
    Polygon,
    Solana,
}

/// Cold address
#[derive(Debug, Clone)]
pub struct ColdAddress {
    pub address: String,
    pub public_key: String,
    pub network: Network,
    pub balance: f64,
}

/// Protection policy
#[derive(Debug, Clone)]
pub struct Policy {
    pub id: String,
    pub coverage: f64,
    pub premium: f64,
    pub active: bool,
}

/// Custody system
pub struct CustodySystem {
    cold_addresses: Mutex<Vec<ColdAddress>>,
    policies: Mutex<Vec<Policy>>,
    total_insured: Mutex<f64>,
}

impl CustodySystem {
    pub fn new() -> Self {
        Self {
            cold_addresses: Mutex::new(Vec::new()),
            policies: Mutex::new(Vec::new()),
            total_insured: Mutex::new(0.0),
        }
    }

    /// Add cold address
    pub fn add_cold_address(&self, address: &str, pubkey: &str, network: Network) -> &ColdAddress {
        let addr = ColdAddress {
            address: address.to_string(),
            public_key: pubkey.to_string(),
            network,
            balance: 0.0,
        };
        
        self.cold_addresses.lock().unwrap().push(addr.clone());
        
        // Return reference would need Arc, simplifying
        &self.cold_addresses.lock().unwrap().last().unwrap()
    }

    /// Get cold storage status
    pub fn get_status(&self) -> ColdStatus {
        let addresses = self.cold_addresses.lock().unwrap();
        let total = addresses.iter().map(|a| a.balance).sum();
        
        ColdStatus {
            online: 0,
            offline: addresses.len() as u64,
            total_value: total,
        }
    }

    /// Purchase insurance
    pub fn add_policy(&self, coverage: f64, premium: f64) -> Policy {
        let policy = Policy {
            id: format!("policy_{}", self.policies.lock().unwrap().len()),
            coverage,
            premium,
            active: true,
        };
        
        *self.total_insured.lock().unwrap() += coverage;
        self.policies.lock().unwrap().push(policy.clone());
        
        policy
    }

    /// Get total insured
    pub fn total_insured(&self) -> f64 {
        *self.total_insured.lock().unwrap()
    }
}

/// Cold storage status
#[derive(Debug, Clone)]
pub struct ColdStatus {
    pub online: u64,
    pub offline: u64,
    pub total_value: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custody() {
        let custody = CustodySystem::new();
        
        custody.add_cold_address("0x123...", "pubkey123", Network::Ethereum);
        
        let status = custody.get_status();
        assert_eq!(status.offline, 1);
    }

    #[test]
    fn test_policy() {
        let custody = CustodySystem::new();
        
        let policy = custody.add_policy(1_000_000.0, 0.01);
        
        assert_eq!(custody.total_insured(), 1_000_000.0);
    }
}