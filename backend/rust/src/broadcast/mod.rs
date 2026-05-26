// Broadcast Engine - Multi-Network Transaction Broadcasting
// Rust for blockchain transaction propagation

use std::collections::HashMap;

// Network type
#[derive(Debug, Clone)]
pub enum Net {
    Bitcoin,
    Ethereum,
    Solana,
    Polygon,
    BSC,
    Avalanche,
}

// Transaction status
#[derive(Debug, Clone)]
pub enum TxStatus {
    Pending,
    Submitted,
    Confirmed,
    Failed,
}

// Broadcast transaction
#[derive(Debug, Clone)]
pub struct Transaction {
    pub tx_hash: String,
    pub network: Net,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub gas_price: u64,
    pub status: TxStatus,
    pub nonce: u64,
    pub timestamp: i64,
    pub confirmations: u32,
}

// Network config
#[derive(Debug, Clone)]
pub struct NetConfig {
    pub network: Net,
    pub rpc_urls: Vec<String>,
    pub chain_id: u64,
    pub min_gas: u64,
    pub max_gas: u64,
    pub confirmation_blocks: u32,
}

// Broadcast engine
pub struct BroadcastEngine {
    networks: HashMap<String, NetConfig>,
    pending: HashMap<String, Transaction>,
    nonces: HashMap<String, HashMap<String, u64>>,
}

impl BroadcastEngine {
    pub fn new() -> Self {
        BroadcastEngine {
            networks: HashMap::new(),
            pending: HashMap::new(),
            nonces: HashMap::new(),
        }
    }

    pub fn add_network(&mut self, config: NetConfig) {
        let name = format!("{:?}", config.network);
        self.networks.insert(name, config);
    }

    pub fn build_tx(&mut self, net: &str, from: &str, to: &str, amount: f64) -> Result<Transaction, String> {
        let config = self.networks.get(net)
            .ok_or("network not found")?;

        let nonce = *self.nonces
            .get(net)
            .and_then(|n| n.get(from))
            .unwrap_or(&0);

        let tx = Transaction {
            tx_hash: format!("tx_{}", rand_hex(32)),
            network: config.network.clone(),
            from: from.to_string(),
            to: to.to_string(),
            amount,
            gas_price: config.min_gas,
            status: TxStatus::Pending,
            nonce,
            timestamp: now_ms(),
            confirmations: 0,
        };

        self.pending.insert(tx.tx_hash.clone(), tx.clone());
        Ok(tx)
    }

    pub fn submit(&mut self, tx_hash: &str) -> Result<(), String> {
        if let Some(tx) = self.pending.get_mut(tx_hash) {
            tx.status = TxStatus::Submitted;
            return Ok(());
        }
        Err("tx not found".to_string())
    }

    pub fn confirm(&mut self, tx_hash: &str) -> Result<(), String> {
        if let Some(tx) = self.pending.get_mut(tx_hash) {
            tx.status = TxStatus::Confirmed;
            tx.confirmations = 12;
            
            let net_name = format!("{:?}", tx.network);
            let nonces = self.nonces.entry(net_name).or_insert_with(HashMap::new);
            nonces.insert(tx.from.clone(), tx.nonce + 1);
            return Ok(());
        }
        Err("tx not found".to_string())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn rand_hex(len: usize) -> String {
    use std::iter;
    let chars: Vec<char> = "0123456789abcdef".chars().collect();
    iter::repeat_with(|| chars[0]).take(len).map(|c| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_broadcast() {
        let mut eng = BroadcastEngine::new();
        let cfg = NetConfig {
            network: Net::Ethereum,
            rpc_urls: vec!["https://rpc.eth".to_string()],
            chain_id: 1,
            min_gas: 1000000000,
            max_gas: 100000000000,
            confirmation_blocks: 12,
        };
        eng.add_network(cfg);
        let tx = eng.build_tx("Ethereum", "0xfrom", "0xto", 1.0).unwrap();
        eng.submit(&tx.tx_hash).unwrap();
        assert!(!tx.tx_hash.is_empty());
    }
}