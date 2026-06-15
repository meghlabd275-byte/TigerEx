//! Proof of Reserves & Liabilities System
//!
//! Dependency-free Rust implementation of a SHA-256 Merkle liabilities tree.
//! It avoids non-cryptographic hashes and demo verification paths: every proof is
//! recomputed from the account leaf to the published root.

use std::collections::HashMap;

pub type Amount = u128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Balance {
    pub user_id: String,
    pub asset: String,
    pub amount: Amount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofError {
    EmptySnapshot,
    DuplicateAccount,
    InvalidAmount,
    LeafNotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofSide {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofNode {
    pub side: ProofSide,
    pub hash: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountProof {
    pub leaf_hash: [u8; 32],
    pub path: Vec<ProofNode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleTree {
    pub root: [u8; 32],
    pub leaves: Vec<[u8; 32]>,
    pub total_liability: Amount,
    pub asset_totals: HashMap<String, Amount>,
}

#[derive(Default)]
pub struct ProofOfReserves {
    pub trees: HashMap<String, MerkleTree>,
    leaf_index: HashMap<String, usize>,
    levels: Vec<Vec<[u8; 32]>>,
}

impl ProofOfReserves {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn generate_tree(&mut self, snapshot_id: &str, balances: Vec<Balance>) -> Result<MerkleTree, ProofError> {
        if balances.is_empty() {
            return Err(ProofError::EmptySnapshot);
        }

        let mut sorted = balances;
        sorted.sort_by(|a, b| (&a.asset, &a.user_id).cmp(&(&b.asset, &b.user_id)));

        self.leaf_index.clear();
        let mut leaves = Vec::with_capacity(sorted.len());
        let mut total_liability: Amount = 0;
        let mut asset_totals = HashMap::new();

        for balance in &sorted {
            if balance.amount == 0 {
                return Err(ProofError::InvalidAmount);
            }
            let key = account_key(&balance.user_id, &balance.asset);
            if self.leaf_index.contains_key(&key) {
                return Err(ProofError::DuplicateAccount);
            }
            total_liability = total_liability.checked_add(balance.amount).ok_or(ProofError::InvalidAmount)?;
            *asset_totals.entry(balance.asset.to_ascii_uppercase()).or_insert(0) += balance.amount;
            let leaf = account_leaf_hash(balance);
            self.leaf_index.insert(key, leaves.len());
            leaves.push(leaf);
        }

        self.levels = build_levels(leaves.clone());
        let root = self.levels.last().and_then(|level| level.first()).copied().ok_or(ProofError::EmptySnapshot)?;
        let tree = MerkleTree { root, leaves, total_liability, asset_totals };
        self.trees.insert(snapshot_id.to_string(), tree.clone());
        Ok(tree)
    }

    pub fn proof_for(&self, user_id: &str, asset: &str) -> Result<AccountProof, ProofError> {
        let mut index = *self.leaf_index.get(&account_key(user_id, asset)).ok_or(ProofError::LeafNotFound)?;
        let leaf_hash = self.levels.first().and_then(|leaves| leaves.get(index)).copied().ok_or(ProofError::LeafNotFound)?;
        let mut path = Vec::new();

        for level in &self.levels[..self.levels.len().saturating_sub(1)] {
            let is_right = index % 2 == 1;
            let sibling_index = if is_right { index - 1 } else { index + 1 };
            let sibling_hash = level.get(sibling_index).copied().unwrap_or_else(|| level[index]);
            path.push(ProofNode { side: if is_right { ProofSide::Left } else { ProofSide::Right }, hash: sibling_hash });
            index /= 2;
        }

        Ok(AccountProof { leaf_hash, path })
    }

    pub fn verify_proof(root: [u8; 32], balance: &Balance, proof: &AccountProof) -> bool {
        let expected_leaf = account_leaf_hash(balance);
        if expected_leaf != proof.leaf_hash {
            return false;
        }
        let mut current = proof.leaf_hash;
        for node in &proof.path {
            current = match node.side {
                ProofSide::Left => parent_hash(node.hash, current),
                ProofSide::Right => parent_hash(current, node.hash),
            };
        }
        current == root
    }

    pub fn get_root_hash_hex(&self, snapshot_id: &str) -> Option<String> {
        self.trees.get(snapshot_id).map(|tree| hex(&tree.root))
    }
}

fn account_key(user_id: &str, asset: &str) -> String {
    format!("{}:{}", user_id, asset.to_ascii_uppercase())
}

fn account_leaf_hash(balance: &Balance) -> [u8; 32] {
    sha256(format!("leaf:v1:{}:{}:{}", balance.user_id, balance.asset.to_ascii_uppercase(), balance.amount).as_bytes())
}

fn parent_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut data = [0u8; 65];
    data[0] = 1;
    data[1..33].copy_from_slice(&left);
    data[33..65].copy_from_slice(&right);
    sha256(&data)
}

fn build_levels(mut current: Vec<[u8; 32]>) -> Vec<Vec<[u8; 32]>> {
    let mut levels = vec![current.clone()];
    while current.len() > 1 {
        let mut next = Vec::with_capacity((current.len() + 1) / 2);
        for pair in current.chunks(2) {
            let left = pair[0];
            let right = pair.get(1).copied().unwrap_or(left);
            next.push(parent_hash(left, right));
        }
        current = next.clone();
        levels.push(next);
    }
    levels
}

fn hex(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const H0: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const K: [u32; 64] = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut msg = input.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 { msg.push(0); }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut h = H0;
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            let j = i * 4;
            *word = u32::from_be_bytes([chunk[j], chunk[j + 1], chunk[j + 2], chunk[j + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g; g = f; f = e; e = d.wrapping_add(temp1); d = c; c = b; b = a; a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) { *slot = slot.wrapping_add(value); }
    }
    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() { out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes()); }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn balance(user: &str, asset: &str, amount: Amount) -> Balance {
        Balance { user_id: user.to_string(), asset: asset.to_string(), amount }
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(hex(&sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn generates_and_verifies_account_proof() {
        let mut por = ProofOfReserves::new();
        let tree = por.generate_tree("2026-06-15T00:00:00Z", vec![
            balance("user1", "BTC", 100_000_000),
            balance("user2", "BTC", 250_000_000),
            balance("user3", "ETH", 5_000_000_000_000_000_000),
        ]).unwrap();
        let proof = por.proof_for("user2", "BTC").unwrap();
        assert!(ProofOfReserves::verify_proof(tree.root, &balance("user2", "BTC", 250_000_000), &proof));
        assert!(!ProofOfReserves::verify_proof(tree.root, &balance("user2", "BTC", 1), &proof));
        assert_eq!(tree.asset_totals.get("BTC"), Some(&350_000_000));
    }

    #[test]
    fn rejects_duplicate_and_zero_balances() {
        let mut por = ProofOfReserves::new();
        assert_eq!(por.generate_tree("bad", vec![balance("u", "USDT", 0)]).unwrap_err(), ProofError::InvalidAmount);
        assert_eq!(por.generate_tree("dup", vec![balance("u", "USDT", 1), balance("u", "usdt", 2)]).unwrap_err(), ProofError::DuplicateAccount);
    }
}
