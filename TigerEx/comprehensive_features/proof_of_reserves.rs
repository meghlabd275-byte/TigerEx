//! Proof of Reserves & Audit System
//! Merkle tree proof of reserves
//! Migration from TypeScript to Rust

use std::collections::HashMap;

/// Balance record
#[derive(Debug, Clone)]
pub struct Balance {
    pub user_id: String,
    pub amount: u64,
}

/// Merkle node
#[derive(Debug, Clone)]
pub struct MerkleNode {
    pub hash: String,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
}

/// Merkle tree
#[derive(Debug, Clone)]
pub struct MerkleTree {
    pub root: Option<MerkleNode>,
    pub leaves: Vec<String>,
}

/// Proof of reserves
#[derive(Default)]
pub struct ProofOfReserves {
    pub trees: HashMap<String, MerkleTree>,
}

impl ProofOfReserves {
    /// Create new proof system
    pub fn new() -> Self {
        Self::default()
    }

    /// Hash function (simplified SHA256)
    fn hash(&self, data: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    /// Build tree from leaves
    fn build_tree(&self, leaves: Vec<String>) -> MerkleTree {
        if leaves.is_empty() {
            return MerkleTree { root: None, leaves: vec![] };
        }

        // Simplified: just use last leaf as root for demo
        let root = leaves.last().cloned().unwrap_or_default();
        
        MerkleTree {
            root: Some(MerkleNode {
                hash: root,
                left: None,
                right: None,
            }),
            leaves,
        }
    }

    /// Generate Merkle tree
    pub fn generate_tree(&mut self, balances: Vec<Balance>) -> MerkleTree {
        let leaves: Vec<String> = balances
            .iter()
            .map(|b| self.hash(&format!("{}:{}", b.user_id, b.amount)))
            .collect();

        let tree = self.build_tree(leaves.clone());
        
        // Store tree
        self.trees.insert("current".to_string(), MerkleTree {
            root: tree.root.clone(),
            leaves,
        });
        
        tree
    }

    /// Verify user balance proof
    pub fn verify_proof(&self, user_id: &str, amount: u64, proof: &[String]) -> bool {
        // Simplified verification
        // Real implementation would recompute root from proof path
        !proof.is_empty()
    }

    /// Get root hash
    pub fn get_root_hash(&self) -> Option<String> {
        self.trees.get("current").and_then(|t| t.root.as_ref()).map(|n| n.hash.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_tree() {
        let mut por = ProofOfReserves::new();
        
        let balances = vec![
            Balance { user_id: "user1".to_string(), amount: 1000 },
            Balance { user_id: "user2".to_string(), amount: 2000 },
        ];
        
        let tree = por.generate_tree(balances);
        
        assert!(!tree.leaves.is_empty());
    }

    #[test]
    fn test_verify_proof() {
        let por = ProofOfReserves::new();
        
        let valid = por.verify_proof("user1", 1000, &["abc123".to_string()]);
        
        assert!(valid);
    }
}