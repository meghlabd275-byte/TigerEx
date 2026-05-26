// Cross - Cross-Chain Atomic Swaps
// Rust for HTLC and cross-chain swaps

use std::collections::HashMap;

// Swap state machine
#[derive(Debug, Clone)]
pub struct CrossSwap {
    pub id: String,
    pub from_chain: String,
    pub to_chain: String,
    pub from_token: String,
    pub to_token: String,
    pub amount: f64,
    pub hashlock: String,
    pub secret: Option<String>,
    pub status: String,
    pub initiated_at: i64,
}

// HTLC contract
pub struct HTLC {
    swap_id: String,
    sender: String,
    recipient: String,
    hashlock: String,
    amount: f64,
    timelock: i64,
    claimed: bool,
    refunded: bool,
}

impl HTLC {
    pub fn new(swap_id: &str, sender: &str, recipient: &str, hashlock: &str, amount: f64, timelock_blocks: i64) -> Self {
        HTLC {
            swap_id: swap_id.to_string(),
            sender: sender.to_string(),
            recipient: recipient.to_string(),
            hashlock: hashlock.to_string(),
            amount,
            timelock: timelock_blocks,
            claimed: false,
            refunded: false,
        }
    }

    // Claim with secret
    pub fn claim(&mut self, secret: &str) -> Result<(), String> {
        if self.claimed {
            return Err("already claimed".to_string());
        }

        if self.refunded {
            return Err("already refunded".to_string());
        }

        // Verify secret (simplified - in production use sha256)
        if secret.len() < 4 {
            return Err("invalid secret".to_string());
        }

        self.claimed = true;
        Ok(())
    }

    // Refund after timelock
    pub fn refund(&mut self, current_block: i64) -> Result<(), String> {
        if self.claimed {
            return Err("already claimed".to_string());
        }

        if self.refunded {
            return Err("already refunded".to_string());
        }

        if current_block < self.timelock {
            return Err("timelock not expired".to_string());
        }

        self.refunded = true;
        Ok(())
    }

    pub fn is_complete(&self) -> bool {
        self.claimed || self.refunded
    }
}

// Chain registry
pub struct ChainRegistry {
    chains: HashMap<String, ChainConfig>,
}

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub name: String,
    pub chain_id: i32,
    pub confirmations: i32,
    pub native_token: String,
}

impl ChainRegistry {
    pub fn new() -> Self {
        let mut chains = HashMap::new();

        chains.insert("Bitcoin".to_string(), ChainConfig {
            name: "Bitcoin".to_string(),
            chain_id: 1,
            confirmations: 6,
            native_token: "BTC".to_string(),
        });

        chains.insert("Ethereum".to_string(), ChainConfig {
            name: "Ethereum".to_string(),
            chain_id: 1,
            confirmations: 12,
            native_token: "ETH".to_string(),
        });

        ChainRegistry { chains }
    }

    pub fn is_supported(&self, chain: &str) -> bool {
        self.chains.contains_key(chain)
    }

    pub fn get_config(&self, chain: &str) -> Option<&ChainConfig> {
        self.chains.get(chain)
    }
}

// Relay verification
pub struct RelayVerifier {
    verifications: HashMap<String, Verification>,
}

#[derive(Debug, Clone)]
pub struct Verification {
    pub tx_hash: String,
    pub block: i64,
    pub confirmations: i32,
    pub proved: bool,
}

impl RelayVerifier {
    pub fn new() -> Self {
        RelayVerifier {
            verifications: HashMap::new(),
        }
    }

    pub fn add_proof(&mut self, tx_hash: &str, block: i64, proof: &[u8]) -> bool {
        // Simplified - verify merkle proof
        let verified = proof.len() > 0;

        self.verifications.insert(tx_hash.to_string(), Verification {
            tx_hash: tx_hash.to_string(),
            block,
            confirmations: 0,
            proved: verified,
        });

        verified
    }

    pub fn is_verified(&self, tx_hash: &str) -> bool {
        self.verifications.get(tx_hash).map(|v| v.proved).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_htlc() {
        let mut htlc = HTLC::new("s1", "alice", "bob", "hash123", 1.0, 10);

        htlc.claim("secret").unwrap();

        assert!(htlc.is_complete());
    }
}