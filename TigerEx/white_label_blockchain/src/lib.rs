// TigerEx White Label Blockchain Management
// Built with Rust for high speed with ultra-low latency

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Blockchain {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub chain_id: u64,
    pub chain_type: String, // EVM, SOLANA, TON, APTOS, etc
    pub status: String,
    pub rpc_url: String,
    pub explorer_url: String,
}

pub struct BlockchainManager {
    chains: HashMap<String, Blockchain>,
}

impl BlockchainManager {
    pub fn new() -> Self {
        let mut mgr = Self { chains: HashMap::new() };
        mgr.init_defaults();
        mgr
    }

    fn init_defaults(&mut self) {
        let defaults = vec![
            ("ETH", "Ethereum", "ETH", 1, "EVM"),
            ("BSC", "Binance Smart Chain", "BNB", 56, "EVM"),
            ("POL", "Polygon", "MATIC", 137, "EVM"),
            ("ARB", "Arbitrum", "ETH", 42161, "EVM"),
            ("OP", "Optimism", "ETH", 10, "EVM"),
            ("BASE", "Base", "ETH", 8453, "EVM"),
            ("AVAX", "Avalanche", "AVAX", 43114, "EVM"),
            ("SOL", "Solana", "SOL", 0, "SOLANA"),
            ("TON", "Toncoin", "TON", 0, "TON"),
            ("APT", "Aptos", "APT", 0, "APTOS"),
        ];
        
        for (id, name, sym, cid, typ) in defaults {
            self.chains.insert(id.to_string(), Blockchain {
                id: id.to_string(),
                name: name.to_string(),
                symbol: sym.to_string(),
                chain_id: cid,
                chain_type: typ.to_string(),
                status: "ACTIVE".to_string(),
                rpc_url: format!("https://{}.example.com", id.to_lowercase()),
                explorer_url: format!("https://{}.scan.com", id.to_lowercase()),
            });
        }
    }

    pub fn add_blockchain(&mut self, id: &str, name: &str, symbol: &str, chain_id: u64, chain_type: &str) {
        self.chains.insert(id.to_string(), Blockchain {
            id: id.to_string(),
            name: name.to_string(),
            symbol: symbol.to_string(),
            chain_id,
            chain_type: chain_type.to_string(),
            status: "ACTIVE".to_string(),
            rpc_url: "".to_string(),
            explorer_url: "".to_string(),
        });
    }

    pub fn remove_blockchain(&mut self, id: &str) -> bool {
        self.chains.remove(id).is_some()
    }

    pub fn suspend_blockchain(&mut self, id: &str) -> bool {
        if let Some(chain) = self.chains.get_mut(id) {
            chain.status = "SUSPENDED".to_string();
            return true;
        }
        false
    }

    pub fn resume_blockchain(&mut self, id: &str) -> bool {
        if let Some(chain) = self.chains.get_mut(id) {
            chain.status = "ACTIVE".to_string();
            return true;
        }
        false
    }

    pub fn get_blockchain(&self, id: &str) -> Option<&Blockchain> {
        self.chains.get(id)
    }

    pub fn get_all_blockchains(&self) -> Vec<&Blockchain> {
        self.chains.values().collect()
    }

    pub fn get_evm_chains(&self) -> Vec<&Blockchain> {
        self.chains.values().filter(|c| c.chain_type == "EVM").collect()
    }
}

fn main() {
    println!("TigerEx White Label Blockchain Management");
    
    let mut mgr = BlockchainManager::new();
    
    // Add new blockchain
    mgr.add_blockchain("NEW", "New Chain", "NEW", 99999, "EVM");
    
    // Suspend
    mgr.suspend_blockchain("ARB");
    
    // List all
    println!("\nAll Blockchains:");
    for c in mgr.get_all_blockchains() {
        println!("  {}: {} ({}) - {}", c.symbol, c.name, c.chain_type, c.status);
    }
    
    println!("\nEVM Chains:");
    for c in mgr.get_evm_chains() {
        println!("  {}", c.symbol);
    }
}
