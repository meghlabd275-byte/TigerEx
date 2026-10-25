// Merkle Tree - Proof of Reserves
//
// Real SHA-256 merkle tree with verifiable inclusion proofs.
//
// The previous implementation hashed with `DefaultHasher` (not a
// cryptographic hash, and not stable across runs) and its `verify_proof`
// returned `true` for any non-empty proof, so a proof of reserves could not be
// trusted. Here leaves and internal nodes are hashed with SHA-256 and a proof
// is a list of sibling hashes that must reconstruct the root.

use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Domain separator so a leaf hash can never equal an internal node hash.
const LEAF_PREFIX: u8 = 0x00;
const NODE_PREFIX: u8 = 0x01;

/// A sibling hash and whether it sits on the right of the path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofStep {
    pub hash: String,
    /// True when the sibling is the right child at this level.
    pub right: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MerkleNode {
    pub hash: String,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
    pub value: Option<String>,
}

pub fn hash_leaf(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update([LEAF_PREFIX]);
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn hash_internal(left: &str, right: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update([NODE_PREFIX]);
    hasher.update(left.as_bytes());
    hasher.update(right.as_bytes());
    hex::encode(hasher.finalize())
}

/// Root of the subtree spanning `hashes`, computed the same way the tree is.
fn subtree_root(hashes: &[String]) -> String {
    if hashes.len() == 1 {
        return hashes[0].clone();
    }
    let mid = hashes.len() / 2;
    hash_internal(&subtree_root(&hashes[..mid]), &subtree_root(&hashes[mid..]))
}

/// Collect the sibling hashes on the path from `index` up to the root.
fn proof_for(hashes: &[String], index: usize) -> Vec<ProofStep> {
    if hashes.len() == 1 {
        return Vec::new();
    }
    let mid = hashes.len() / 2;
    if index < mid {
        let mut proof = proof_for(&hashes[..mid], index);
        proof.push(ProofStep {
            hash: subtree_root(&hashes[mid..]),
            right: true,
        });
        proof
    } else {
        let mut proof = proof_for(&hashes[mid..], index - mid);
        proof.push(ProofStep {
            hash: subtree_root(&hashes[..mid]),
            right: false,
        });
        proof
    }
}

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
            let hash = hash_leaf(&items[0]);
            let node = MerkleNode {
                hash: hash.clone(),
                left: None,
                right: None,
                value: Some(items[0].clone()),
            };
            self.nodes.insert(hash, node.clone());
            return node;
        }

        let mid = items.len() / 2;
        let left = self.build_tree(items[..mid].to_vec());
        let right = self.build_tree(items[mid..].to_vec());

        let hash = hash_internal(&left.hash, &right.hash);
        let node = MerkleNode {
            hash: hash.clone(),
            left: Some(Box::new(left)),
            right: Some(Box::new(right)),
            value: None,
        };
        self.nodes.insert(hash, node.clone());
        node
    }

    pub fn get_root_hash(&self) -> Option<String> {
        self.root.as_ref().map(|n| n.hash.clone())
    }

    pub fn leaf_count(&self) -> usize {
        self.leaves.len()
    }

    /// Build an inclusion proof for the leaf at `leaf_index`.
    ///
    /// The proof follows the same recursive split the tree was built with, so
    /// it reconstructs the root exactly. Returns `None` when the index is out
    /// of range.
    pub fn get_proof(&self, leaf_index: usize) -> Option<Vec<ProofStep>> {
        if leaf_index >= self.leaves.len() {
            return None;
        }
        let hashes: Vec<String> = self.leaves.iter().map(|l| hash_leaf(l)).collect();
        Some(proof_for(&hashes, leaf_index))
    }

    /// Verify an inclusion proof against a known root.
    pub fn verify_proof(root: &str, leaf: &str, proof: &[ProofStep]) -> bool {
        let mut current = hash_leaf(leaf);
        for step in proof {
            current = if step.right {
                hash_internal(&current, &step.hash)
            } else {
                hash_internal(&step.hash, &current)
            };
        }
        current == root
    }

    /// Verify against this tree's own root.
    pub fn verify_proof_against_root(&self, leaf: &str, proof: &[ProofStep]) -> bool {
        match self.get_root_hash() {
            Some(root) => Self::verify_proof(&root, leaf, proof),
            None => false,
        }
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

    pub fn merkle_root(&self) -> &str {
        &self.merkle_root
    }

    pub fn timestamp(&self) -> i64 {
        self.timestamp
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

    fn tree() -> MerkleTree {
        MerkleTree::new(vec![
            "alice:1.0".to_string(),
            "bob:2.0".to_string(),
            "carol:3.0".to_string(),
            "dave:4.0".to_string(),
        ])
    }

    #[test]
    fn every_leaf_proves_inclusion() {
        let tree = tree();
        let root = tree.get_root_hash().unwrap();

        for (index, leaf) in ["alice:1.0", "bob:2.0", "carol:3.0", "dave:4.0"]
            .iter()
            .enumerate()
        {
            let proof = tree.get_proof(index).unwrap();
            assert!(
                MerkleTree::verify_proof(&root, leaf, &proof),
                "leaf {leaf} should verify"
            );
        }
    }

    #[test]
    fn a_tampered_leaf_fails_verification() {
        let tree = tree();
        let root = tree.get_root_hash().unwrap();
        let proof = tree.get_proof(1).unwrap();

        // The old implementation returned true for any non-empty proof.
        assert!(!MerkleTree::verify_proof(&root, "bob:999.0", &proof));
    }

    #[test]
    fn a_tampered_proof_fails_verification() {
        let tree = tree();
        let root = tree.get_root_hash().unwrap();
        let mut proof = tree.get_proof(2).unwrap();
        proof[0].hash = hash_leaf("mallory:0.0");

        assert!(!MerkleTree::verify_proof(&root, "carol:3.0", &proof));
    }

    #[test]
    fn an_empty_proof_only_verifies_the_single_leaf_root() {
        let single = MerkleTree::new(vec!["only".to_string()]);
        let root = single.get_root_hash().unwrap();
        assert!(MerkleTree::verify_proof(&root, "only", &[]));
        assert!(!MerkleTree::verify_proof(&root, "other", &[]));
    }

    #[test]
    fn an_out_of_range_index_has_no_proof() {
        let tree = tree();
        assert!(tree.get_proof(4).is_none());
    }

    #[test]
    fn odd_leaf_counts_still_prove() {
        let tree = MerkleTree::new(vec![
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
        ]);
        let root = tree.get_root_hash().unwrap();
        for (index, leaf) in ["a", "b", "c"].iter().enumerate() {
            let proof = tree.get_proof(index).unwrap();
            assert!(MerkleTree::verify_proof(&root, leaf, &proof));
        }
    }

    #[test]
    fn hashes_are_stable_and_hex_encoded() {
        let a = hash_leaf("x");
        assert_eq!(a.len(), 64);
        assert_eq!(a, hash_leaf("x"));
        assert_ne!(a, hash_leaf("y"));
        // A leaf and an internal node over the same bytes must not collide.
        assert_ne!(hash_leaf("x"), hash_internal("x", "x"));
    }
}
