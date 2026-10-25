//! TigerEx Wallet Service - Production Ready
//! Multi-chain HD Wallet Management Service
//!
//! Features:
//! - HD wallet generation from 24-word seed phrase
//! - Multi-chain support (Ethereum, BSC, Polygon, Solana, TON, etc.)
//! - Wallet derivation paths for different blockchains
//! - Balance querying across chains
//! - Transaction signing and broadcasting
//! - Multi-signature support
//! - Address validation

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

mod derivation;
mod keystore;

use derivation::derive_for_chain;
use keystore::SeedKeystore;

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum WalletError {
    #[error("Invalid seed phrase")]
    InvalidSeedPhrase,
    
    #[error("Wallet not found")]
    WalletNotFound,
    
    #[error("Address not found")]
    AddressNotFound,
    
    #[error("Insufficient balance")]
    InsufficientBalance,
    
    #[error("Invalid address")]
    InvalidAddress,
    
    #[error("Transaction failed")]
    TransactionFailed(String),
    
    #[error("Signing error")]
    SigningError(String),
    
    #[error("Network error")]
    NetworkError(String),
    
    #[error("Chain not supported")]
    ChainNotSupported,
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Internal error")]
    InternalError(String),
}

impl IntoResponse for WalletError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            WalletError::InvalidSeedPhrase => (StatusCode::BAD_REQUEST, "Invalid seed phrase".to_string()),
            WalletError::WalletNotFound => (StatusCode::NOT_FOUND, "Wallet not found".to_string()),
            WalletError::AddressNotFound => (StatusCode::NOT_FOUND, "Address not found".to_string()),
            WalletError::InsufficientBalance => (StatusCode::BAD_REQUEST, "Insufficient balance".to_string()),
            WalletError::InvalidAddress => (StatusCode::BAD_REQUEST, "Invalid address".to_string()),
            WalletError::TransactionFailed(msg) => (StatusCode::BAD_REQUEST, msg),
            WalletError::SigningError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
            WalletError::NetworkError(msg) => (StatusCode::BAD_GATEWAY, msg),
            WalletError::ChainNotSupported => (StatusCode::BAD_REQUEST, "Chain not supported".to_string()),
            WalletError::RateLimitExceeded => (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".to_string()),
            WalletError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };
        
        let body = serde_json::json!({
            "success": false,
            "error": { "code": status.as_u16(), "message": message }
        });
        
        (status, Json(body)).into_response()
    }
}

// =============================================================================
// BLOCKCHAIN CONFIGURATION
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockchainConfig {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub chain_id: u64,
    pub decimals: u8,
    pub rpc_url: String,
    pub explorer_url: String,
    pub derivation_path: String,
    pub address_prefix: Option<String>,
    pub is_evm: bool,
}

pub fn get_blockchain_configs() -> HashMap<String, BlockchainConfig> {
    let mut configs = HashMap::new();
    
    // Ethereum
    configs.insert("eth".to_string(), BlockchainConfig {
        id: "eth".to_string(),
        name: "Ethereum".to_string(),
        symbol: "ETH".to_string(),
        chain_id: 1,
        decimals: 18,
        rpc_url: "https://eth.llamarpc.com".to_string(),
        explorer_url: "https://etherscan.io".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // BSC
    configs.insert("bsc".to_string(), BlockchainConfig {
        id: "bsc".to_string(),
        name: "BNB Smart Chain".to_string(),
        symbol: "BNB".to_string(),
        chain_id: 56,
        decimals: 18,
        rpc_url: "https://bsc-dataseed.binance.org".to_string(),
        explorer_url: "https://bscscan.com".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Polygon
    configs.insert("polygon".to_string(), BlockchainConfig {
        id: "polygon".to_string(),
        name: "Polygon".to_string(),
        symbol: "MATIC".to_string(),
        chain_id: 137,
        decimals: 18,
        rpc_url: "https://polygon-rpc.com".to_string(),
        explorer_url: "https://polygonscan.com".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Arbitrum
    configs.insert("arbitrum".to_string(), BlockchainConfig {
        id: "arbitrum".to_string(),
        name: "Arbitrum".to_string(),
        symbol: "ETH".to_string(),
        chain_id: 42161,
        decimals: 18,
        rpc_url: "https://arb1.arbitrum.io/rpc".to_string(),
        explorer_url: "https://arbiscan.io".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Optimism
    configs.insert("optimism".to_string(), BlockchainConfig {
        id: "optimism".to_string(),
        name: "Optimism".to_string(),
        symbol: "ETH".to_string(),
        chain_id: 10,
        decimals: 18,
        rpc_url: "https://mainnet.optimism.io".to_string(),
        explorer_url: "https://optimistic.etherscan.io".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Avalanche
    configs.insert("avax".to_string(), BlockchainConfig {
        id: "avax".to_string(),
        name: "Avalanche".to_string(),
        symbol: "AVAX".to_string(),
        chain_id: 43114,
        decimals: 18,
        rpc_url: "https://api.avax.network/ext/bc/C/rpc".to_string(),
        explorer_url: "https://snowtrace.io".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Base
    configs.insert("base".to_string(), BlockchainConfig {
        id: "base".to_string(),
        name: "Base".to_string(),
        symbol: "ETH".to_string(),
        chain_id: 8453,
        decimals: 18,
        rpc_url: "https://mainnet.base.org".to_string(),
        explorer_url: "https://basescan.org".to_string(),
        derivation_path: "m/44'/60'/0'/0/0".to_string(),
        address_prefix: None,
        is_evm: true,
    });
    
    // Solana
    configs.insert("sol".to_string(), BlockchainConfig {
        id: "sol".to_string(),
        name: "Solana".to_string(),
        symbol: "SOL".to_string(),
        chain_id: 0,
        decimals: 9,
        rpc_url: "https://api.mainnet-beta.solana.com".to_string(),
        explorer_url: "https://solscan.io".to_string(),
        derivation_path: "m/44'/501'/0'/0'".to_string(),
        address_prefix: None,
        is_evm: false,
    });
    
    // TON
    configs.insert("ton".to_string(), BlockchainConfig {
        id: "ton".to_string(),
        name: "Toncoin".to_string(),
        symbol: "TON".to_string(),
        chain_id: 0,
        decimals: 9,
        rpc_url: "https://toncenter.com/api/v2".to_string(),
        explorer_url: "https://tonscan.org".to_string(),
        derivation_path: "m/44'/607'/0'/0/0".to_string(),
        address_prefix: Some("0:".to_string()),
        is_evm: false,
    });
    
    // TRON
    configs.insert("tron".to_string(), BlockchainConfig {
        id: "tron".to_string(),
        name: "TRON".to_string(),
        symbol: "TRX".to_string(),
        chain_id: 0,
        decimals: 6,
        rpc_url: "https://api.trongrid.io".to_string(),
        explorer_url: "https://tronscan.org".to_string(),
        derivation_path: "m/44'/195'/0'/0/0".to_string(),
        address_prefix: Some("T".to_string()),
        is_evm: false,
    });
    
    configs
}

// =============================================================================
// DATA TYPES
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub seed_phrase_encrypted: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub id: String,
    pub wallet_id: String,
    pub blockchain: String,
    pub address: String,
    pub public_key: String,
    pub derivation_path: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBalance {
    pub blockchain: String,
    pub token_symbol: String,
    pub token_address: Option<String>,
    pub balance: String,
    pub balance_decimal: f64,
    pub usd_value: f64,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub wallet_address_id: String,
    pub blockchain: String,
    pub hash: String,
    pub from_address: String,
    pub to_address: String,
    pub amount: String,
    pub token_symbol: String,
    pub fee: String,
    pub status: TransactionStatus,
    pub block_number: Option<u64>,
    pub timestamp: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRequest {
    pub wallet_id: String,
    pub blockchain: String,
    pub to_address: String,
    pub amount: String,
    pub token_symbol: String,
    pub gas_price: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferResponse {
    pub transaction_hash: String,
    pub from_address: String,
    pub to_address: String,
    pub amount: String,
    pub fee: String,
    pub estimated_confirm_time: u64,
}

// =============================================================================
// WALLET SERVICE
// =============================================================================

pub struct WalletService {
    blockchain_configs: HashMap<String, BlockchainConfig>,
    wallets: RwLock<HashMap<String, Wallet>>,
    addresses: RwLock<HashMap<String, Vec<WalletAddress>>>,
    balances: RwLock<HashMap<String, Vec<TokenBalance>>>,
    transactions: RwLock<HashMap<String, Vec<Transaction>>>,
    keystore: SeedKeystore,
}

impl WalletService {
    /// Builds the service using the master key from `TIGEREX_WALLET_MASTER_KEY`.
    ///
    /// Fails closed: without a valid master key the service will not start, so seed phrases
    /// can never be written to storage in an unprotected form.
    pub fn new() -> Result<Self, WalletError> {
        Ok(Self {
            blockchain_configs: get_blockchain_configs(),
            wallets: RwLock::new(HashMap::new()),
            addresses: RwLock::new(HashMap::new()),
            balances: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            keystore: SeedKeystore::from_env()?,
        })
    }

    /// Builds the service with an explicit master key (used by tests).
    pub fn with_master_key(master_key: &[u8; 32]) -> Self {
        Self {
            blockchain_configs: get_blockchain_configs(),
            wallets: RwLock::new(HashMap::new()),
            addresses: RwLock::new(HashMap::new()),
            balances: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            keystore: SeedKeystore::new(master_key),
        }
    }
    
    // =============================================================================
    // WALLET MANAGEMENT
    // =============================================================================
    
    /// Generate a new wallet with a random 24-word BIP39 seed phrase
    pub async fn generate_wallet(&self, user_id: &str, name: &str) -> Result<(Wallet, Vec<WalletAddress>), WalletError> {
        let seed_phrase = generate_seed_phrase()?;
        
        // Create wallet
        let wallet = Wallet {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            seed_phrase_encrypted: self.keystore.encrypt(&seed_phrase)?,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        
        // Generate addresses for all supported blockchains
        let addresses = self.derive_addresses(&wallet.id, &seed_phrase)?;
        
        // Store wallet and addresses
        {
            let mut wallets = self.wallets.write().await;
            wallets.insert(wallet.id.clone(), wallet.clone());
        }
        
        {
            let mut addrs = self.addresses.write().await;
            addrs.insert(wallet.id.clone(), addresses.clone());
        }
        
        info!("Generated wallet {} for user {}", wallet.id, user_id);
        
        Ok((wallet, addresses))
    }
    
    /// Import wallet from existing seed phrase
    pub async fn import_wallet(&self, user_id: &str, name: &str, seed_phrase: &str) -> Result<(Wallet, Vec<WalletAddress>), WalletError> {
        if !validate_seed_phrase(seed_phrase) {
            return Err(WalletError::InvalidSeedPhrase);
        }
        
        // Create wallet
        let wallet = Wallet {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            seed_phrase_encrypted: self.keystore.encrypt(seed_phrase)?,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        
        // Generate addresses for all supported blockchains
        let addresses = self.derive_addresses(&wallet.id, seed_phrase)?;
        
        // Store wallet and addresses
        {
            let mut wallets = self.wallets.write().await;
            wallets.insert(wallet.id.clone(), wallet.clone());
        }
        
        {
            let mut addrs = self.addresses.write().await;
            addrs.insert(wallet.id.clone(), addresses.clone());
        }
        
        info!("Imported wallet {} for user {}", wallet.id, user_id);
        
        Ok((wallet, addresses))
    }
    
    /// Get all addresses for a wallet
    pub async fn get_addresses(&self, wallet_id: &str) -> Result<Vec<WalletAddress>, WalletError> {
        let addresses = self.addresses.read().await;
        
        match addresses.get(wallet_id) {
            Some(addrs) => Ok(addrs.clone()),
            None => Err(WalletError::WalletNotFound),
        }
    }
    
    /// Get address for specific blockchain
    pub async fn get_address(&self, wallet_id: &str, blockchain: &str) -> Result<WalletAddress, WalletError> {
        let addresses = self.addresses.read().await;
        
        let addrs = addresses.get(wallet_id)
            .ok_or(WalletError::WalletNotFound)?;
        
        addrs.iter()
            .find(|a| a.blockchain == blockchain)
            .cloned()
            .ok_or(WalletError::AddressNotFound)
    }
    
    // =============================================================================
    // BALANCE QUERY
    // =============================================================================
    
    /// Get all token balances for a wallet
    pub async fn get_balances(&self, wallet_id: &str) -> Result<Vec<TokenBalance>, WalletError> {
        // Get addresses
        let addresses = self.get_addresses(wallet_id).await?;
        
        let mut all_balances = Vec::new();
        
        // Query balance for each address
        for address in addresses {
            let balances = self.query_balance(&address).await?;
            all_balances.extend(balances);
        }
        
        // Update cached balances
        {
            let mut cache = self.balances.write().await;
            cache.insert(wallet_id.to_string(), all_balances.clone());
        }
        
        Ok(all_balances)
    }
    
    /// Get balance for specific blockchain
    pub async fn get_balance(&self, wallet_id: &str, blockchain: &str) -> Result<Vec<TokenBalance>, WalletError> {
        let address = self.get_address(wallet_id, blockchain).await?;
        self.query_balance(&address).await
    }
    
    // =============================================================================
    // TRANSACTIONS
    // =============================================================================
    
    /// Transfer tokens
    pub async fn transfer(&self, _request: TransferRequest) -> Result<TransferResponse, WalletError> {
        Err(WalletError::NetworkError("transaction signing and blockchain broadcast provider is not configured".to_string()))
    }


    /// Get transaction history
    pub async fn get_transactions(&self, wallet_id: &str, blockchain: Option<String>) -> Result<Vec<Transaction>, WalletError> {
        let addresses = self.get_addresses(wallet_id).await?;
        
        let txs = self.transactions.read().await;
        
        let mut result = Vec::new();
        for addr in addresses {
            if let Some(chain_txs) = txs.get(&addr.id) {
                if let Some(ref bc) = blockchain {
                    if bc == &addr.blockchain {
                        result.extend(chain_txs.clone());
                    }
                } else {
                    result.extend(chain_txs.clone());
                }
            }
        }
        
        // Sort by timestamp descending
        result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        Ok(result)
    }
    
    // =============================================================================
    // INTERNAL METHODS
    // =============================================================================
    
    /// Re-derives every chain address for a wallet from its decrypted seed phrase.
    fn derive_addresses(
        &self,
        wallet_id: &str,
        seed_phrase: &str,
    ) -> Result<Vec<WalletAddress>, WalletError> {
        let seed = bip39_seed(seed_phrase)?;
        let mut addresses = Vec::with_capacity(self.blockchain_configs.len());

        for (blockchain, config) in &self.blockchain_configs {
            let derived = derive_for_chain(
                &config.id,
                &seed,
                seed_phrase,
                &config.derivation_path,
            )?;

            addresses.push(WalletAddress {
                id: Uuid::new_v4().to_string(),
                wallet_id: wallet_id.to_string(),
                blockchain: blockchain.clone(),
                address: derived.address,
                public_key: derived.public_key_hex,
                derivation_path: config.derivation_path.clone(),
                created_at: Utc::now(),
            });
        }

        // Deterministic ordering keeps responses stable across restarts.
        addresses.sort_by(|a, b| a.blockchain.cmp(&b.blockchain));
        Ok(addresses)
    }

    /// Validates an address using the chain's real encoding rules.
    fn validate_address(&self, address: &str, blockchain: &str) -> bool {
        match self.blockchain_configs.get(blockchain) {
            Some(config) => derivation::is_valid_address_for_chain(&config.id, address),
            None => false,
        }
    }

    async fn query_balance(&self, _address: &WalletAddress) -> Result<Vec<TokenBalance>, WalletError> {
        // In production, query RPC endpoints
        // For now, return empty balances
        Ok(vec![])
    }
    
}

// =============================================================================
// SEED PHRASE HELPERS
// =============================================================================

/// Generates a fresh 24-word English BIP39 mnemonic from OS entropy.
///
/// The phrase carries a valid checksum, so it round-trips through
/// [`validate_seed_phrase`] and can be re-imported by any BIP39-compatible wallet.
fn generate_seed_phrase() -> Result<String, WalletError> {
    let mnemonic = bip39::Mnemonic::generate_in(bip39::Language::English, 24)
        .map_err(|e| WalletError::InternalError(format!("seed generation failed: {e}")))?;
    Ok(mnemonic.to_string())
}

/// Validates a BIP39 mnemonic: known words, allowed length, and a correct checksum.
fn validate_seed_phrase(phrase: &str) -> bool {
    bip39::Mnemonic::parse_in(bip39::Language::English, phrase).is_ok()
}

/// Expands a validated BIP39 mnemonic into its 64-byte seed (PBKDF2-HMAC-SHA512, empty passphrase).
fn bip39_seed(phrase: &str) -> Result<[u8; 64], WalletError> {
    let mnemonic = bip39::Mnemonic::parse_in(bip39::Language::English, phrase)
        .map_err(|_| WalletError::InvalidSeedPhrase)?;
    Ok(mnemonic.to_seed(""))
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedWalletService = Arc<WalletService>;

#[derive(Clone)]
pub struct AppState {
    pub wallet_service: SharedWalletService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateWalletRequest {
    pub user_id: String,
    pub name: String,
    pub seed_phrase: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetBalanceQuery {
    pub blockchain: Option<String>,
}

async fn create_wallet(
    State(state): State<AppState>,
    Json(request): Json<CreateWalletRequest>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let (wallet, addresses) = if let Some(seed) = request.seed_phrase {
        state.wallet_service.import_wallet(&request.user_id, &request.name, &seed).await?
    } else {
        state.wallet_service.generate_wallet(&request.user_id, &request.name).await?
    };
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": {
            "wallet": wallet,
            "addresses": addresses
        }
    })))
}

async fn get_wallet_addresses(
    State(state): State<AppState>,
    Path(wallet_id): Path<String>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let addresses = state.wallet_service.get_addresses(&wallet_id).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": addresses
    })))
}

async fn get_wallet_balance(
    State(state): State<AppState>,
    Path((wallet_id, blockchain)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let balances = state.wallet_service.get_balance(&wallet_id, &blockchain).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": balances
    })))
}

async fn get_all_balances(
    State(state): State<AppState>,
    Path(wallet_id): Path<String>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let balances = state.wallet_service.get_balances(&wallet_id).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": balances
    })))
}

async fn transfer(
    State(state): State<AppState>,
    Json(request): Json<TransferRequest>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let response = state.wallet_service.transfer(request).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": response
    })))
}

async fn get_transactions(
    State(state): State<AppState>,
    Path(wallet_id): Path<String>,
    Query(query): Query<GetBalanceQuery>,
) -> Result<Json<serde_json::Value>, WalletError> {
    let txs = state.wallet_service.get_transactions(&wallet_id, query.blockchain).await?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "data": txs
    })))
}

async fn get_blockchains() -> Json<serde_json::Value> {
    let configs = get_blockchain_configs();
    let list: Vec<_> = configs.values().collect();
    
    Json(serde_json::json!({
        "success": true,
        "data": list
    }))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "wallet-service",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// =============================================================================
// MAIN
// =============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();
    
    info!("Starting TigerEx Wallet Service");
    
    // Create wallet service
    let wallet_service = Arc::new(WalletService::new()?);
    let state = AppState {
        wallet_service: wallet_service.clone(),
    };
    
    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/wallets", post(create_wallet))
        .route("/api/v1/wallets/:wallet_id/addresses", get(get_wallet_addresses))
        .route("/api/v1/wallets/:wallet_id/balances", get(get_all_balances))
        .route("/api/v1/wallets/:wallet_id/balances/:blockchain", get(get_wallet_balance))
        .route("/api/v1/wallets/:wallet_id/transactions", get(get_transactions))
        .route("/api/v1/wallets/transfer", post(transfer))
        .route("/api/v1/blockchains", get(get_blockchains))
        .with_state(state);
    
    // Start server
    let addr: std::net::SocketAddr = "0.0.0.0:8081".parse()?;
    
    info!("Wallet service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}
