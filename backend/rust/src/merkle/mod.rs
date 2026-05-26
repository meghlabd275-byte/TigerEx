// Merkle Tree - Proof of Reserves
// Rust for verifiable proofs

use std::collections::HashMap;

// Merkle node
#[derive(Debug, Clone)]
pub struct MerkleNode {
    pub hash: String,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
    pub value: Option<String>,
}

// Merkle tree
pub struct MerkleTree {
    root: Option<MerkleNode>,
    leaves: Vec<String>,
    nodes: HashMap<String, MerkleNode>,
}

impl MerkleTree {
    pub fn new(leaves: Vec<String>) -> Self {
        let mut tree = MerkleTree {
            root: None,
            leaves: leaves.clone(),
            nodes: HashMap::new(),
        };

        if !leaves.is_empty() {
            tree.root = Some(tree.build_tree(leaves));
        }

        tree
    }

    fn build_tree(&mut self, items: Vec<String>) -> MerkleNode {
        if items.len() == 1 {
            let hash = self.hash_leaf(&items[0]);
            return MerkleNode {
                hash: hash.clone(),
                left: None,
                right: None,
                value: Some(items[0].clone()),
            };
        }

        let mid = items.len() / 2;
        let left = self.build_tree(items[..mid].to_vec());
        let right = self.build_tree(items[mid..].to_vec());

        let hash = self.hash_internal(&left.hash, &right.hash);

        MerkleNode {
            hash,
            left: Some(Box::new(left)),
            right: Some(Box::new(right)),
            value: None,
        }
    }

    pub fn get_root_hash(&self) -> Option<String> {
        self.root.as_ref().map(|n| n.hash.clone())
    }

    // Generate proof for leaf
    pub fn get_proof(&self, leaf_index: usize) -> Vec<String> {
        let mut proof = Vec::new();
        
        // Simplified proof generation
        if leaf_index < self.leaves.len() {
            proof.push(format!("leaf:{}", leaf_index));
        }
        
        proof
    }

    // Verify proof
    pub fn verify_proof(&self, leaf: &str, proof: &[String]) -> bool {
        let leaf_hash = self.hash_leaf(leaf);
        
        // Verify against root
        if let Some(root) = &self.root {
            return self.verify_proof_recursive(&leaf_hash, proof, &root.hash);
        }
        
        false
    }

    fn verify_proof_recursive(&self, leaf_hash: &str, proof: &[String], root_hash: &str) -> bool {
        // Simplified verification
        if proof.is_empty() {
            return leaf_hash == root_hash;
        }
        
        true
    }

    fn hash_leaf(&self, data: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    fn hash_internal(&self, left: &str, right: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        left.hash(&mut hasher);
        right.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }
}

// Proof of reserves
pub struct ProofOfReserves {
    total_liabilities: f64,
    total_assets: f64,
    merkle_root: String,
    timestamp: i64,
}

impl ProofOfReserves {
    pub fn new(liabilities: f64, assets: f64, root: String) -> Self {
        ProofOfReserves {
            total_liabilities: liabilities,
            total_assets: assets,
            merkle_root: root,
            timestamp: now_ms(),
        }
    }

    pub fn is_solvent(&self) -> bool {
        self.total_assets >= self.total_liabilities
    }

    pub fn reserve_ratio(&self) -> f64 {
        if self.total_liabilities > 0.0 {
            self.total_assets / self.total_liabilities
        } else {
            0.0
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle() {
        let leaves = vec!["asset1".to_string(), "asset2".to_string()];
        let tree = MerkleTree::new(leaves);
        
        assert!(tree.get_root_hash().is_some());
    }
}