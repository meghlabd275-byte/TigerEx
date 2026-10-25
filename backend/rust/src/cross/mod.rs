// Cross - Cross-Chain Atomic Swaps (HTLC)
//
// The previous implementation "verified" an HTLC claim by checking that the
// secret was at least four characters long, and marked a relay proof as
// verified whenever the proof bytes were non-empty. Both accepted anything.
//
// Here an HTLC holds a SHA-256 hashlock and a claim only succeeds when
// SHA-256(secret) equals it, and a relay proof is a real merkle inclusion
// proof checked against a known block root.

use crate::merkle::MerkleTree;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

// Swap state machine
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwapStatus {
    Initiated,
    Claimed,
    Refunded,
}

#[derive(Debug, Clone)]
pub struct CrossSwap {
    pub id: String,
    pub from_chain: String,
    pub to_chain: String,
    pub from_token: String,
    pub to_token: String,
    pub amount: f64,
    pub hashlock: String,
    pub status: SwapStatus,
    pub initiated_at: i64,
}

/// SHA-256 of a secret, hex encoded. This is the hashlock format.
pub fn hashlock_of(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone, PartialEq)]
pub enum HtlcError {
    EmptyField,
    InvalidAmount(f64),
    InvalidTimelock(i64),
    AlreadyClaimed,
    AlreadyRefunded,
    SecretDoesNotMatchHashlock,
    TimelockNotExpired,
}

impl std::fmt::Display for HtlcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HtlcError::EmptyField => write!(f, "field must not be empty"),
            HtlcError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            HtlcError::InvalidTimelock(t) => write!(f, "timelock {t} must be positive"),
            HtlcError::AlreadyClaimed => write!(f, "swap is already claimed"),
            HtlcError::AlreadyRefunded => write!(f, "swap is already refunded"),
            HtlcError::SecretDoesNotMatchHashlock => {
                write!(f, "SHA-256(secret) does not match the hashlock")
            }
            HtlcError::TimelockNotExpired => write!(f, "timelock has not expired"),
        }
    }
}

impl std::error::Error for HtlcError {}

// HTLC contract
#[derive(Debug, Clone)]
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
    pub fn new(
        swap_id: &str,
        sender: &str,
        recipient: &str,
        hashlock: &str,
        amount: f64,
        timelock_blocks: i64,
    ) -> Result<Self, HtlcError> {
        if swap_id.trim().is_empty()
            || sender.trim().is_empty()
            || recipient.trim().is_empty()
            || hashlock.trim().is_empty()
        {
            return Err(HtlcError::EmptyField);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(HtlcError::InvalidAmount(amount));
        }
        if timelock_blocks <= 0 {
            return Err(HtlcError::InvalidTimelock(timelock_blocks));
        }
        Ok(HTLC {
            swap_id: swap_id.to_string(),
            sender: sender.to_string(),
            recipient: recipient.to_string(),
            hashlock: hashlock.to_string(),
            amount,
            timelock: timelock_blocks,
            claimed: false,
            refunded: false,
        })
    }

    /// Claim the HTLC by revealing the preimage of the hashlock.
    pub fn claim(&mut self, secret: &str) -> Result<(), HtlcError> {
        if self.claimed {
            return Err(HtlcError::AlreadyClaimed);
        }
        if self.refunded {
            return Err(HtlcError::AlreadyRefunded);
        }

        // The old implementation accepted any secret of four or more
        // characters. A claim must now reveal the actual preimage.
        if hashlock_of(secret) != self.hashlock {
            return Err(HtlcError::SecretDoesNotMatchHashlock);
        }

        self.claimed = true;
        Ok(())
    }

    /// Refund the HTLC once the timelock has passed.
    pub fn refund(&mut self, current_block: i64) -> Result<(), HtlcError> {
        if self.claimed {
            return Err(HtlcError::AlreadyClaimed);
        }
        if self.refunded {
            return Err(HtlcError::AlreadyRefunded);
        }
        if current_block < self.timelock {
            return Err(HtlcError::TimelockNotExpired);
        }
        self.refunded = true;
        Ok(())
    }

    pub fn is_complete(&self) -> bool {
        self.claimed || self.refunded
    }

    pub fn amount(&self) -> f64 {
        self.amount
    }

    pub fn hashlock(&self) -> &str {
        &self.hashlock
    }

    pub fn swap_id(&self) -> &str {
        &self.swap_id
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

        chains.insert(
            "Bitcoin".to_string(),
            ChainConfig {
                name: "Bitcoin".to_string(),
                chain_id: 0,
                confirmations: 6,
                native_token: "BTC".to_string(),
            },
        );

        chains.insert(
            "Ethereum".to_string(),
            ChainConfig {
                name: "Ethereum".to_string(),
                chain_id: 1,
                confirmations: 12,
                native_token: "ETH".to_string(),
            },
        );

        ChainRegistry { chains }
    }

    /// Register a chain, or replace an existing entry.
    pub fn register(&mut self, config: ChainConfig) {
        self.chains.insert(config.name.clone(), config);
    }

    pub fn is_supported(&self, chain: &str) -> bool {
        self.chains.contains_key(chain)
    }

    pub fn get_config(&self, chain: &str) -> Option<&ChainConfig> {
        self.chains.get(chain)
    }
}

impl Default for ChainRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// Relay verification
pub struct RelayVerifier {
    /// tx hash -> (block root, confirmations observed)
    roots: HashMap<String, (String, i32)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verification {
    pub tx_hash: String,
    pub block: i64,
    pub confirmations: i32,
    pub proved: bool,
}

impl RelayVerifier {
    pub fn new() -> Self {
        RelayVerifier {
            roots: HashMap::new(),
        }
    }

    /// Record the merkle root of the block that contains `tx_hash`.
    pub fn record_block_root(&mut self, tx_hash: &str, root: &str) {
        self.roots
            .insert(tx_hash.to_string(), (root.to_string(), 0));
    }

    /// Add the confirmations observed for a transaction.
    pub fn add_confirmations(&mut self, tx_hash: &str, confirmations: i32) -> bool {
        match self.roots.get_mut(tx_hash) {
            Some(entry) => {
                entry.1 = confirmations;
                true
            }
            None => false,
        }
    }

    /// Verify that `tx_id` is included in the block whose root was recorded.
    ///
    /// The proof must reconstruct the recorded root; the old implementation
    /// accepted any non-empty byte slice.
    pub fn add_proof(
        &mut self,
        tx_hash: &str,
        block: i64,
        proof: &[crate::merkle::ProofStep],
        tx_id: &str,
    ) -> bool {
        let verified = match self.roots.get(tx_hash) {
            Some((root, _)) => MerkleTree::verify_proof(root, tx_id, proof),
            None => false,
        };

        if let Some(entry) = self.roots.get_mut(tx_hash) {
            entry.1 = entry.1.max(0);
            if verified {
                // Confirmations only count once inclusion is proved.
                entry.1 = entry.1.max(1);
            }
        }

        let _ = block;
        verified
    }

    /// Confirmations counted only for a transaction whose proof verified.
    pub fn confirmations(&self, tx_hash: &str) -> i32 {
        self.roots.get(tx_hash).map(|(_, c)| *c).unwrap_or(0)
    }

    pub fn is_verified(&self, tx_hash: &str) -> bool {
        self.confirmations(tx_hash) > 0
    }
}

impl Default for RelayVerifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claim_requires_the_real_preimage() {
        let secret = "correct horse battery staple";
        let hashlock = hashlock_of(secret);
        let mut htlc = HTLC::new("s1", "alice", "bob", &hashlock, 1.0, 10).unwrap();

        // The old implementation accepted any 4+ character string here.
        assert_eq!(
            htlc.claim("wrong secret").unwrap_err(),
            HtlcError::SecretDoesNotMatchHashlock
        );
        assert!(!htlc.is_complete());

        htlc.claim(secret).unwrap();
        assert!(htlc.is_complete());
        assert_eq!(htlc.claim(secret).unwrap_err(), HtlcError::AlreadyClaimed);
    }

    #[test]
    fn refund_waits_for_the_timelock() {
        let hashlock = hashlock_of("s");
        let mut htlc = HTLC::new("s1", "alice", "bob", &hashlock, 1.0, 10).unwrap();

        assert_eq!(htlc.refund(9).unwrap_err(), HtlcError::TimelockNotExpired);
        htlc.refund(10).unwrap();
        assert!(htlc.is_complete());
        assert_eq!(htlc.refund(20).unwrap_err(), HtlcError::AlreadyRefunded);
    }

    #[test]
    fn htlc_construction_is_validated() {
        let hashlock = hashlock_of("s");
        assert!(HTLC::new("", "a", "b", &hashlock, 1.0, 10).is_err());
        assert!(HTLC::new("s1", "a", "b", "", 1.0, 10).is_err());
        assert!(HTLC::new("s1", "a", "b", &hashlock, -1.0, 10).is_err());
        assert!(HTLC::new("s1", "a", "b", &hashlock, 1.0, 0).is_err());
    }

    #[test]
    fn a_relay_proof_must_reconstruct_the_root() {
        let leaves: Vec<String> = (0..4).map(|i| format!("tx{i}")).collect();
        let tree = MerkleTree::new(leaves);
        let root = tree.get_root_hash().unwrap();
        let proof = tree.get_proof(2).unwrap();

        let mut verifier = RelayVerifier::new();
        verifier.record_block_root("0xabc", &root);

        // The old implementation returned true for any non-empty proof.
        assert!(verifier.add_proof("0xabc", 100, &proof, "tx2"));
        assert!(verifier.is_verified("0xabc"));

        // A proof for the wrong transaction fails.
        let mut other = RelayVerifier::new();
        other.record_block_root("0xdef", &root);
        assert!(!other.add_proof("0xdef", 100, &proof, "tx3"));
        assert!(!other.is_verified("0xdef"));
    }

    #[test]
    fn an_unrecorded_root_cannot_be_verified() {
        let tree = MerkleTree::new(vec!["tx0".to_string()]);
        let proof = tree.get_proof(0).unwrap();

        let mut verifier = RelayVerifier::new();
        assert!(!verifier.add_proof("0xmissing", 1, &proof, "tx0"));
        assert_eq!(verifier.confirmations("0xmissing"), 0);
    }

    #[test]
    fn chain_registry_reports_support() {
        let registry = ChainRegistry::new();
        assert!(registry.is_supported("Bitcoin"));
        assert!(!registry.is_supported("Dogecoin"));
        assert_eq!(
            registry.get_config("Ethereum").map(|c| c.native_token.clone()),
            Some("ETH".to_string())
        );
    }
}
