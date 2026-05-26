//! Blockchain Node - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub height: u64,
    pub hash: String,
    pub prev_hash: String,
    pub timestamp: i64,
    pub txs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub chain: String,
    pub height: u64,
    pub peers: u32,
}

pub struct BlockchainNode {
    pub chain: String,
    pub height: u64,
    pub mempool: Vec<String>,
}

impl BlockchainNode {
    pub fn new(chain: &str) -> Self { Self { chain: chain.to_string(), height: 0, mempool: vec![] } }
    pub fn add_tx(&mut self, tx: &str) { self.mempool.push(tx.to_string()); }
    pub fn mine(&mut self) -> Block {
        self.height += 1;
        let hash = format!("{:032x}", self.height * 12345);
        Block { height: self.height, hash: hash.clone(), prev_hash: format!("{:032x}", (self.height - 1) * 12345), timestamp: now_ms(), txs: std::mem::take(&mut self.mempool) }
    }
    pub fn info(&self) -> NodeInfo { NodeInfo { chain: self.chain.clone(), height: self.height, peers: 10 } }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut n = BlockchainNode::new("BTC"); n.add_tx("tx1"); let b = n.mine(); assert!(b.height == 1); } }
