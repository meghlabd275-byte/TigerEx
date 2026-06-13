//! TigerEx Blockchain Node Manager - Rust Implementation
//! 
//! Multi-chain blockchain node management for BTC, ETH, SOL, etc.
//! 
//! Migration from Go to Rust for reliable node communication

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Blockchain network
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Chain {
    Bitcoin,
    Ethereum,
    Solana,
    Polygon,
    BSC,
    Arbitrum,
    Optimism,
    Avalanche,
}

/// Node status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    Active,
    Syncing,
    Offline,
    Error,
}

/// Transaction
#[derive(Debug, Clone)]
pub struct BlockchainTx {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub value: u64,
    pub asset: String,
    pub chain: Chain,
    pub block_number: u64,
    pub confirmations: u32,
    pub timestamp: u64,
    pub status: TxStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxStatus {
    Pending,
    Confirmed,
    Failed,
}

/// Block
#[derive(Debug, Clone)]
pub struct Block {
    pub number: u64,
    pub hash: String,
    pub parent_hash: String,
    pub timestamp: u64,
    pub transactions: Vec<String>,
}

/// Node
#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub chain: Chain,
    pub url: String,
    pub status: NodeStatus,
    pub height: u64,
    pub latency_ms: u64,
    pub last_check: u64,
}

impl Node {
    pub fn new(chain: Chain, url: &str) -> Self {
        Node {
            id: format!("node-{:?}-{}", chain, url.len()),
            chain,
            url: url.to_string(),
            status: NodeStatus::Active,
            height: 0,
            latency_ms: 0,
            last_check: current_timestamp(),
        }
    }
}

/// Blockchain Node Manager
pub struct BlockchainNodeManager {
    nodes: HashMap<Chain, Vec<Node>>,
    tx_cache: HashMap<String, BlockchainTx>,
    blocks: HashMap<Chain, Vec<Block>>,
}

impl BlockchainNodeManager {
    pub fn new() -> Self {
        BlockchainNodeManager {
            nodes: HashMap::new(),
            tx_cache: HashMap::new(),
            blocks: HashMap::new(),
        }
    }
    
    /// Add node
    pub fn add_node(&mut self, chain: Chain, url: &str) {
        let node = Node::new(chain, url);
        self.nodes.entry(chain).or_insert_with(Vec::new).push(node);
    }
    
    /// Get best node for chain
    pub fn get_best_node(&self, chain: Chain) -> Option<&Node> {
        self.nodes.get(&chain)?
            .iter()
            .filter(|n| n.status == NodeStatus::Active)
            .min_by_key(|n| n.latency_ms)
    }
    
    /// Submit transaction (simulated)
    pub fn submit_tx(&self, chain: Chain, tx: &str) -> Result<String, String> {
        let hash = format!("0x{}", hex::encode(&tx.as_bytes()[..32]));
        Ok(hash)
    }
    
    /// Get transaction
    pub fn get_tx(&self, chain: Chain, hash: &str) -> Option<&BlockchainTx> {
        self.tx_cache.get(hash)
    }
    
    /// Get block by number
    pub fn get_block(&self, chain: Chain, number: u64) -> Option<&Block> {
        self.blocks.get(&chain)?.iter().find(|b| b.number == number)
    }
    
    /// Get latest block height
    pub fn get_latest_height(&self, chain: Chain) -> u64 {
        self.blocks.get(&chain)
            .and_then(|blocks| blocks.last())
            .map(|b| b.number)
            .unwrap_or(0)
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_add_node() {
        let mut mgr = BlockchainNodeManager::new();
        mgr.add_node(Chain::Bitcoin, "https://btc-node.example.com");
        assert!(mgr.nodes.contains_key(&Chain::Bitcoin));
    }
}