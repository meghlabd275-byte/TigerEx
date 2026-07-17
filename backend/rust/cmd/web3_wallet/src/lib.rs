//! TigerEx Web3 Wallet
//! Non-custodial wallet integration - OKX Web3 Wallet style
//! 
//! Features:
//! - Multi-chain wallet support (EVM, Solana, Aptos, Sui)
//! - MPC key management
//! - WalletConnect integration
//! - Hardware wallet support
//! - DeFi protocol integration
//! - Gas optimization

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum Web3WalletError {
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    
    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),
    
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    
    #[error("Signature error: {0}")]
    SignatureError(String),
    
    #[error("Chain not supported: {0}")]
    ChainNotSupported(String),
    
    #[error("Network error: {0}")]
    NetworkError(String),
    
    #[error("RPC error: {0}")]
    RpcError(String),
    
    #[error("Wallet locked: {0}")]
    WalletLocked(String),
}

// ============================================================================
// SUPPORTED CHAINS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Chain {
    // EVM chains
    Ethereum,
    BSC,
    Polygon,
    Avalanche,
    Arbitrum,
    Optimism,
    Base,
    Solana,
    Aptos,
    Sui,
    Starknet,
    Linea,
    zkSync,
}

impl Chain {
    pub fn chain_id(&self) -> u64 {
        match self {
            Chain::Ethereum => 1,
            Chain::BSC => 56,
            Chain::Polygon => 137,
            Chain::Avalanche => 43114,
            Chain::Arbitrum => 42161,
            Chain::Optimism => 10,
            Chain::Base => 8453,
            Chain::Solana => 101,
            Chain::Aptos => 1,
            Chain::Sui => 1,
            Chain::Starknet => 1,
            Chain::Linea => 59144,
            Chain::zkSync => 324,
        }
    }
    
    pub fn rpc_url(&self) -> &'static str {
        match self {
            Chain::Ethereum => "https://eth.llamarpc.com",
            Chain::BSC => "https://bsc-dataseed1.binance.org",
            Chain::Polygon => "https://polygon-rpc.com",
            Chain::Avalanche => "https://api.avax.network/ext/bc/C/rp",
            Chain::Arbitrum => "https://arb1.arbitrum.io/rpc",
            Chain::Optimism => "https://mainnet.optimism.io",
            Chain::Base => "https://mainnet.base.org",
            _ => "https://api.mainnet-beta.solana.com",
        }
    }
    
    pub fn explorer_url(&self) -> &'static str {
        match self {
            Chain::Ethereum => "https://etherscan.io",
            Chain::BSC => "https://bscscan.com",
            Chain::Polygon => "https://polygonscan.com",
            Chain::Avalanche => "https://snowtrace.io",
            Chain::Arbitrum => "https://arbiscan.io",
            Chain::Optimism => "https://optimistic.etherscan.io",
            Chain::Base => "https://basescan.org",
            _ => "https://solscan.io",
        }
    }
    
    pub fn is_evm(&self) -> bool {
        matches!(
            self,
            Chain::Ethereum | Chain::BSC | Chain::Polygon | Chain::Avalanche | 
            Chain::Arbitrum | Chain::Optimism | Chain::Base | Chain::Linea | Chain::zkSync
        )
    }
}

// ============================================================================
// WALLET TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub chain: Chain,
    pub address: String,
    pub ens: Option<String>,
    pub lens_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBalance {
    pub chain: Chain,
    pub token_address: String,
    pub symbol: String,
    pub decimals: u8,
    pub balance: String,
    pub balance_usd: f64,
    pub price: f64,
    pub logo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NFT {
    pub chain: Chain,
    pub contract_address: String,
    pub token_id: String,
    pub name: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub attributes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub chain: Chain,
    pub hash: String,
    pub from: String,
    pub to: String,
    pub value: String,
    pub gas_limit: u64,
    pub gas_price: u64,
    pub gas_used: Option<u64>,
    pub nonce: u64,
    pub input: String,
    pub status: TransactionStatus,
    pub block_number: Option<u64>,
    pub timestamp: u64,
    pub logs: Vec<TransactionLog>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionLog {
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
}

// ============================================================================
// WALLET STATE
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletState {
    pub id: String,
    pub name: String,
    pub addresses: Vec<WalletAddress>,
    pub created_at: u64,
    pub last_activity: u64,
    
    // Security
    pub is_locked: bool,
    pub two_factor_enabled: bool,
    pub session_timeout: u64,
    
    // Features
    pub dapp_connections: Vec<DAppConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DAppConnection {
    pub name: String,
    pub url: String,
    pub connected_at: u64,
    pub permissions: Vec<String>,
}

// ============================================================================
// SIGNATURE TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub r: String,
    pub s: String,
    pub v: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage {
    pub message: String,
    pub signature: String,
    pub signer: String,
    pub timestamp: u64,
}

// ============================================================================
// TRANSACTION REQUEST
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub chain: Chain,
    pub to: String,
    pub value: Option<String>,
    pub data: Option<String>,
    pub gas_limit: Option<u64>,
    pub gas_price: Option<u64>,
    pub max_fee: Option<String>,
    pub max_priority_fee: Option<String>,
    pub nonce: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionResponse {
    pub chain: Chain,
    pub hash: String,
    pub nonce: u64,
    pub from: String,
    pub to: String,
    pub value: String,
    pub input: String,
    pub gas_limit: u64,
    pub gas_price: u64,
    pub status: TransactionStatus,
    pub block_number: Option<u64>,
    pub timestamp: u64,
}

// ============================================================================
// DEFI POSITION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeFiPosition {
    pub protocol: String,
    pub protocol_logo: String,
    pub chain: Chain,
    pub tokens: Vec<DeFiToken>,
    pub apy: f64,
    pub value_usd: f64,
    pub health_factor: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeFiToken {
    pub token_address: String,
    pub symbol: String,
    pub balance: String,
    pub value_usd: f64,
}

// ============================================================================
// MPC WALLET
// ============================================================================

pub struct MPCWallet {
    wallet_id: String,
    shares: Vec<Arc<RwLock<Vec<u8>>>>,
    threshold: usize,
    total_shares: usize,
    addresses: RwLock<HashMap<Chain, String>>,
    state: RwLock<WalletState>,
    settings: WalletSettings,
    
    // Events
    event_tx: broadcast::Sender<WalletEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletSettings {
    pub auto_approve: bool,
    pub max_daily_limit: f64,
    pub max_transaction_limit: f64,
    pub require_2fa_for_large: bool,
    pub session_timeout_seconds: u64,
    pub rpc_url_override: HashMap<Chain, String>,
}

impl MPCWallet {
    pub fn new(wallet_id: String, threshold: usize, total_shares: usize) -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        
        Self {
            wallet_id,
            shares: Vec::new(),
            threshold,
            total_shares,
            addresses: RwLock::new(HashMap::new()),
            state: RwLock::new(WalletState {
                id: String::new(),
                name: String::new(),
                addresses: Vec::new(),
                created_at: 0,
                last_activity: 0,
                is_locked: true,
                two_factor_enabled: false,
                session_timeout: 300,
                dapp_connections: Vec::new(),
            }),
            settings: WalletSettings {
                auto_approve: false,
                max_daily_limit: 10000.0,
                max_transaction_limit: 1000.0,
                require_2fa_for_large: false,
                session_timeout_seconds: 300,
                rpc_url_override: HashMap::new(),
            },
            event_tx,
        }
    }
    
    // ============================================================================
    // KEY MANAGEMENT
    // ============================================================================
    
    pub fn add_share(&mut self, share: Vec<u8>) {
        self.shares.push(Arc::new(RwLock::new(share)));
    }
    
    pub fn generate_address(&self, chain: Chain) -> Result<String, Web3WalletError> {
        // Check if we have enough shares
        if self.shares.len() < self.threshold {
            return Err(Web3WalletError::SignatureError(
                "Not enough key shares".to_string(),
            ));
        }
        
        // Combine shares (simplified - in production use proper MPC)
        let mut combined = Vec::new();
        for share in &self.shares {
            combined.extend(share.read().unwrap().clone());
        }
        
        // Derive address from combined key
        let address = self.derive_address(&combined, chain)?;
        
        self.addresses.write().unwrap().insert(chain, address.clone());
        
        Ok(address)
    }
    
    fn derive_address(&self, key: &[u8], chain: Chain) -> Result<String, Web3WalletError> {
        match chain {
            Chain::Ethereum | Chain::BSC | Chain::Polygon | Chain::Avalanche |
            Chain::Arbitrum | Chain::Optimism | Chain::Base | Chain::Linea | Chain::zkSync => {
                // Simplified - in production use proper key derivation
                Ok(format!("0x{:x}", key.iter().take(20).fold(0u64, |acc, &b| acc * 256 + b as u64)))
            }
            Chain::Solana => {
                Ok("SolanaAddress".to_string())
            }
            _ => Err(Web3WalletError::ChainNotSupported(format!("{:?}", chain))),
        }
    }
    
    pub fn get_address(&self, chain: Chain) -> Option<String> {
        self.addresses.read().unwrap().get(&chain).cloned()
    }
    
    pub fn get_all_addresses(&self) -> Vec<WalletAddress> {
        self.addresses.read().unwrap()
            .iter()
            .map(|(chain, address)| WalletAddress {
                chain: *chain,
                address: address.clone(),
                ens: None,
                lens_handle: None,
            })
            .collect()
    }
    
    // ============================================================================
    // BALANCE QUERIES
    // ============================================================================
    
    pub async fn get_balance(&self, chain: Chain, token: Option<&str>) -> Result<TokenBalance, Web3WalletError> {
        let address = self.get_address(chain).ok_or_else(|| {
            Web3WalletError::InvalidAddress("No address for chain".to_string())
        })?;
        
        // Query RPC (simplified)
        let balance = self.query_balance(&address, chain, token).await?;
        
        Ok(TokenBalance {
            chain,
            token_address: token.unwrap_or("").to_string(),
            symbol: "ETH".to_string(),
            decimals: 18,
            balance: balance.0,
            balance_usd: balance.1,
            price: balance.2,
            logo_url: None,
        })
    }
    
    async fn query_balance(&self, address: &str, chain: Chain, token: Option<&str>) -> Result<(String, f64, f64), Web3WalletError> {
        // Simplified - in production use proper RPC calls
        let balance = "1000000000000000000".to_string();
        let price = 3500.0;
        let balance_usd = 1000.0;
        
        Ok((balance, balance_usd, price))
    }
    
    pub async fn get_nfts(&self, chain: Chain) -> Result<Vec<NFT>, Web3WalletError> {
        let address = self.get_address(chain).ok_or_else(|| {
            Web3WalletError::InvalidAddress("No address for chain".to_string())
        })?;
        
        // Query NFT ownership
        Ok(Vec::new())
    }
    
    // ============================================================================
    // TRANSACTIONS
    // ============================================================================
    
    pub async fn sign_and_send(&self, request: TransactionRequest) -> Result<TransactionResponse, Web3WalletError> {
        // Check if wallet is locked
        if self.state.read().unwrap().is_locked {
            return Err(Web3WalletError::WalletLocked("Wallet is locked".to_string()));
        }
        
        // Get address
        let from = self.get_address(request.chain).ok_or_else(|| {
            Web3WalletError::InvalidAddress("No address for chain".to_string())
        })?;
        
        // Sign transaction
        let signature = self.sign_transaction(&request).await?;
        
        // Send to RPC
        let response = self.broadcast_transaction(&request, &signature).await?;
        
        // Emit event
        let event = WalletEvent::TransactionSent {
            chain: request.chain,
            hash: response.hash.clone(),
            to: request.to.clone(),
            value: request.value.clone(),
        };
        let _ = self.event_tx.send(event);
        
        Ok(response)
    }
    
    async fn sign_transaction(&self, request: &TransactionRequest) -> Result<Signature, Web3WalletError> {
        // Check if we have enough shares
        if self.shares.len() < self.threshold {
            return Err(Web3WalletError::SignatureError(
                "Not enough key shares".to_string(),
            ));
        }
        
        // Combine shares
        let mut combined = Vec::new();
        for share in &self.shares {
            combined.extend(share.read().unwrap().clone());
        }
        
        // Sign (simplified)
        let signature = Signature {
            r: format!("{:x}", combined.iter().take(32).fold(0u64, |acc, &b| acc * 256 + b as u64)),
            s: format!("{:x}", combined.iter().skip(32).take(32).fold(0u64, |acc, &b| acc * 256 + b as u64)),
            v: 27,
        };
        
        Ok(signature)
    }
    
    async fn broadcast_transaction(&self, request: &TransactionRequest, _signature: &Signature) -> Result<TransactionResponse, Web3WalletError> {
        // Simplified - in production use proper RPC
        Ok(TransactionResponse {
            chain: request.chain,
            hash: format!("0x{:x}", rand::random::<u64>()),
            nonce: 0,
            from: self.get_address(request.chain).unwrap_or_default(),
            to: request.to.clone(),
            value: request.value.clone().unwrap_or_default(),
            input: request.data.clone().unwrap_or_default(),
            gas_limit: request.gas_limit.unwrap_or(21000),
            gas_price: request.gas_price.unwrap_or(1000000000),
            status: TransactionStatus::Pending,
            block_number: None,
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
    }
    
    // ============================================================================
    // MESSAGE SIGNING
    // ============================================================================
    
    pub async fn sign_message(&self, message: &str) -> Result<SignedMessage, Web3WalletError> {
        let signer = self.get_address(Chain::Ethereum).ok_or_else(|| {
            Web3WalletError::InvalidAddress("No Ethereum address".to_string())
        })?;
        
        // Sign message (simplified)
        let signature = format!(
            "0x{:x}signature{:x}",
            message.len(),
            rand::random::<u64>()
        );
        
        Ok(SignedMessage {
            message: message.to_string(),
            signature,
            signer,
            timestamp: chrono::Utc::now().timestamp() as u64,
        })
    }
    
    // ============================================================================
    // WALLET CONNECT
    // ============================================================================
    
    pub fn generate_wallet_connect_uri(&self, chain: Chain) -> Result<String, Web3WalletError> {
        let address = self.get_address(chain).ok_or_else(|| {
            Web3WalletError::InvalidAddress("No address for chain".to_string())
        })?;
        
        // Generate WalletConnect URI
        let uri = format!(
            "wc:{}@2?chainId={}&relayProtocol=irn&symKey={}",
            uuid::Uuid::new_v4(),
            chain.chain_id(),
            uuid::Uuid::new_v4()
        );
        
        Ok(uri)
    }
    
    pub fn approve_dapp_connection(&self, url: &str, permissions: Vec<String>) -> Result<(), Web3WalletError> {
        let mut state = self.state.write().unwrap();
        
        // Check if already connected
        if state.dapp_connections.iter().any(|c| c.url == url) {
            return Ok(());
        }
        
        state.dapp_connections.push(DAppConnection {
            name: url.to_string(),
            url: url.to_string(),
            connected_at: chrono::Utc::now().timestamp() as u64,
            permissions,
        });
        
        Ok(())
    }
    
    pub fn revoke_dapp_connection(&self, url: &str) -> Result<(), Web3WalletError> {
        let mut state = self.state.write().unwrap();
        state.dapp_connections.retain(|c| c.url != url);
        Ok(())
    }
    
    pub fn get_dapp_connections(&self) -> Vec<DAppConnection> {
        self.state.read().unwrap().dapp_connections.clone()
    }
    
    // ============================================================================
    // GAS OPTIMIZATION
    // ============================================================================
    
    pub async fn estimate_gas(&self, request: &TransactionRequest) -> Result<u64, Web3WalletError> {
        // Simplified - in production use proper estimation
        if request.data.is_some() {
            Ok(100000)
        } else {
            Ok(21000)
        }
    }
    
    pub async fn get_gas_price(&self, chain: Chain) -> Result<u64, Web3WalletError> {
        // Simplified - in production use oracle
        match chain {
            Chain::Ethereum => Ok(30000000000),   // 30 gwei
            Chain::BSC => Ok(3000000000),       // 3 gwei
            Chain::Polygon => Ok(100000000000),  // 100 gwei
            _ => Ok(1000000000),
        }
    }
    
    pub async fn get_max_fee(&self, chain: Chain) -> Result<(u64, u64), Web3WalletError> {
        let base_fee = self.get_gas_price(chain).await?;
        let priority_fee = base_fee / 10;
        
        Ok((base_fee + priority_fee, priority_fee))
    }
    
    // ============================================================================
    // DEFI INTEGRATION
    // ============================================================================
    
    pub async fn get_defi_positions(&self) -> Result<Vec<DeFiPosition>, Web3WalletError> {
        let mut positions = Vec::new();
        
        // Get positions from all chains
        for chain in &[
            Chain::Ethereum,
            Chain::BSC,
            Chain::Polygon,
            Chain::Arbitrum,
            Chain::Optimism,
        ] {
            let chain_positions = self.query_defi_positions(*chain).await?;
            positions.extend(chain_positions);
        }
        
        Ok(positions)
    }
    
    async fn query_defi_positions(&self, chain: Chain) -> Result<Vec<DeFiPosition>, Web3WalletError> {
        // Simplified - in production query DeFi protocols
        Ok(Vec::new())
    }
    
    // ============================================================================
    // EVENTS
    // ============================================================================
    
    pub fn subscribe_events(&self) -> broadcast::Receiver<WalletEvent> {
        self.event_tx.subscribe()
    }
}

// ============================================================================
// WALLET EVENTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WalletEvent {
    TransactionSent {
        chain: Chain,
        hash: String,
        to: String,
        value: Option<String>,
    },
    TransactionConfirmed {
        chain: Chain,
        hash: String,
    },
    TransactionFailed {
        chain: Chain,
        hash: String,
        error: String,
    },
    DAppConnected {
        url: String,
        permissions: Vec<String>,
    },
    DAppDisconnected {
        url: String,
    },
    WalletLocked,
    WalletUnlocked,
    SignatureRequired {
        message: String,
    },
}

// ============================================================================
// FACTORY
// ============================================================================

pub fn create_mpc_wallet(wallet_id: String, threshold: usize, total_shares: usize) -> MPCWallet {
    MPCWallet::new(wallet_id, threshold, total_shares)
}

pub fn create_keyless_wallet(wallet_id: String) -> MPCWallet {
    // 2-of-3 threshold by default
    MPCWallet::new(wallet_id, 2, 3)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_chain_ids() {
        assert_eq!(Chain::Ethereum.chain_id(), 1);
        assert_eq!(Chain::BSC.chain_id(), 56);
    }
    
    #[test]
    fn test_evm_classification() {
        assert!(Chain::Ethereum.is_evm());
        assert!(!Chain::Solana.is_evm());
    }
}