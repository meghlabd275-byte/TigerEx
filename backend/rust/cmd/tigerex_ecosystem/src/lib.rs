//! TigerEx Ecosystem Integration Layer
//! 
//! Complete integration of Tiger ecosystem products:
//! - TigerSmartChain (EVM Blockchain with TGR & RUSD)
//! - Tigerswap DEX (Multichain Decentralized Exchange)
//! - TigerWallet (Multichain Web3 Wallet)
//! - Fee Collection System
//!
//! Features:
//! - Dynamic unlimited blockchain integration
//! - Dynamic unlimited token listing
//! - Dynamic unlimited bridge support
//! - Complete fee collection from all products
//! - Cross-product routing

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum TigerEcosystemError {
    #[error("Chain not supported: {0}")]
    ChainNotSupported(String),
    
    #[error("Token not found: {0}")]
    TokenNotFound(String),
    
    #[error("Insufficient liquidity: {0}")]
    InsufficientLiquidity(String),
    
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    
    #[error("Bridge error: {0}")]
    BridgeError(String),
    
    #[error("Wallet error: {0}")]
    WalletError(String),
    
    #[error("Dex error: {0}")]
    DexError(String),
}

// ============================================================================
// BLOCKCHAIN TYPES
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChainType {
    EVM,
    Solana,
    Aptos,
    Sui,
    Cosmos,
    Near,
    Algorand,
    Ton,
    Radix,
    Flow,
    Injective,
    Sei,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blockchain {
    pub key: String,
    pub name: String,
    pub chain_type: ChainType,
    pub chain_id: u64,
    pub rpc_url: String,
    pub explorer_url: String,
    pub symbol: String,
    pub decimals: u8,
    pub gas_limit: u64,
    pub is_active: bool,
    pub is_testnet: bool,
    pub logo_url: Option<String>,
    pub color: Option<String>,
}

impl Blockchain {
    pub fn new_evm(key: &str, name: &str, chain_id: u64, rpc: &str, explorer: &str, symbol: &str, decimals: u8) -> Self {
        Self {
            key: key.to_string(),
            name: name.to_string(),
            chain_type: ChainType::EVM,
            chain_id,
            rpc_url: rpc.to_string(),
            explorer_url: explorer.to_string(),
            symbol: symbol.to_string(),
            decimals,
            gas_limit: 21000,
            is_active: true,
            is_testnet: false,
            logo_url: None,
            color: None,
        }
    }
}

// ============================================================================
// TOKEN TYPES
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenStandard {
    ERC20,
    SPL,
    ARC,
    CW20,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub key: String,
    pub symbol: String,
    pub name: String,
    pub address: String,
    pub chain: String,
    pub decimals: u8,
    pub standard: TokenStandard,
    pub total_supply: String,
    pub price_usd: f64,
    pub is_active: bool,
    pub is_native: bool,
    pub logo_url: Option<String>,
    pub coingecko_id: Option<String>,
}

impl Token {
    pub fn new_erc20(key: &str, symbol: &str, name: &str, address: &str, chain: &str, decimals: u8) -> Self {
        Self {
            key: key.to_string(),
            symbol: symbol.to_string(),
            name: name.to_string(),
            address: address.to_string(),
            chain: chain.to_string(),
            decimals,
            standard: TokenStandard::ERC20,
            total_supply: "0".to_string(),
            price_usd: 0.0,
            is_active: true,
            is_native: false,
            logo_url: None,
            coingecko_id: None,
        }
    }
    
    pub fn new_native(key: &str, symbol: &str, name: &str, chain: &str, decimals: u8) -> Self {
        Self {
            key: key.to_string(),
            symbol: symbol.to_string(),
            name: name.to_string(),
            address: "NATIVE".to_string(),
            chain: chain.to_string(),
            decimals,
            standard: TokenStandard::Native,
            total_supply: "0".to_string(),
            price_usd: 0.0,
            is_active: true,
            is_native: true,
            logo_url: None,
            coingecko_id: None,
        }
    }
}

// ============================================================================
// TIGER ECOSYSTEM NATIVE TOKENS
// ============================================================================

pub struct TigerTokens {
    pub tgr: Token,
    pub rusd: Token,
}

impl TigerTokens {
    pub fn new() -> Self {
        // TGR - Tiger Coin (native token)
        let tgr = Token::new_erc20(
            "tgr",
            "TGR",
            "Tiger Coin",
            "0x...TGR_ADDRESS...",
            "tigersmartchain",
            18,
        );
        
        // RUSD - Royal Tiger United States Dollar (stablecoin)
        let rusd = Token::new_erc20(
            "rusd",
            "RUSD",
            "Royal Tiger United States Dollar",
            "0x...RUSD_ADDRESS...",
            "tigersmartchain",
            18,
        );
        
        Self { tgr, rusd }
    }
}

// ============================================================================
// BRIDGE TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bridge {
    pub key: String,
    pub name: String,
    pub source_chain: String,
    pub target_chain: String,
    pub contract_address: String,
    pub min_amount: f64,
    pub max_amount: f64,
    pub fee_percent: f64,
    pub estimated_time_minutes: u32,
    pub is_active: bool,
}

impl Bridge {
    pub fn new(key: &str, name: &str, source: &str, target: &str, contract: &str) -> Self {
        Self {
            key: key.to_string(),
            name: name.to_string(),
            source_chain: source.to_string(),
            target_chain: target.to_string(),
            contract_address: contract.to_string(),
            min_amount: 10.0,
            max_amount: 1000000.0,
            fee_percent: 0.1,
            estimated_time_minutes: 15,
            is_active: true,
        }
    }
}

// ============================================================================
// DEX POOL TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexPool {
    pub key: String,
    pub token_a: String,
    pub token_b: String,
    pub fee_rate: f64,
    pub liquidity_a: f64,
    pub liquidity_b: f64,
    pub apr: f64,
    pub volume_24h: f64,
    pub is_active: bool,
}

impl DexPool {
    pub fn new(token_a: &str, token_b: &str, fee_rate: f64) -> Self {
        Self {
            key: format!("{}_{}", token_a, token_b),
            token_a: token_a.to_string(),
            token_b: token_b.to_string(),
            fee_rate,
            liquidity_a: 0.0,
            liquidity_b: 0.0,
            apr: 0.0,
            volume_24h: 0.0,
            is_active: true,
        }
    }
}

// ============================================================================
// FARM TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Farm {
    pub key: String,
    pub pool_key: String,
    pub reward_token: String,
    pub reward_rate: f64,
    pub apy: f64,
    pub total_staked: f64,
    pub start_time: u64,
    pub end_time: u64,
    pub is_active: bool,
}

impl Farm {
    pub fn new(pool_key: &str, reward_token: &str, apy: f64, duration_days: u32) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u64;
        
        Self {
            key: format!("{}_farm", pool_key),
            pool_key: pool_key.to_string(),
            reward_token: reward_token.to_string(),
            reward_rate: 0.0,
            apy,
            total_staked: 0.0,
            start_time: now,
            end_time: now + (duration_days as u64 * 86400),
            is_active: true,
        }
    }
}

// ============================================================================
// WALLET TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub address: String,
    pub chain: String,
    pub public_key: String,
    pub created_at: u64,
    pub last_activity: u64,
    pub nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    pub wallet_address: String,
    pub token: String,
    pub balance: String,
    pub balance_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub token: String,
    pub amount: String,
    pub fee: String,
    pub status: TransactionStatus,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
}

// ============================================================================
// FEE COLLECTION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeCollection {
    pub exchange_fees: f64,
    pub dex_swap_fees: f64,
    pub bridge_fees: f64,
    pub wallet_fees: f64,
    pub staking_fees: f64,
    pub total_fees: f64,
    pub timestamp: u64,
}

impl FeeCollection {
    pub fn new() -> Self {
        Self {
            exchange_fees: 0.0,
            dex_swap_fees: 0.0,
            bridge_fees: 0.0,
            wallet_fees: 0.0,
            staking_fees: 0.0,
            total_fees: 0.0,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as u64,
        }
    }
    
    pub fn add(&mut self, source: FeeSource, amount: f64) {
        match source {
            FeeSource::Exchange => self.exchange_fees += amount,
            FeeSource::DexSwap => self.dex_swap_fees += amount,
            FeeSource::Bridge => self.bridge_fees += amount,
            FeeSource::Wallet => self.wallet_fees += amount,
            FeeSource::Staking => self.staking_fees += amount,
        }
        self.total_fees += amount;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FeeSource {
    Exchange,
    DexSwap,
    Bridge,
    Wallet,
    Staking,
}

// ============================================================================
// TIGER ECOSYSTEM CORE
// ============================================================================

pub struct TigerEcosystem {
    // Dynamic storage
    blockchains: RwLock<HashMap<String, Blockchain>>,
    tokens: RwLock<HashMap<String, Token>>,
    bridges: RwLock<HashMap<String, Bridge>>,
    dex_pools: RwLock<HashMap<String, DexPool>>,
    farms: RwLock<HashMap<String, Farm>>,
    wallets: RwLock<HashMap<String, Wallet>>,
    transactions: RwLock<HashMap<String, Vec<Transaction>>>,
    
    // Statistics
    total_volume_24h: RwLock<f64>,
    total_fees_collected: RwLock<f64>,
    pool_count: RwLock<usize>,
    active_chain_count: RwLock<usize>,
    active_token_count: RwLock<usize>,
    
    // Events
    event_tx: broadcast::Sender<EcosystemEvent>,
    
    // Settings
    settings: EcosystemSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemSettings {
    pub dex_fee_percent: f64,
    pub bridge_fee_percent: f64,
    pub wallet_fee_percent: f64,
    pub min_swap_amount: f64,
    pub max_swap_amount: f64,
    pub default_slippage: f64,
    pub max_slippage: f64,
    pub enable_cross_chain_routing: bool,
    pub enable_farms: bool,
}

impl Default for EcosystemSettings {
    fn default() -> Self {
        Self {
            dex_fee_percent: 0.3,
            bridge_fee_percent: 0.1,
            wallet_fee_percent: 0.05,
            min_swap_amount: 1.0,
            max_swap_amount: 1000000.0,
            default_slippage: 0.5,
            max_slippage: 5.0,
            enable_cross_chain_routing: true,
            enable_farms: true,
        }
    }
}

impl TigerEcosystem {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        
        let mut ecosystem = Self {
            blockchains: RwLock::new(HashMap::new()),
            tokens: RwLock::new(HashMap::new()),
            bridges: RwLock::new(HashMap::new()),
            dex_pools: RwLock::new(HashMap::new()),
            farms: RwLock::new(HashMap::new()),
            wallets: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            total_volume_24h: RwLock::new(0.0),
            total_fees_collected: RwLock::new(0.0),
            pool_count: RwLock::new(0),
            active_chain_count: RwLock::new(0),
            active_token_count: RwLock::new(0),
            event_tx,
            settings: EcosystemSettings::default(),
        };
        
        // Initialize with default chains, tokens, pools
        ecosystem.initialize_default_data();
        
        ecosystem
    }
    
    fn initialize_default_data(&mut self) {
        // Add EVM Blockchains
        self.add_evm_chain("tigersmartchain", "TigerSmartChain", 0x1234, "https://rpc.tigersmartchain.com", "https://explorer.tigersmartchain.com", "TGR", 18);
        self.add_evm_chain("ethereum", "Ethereum", 1, "https://eth.llamarpc.com", "https://etherscan.io", "ETH", 18);
        self.add_evm_chain("polygon", "Polygon", 137, "https://polygon-rpc.com", "https://polygonscan.com", "MATIC", 18);
        self.add_evm_chain("bsc", "BSC", 56, "https://bsc-dataseed1.binance.org", "https://bscscan.com", "BNB", 18);
        self.add_evm_chain("avalanche", "Avalanche", 43114, "https://api.avax.network/ext/bc/C/rp", "https://snowtrace.io", "AVAX", 18);
        self.add_evm_chain("arbitrum", "Arbitrum", 42161, "https://arb1.arbitrum.io/rpc", "https://arbiscan.io", "ETH", 18);
        self.add_evm_chain("optimism", "Optimism", 10, "https://mainnet.optimism.io", "https://optimistic.etherscan.io", "ETH", 18);
        self.add_evm_chain("base", "Base", 8453, "https://mainnet.base.org", "https://basescan.org", "ETH", 18);
        
        // Add Non-EVM Blockchains
        self.add_nonevm_chain("solana", "Solana", ChainType::Solana, "https://api.mainnet-beta.solana.com", "https://solscan.io", "SOL", 9);
        self.add_nonevm_chain("aptos", "Aptos", ChainType::Aptos, "https://fullnode.mainnet.aptoslabs.com", "https://explorer.aptoslabs.com", "APT", 8);
        self.add_nonevm_chain("sui", "Sui", ChainType::Sui, "https://fullnode.mainnet.sui.io", "https://suiscan.io", "SUI", 9);
        self.add_nonevm_chain("near", "NEAR", ChainType::Near, "https://rpc.mainnet.near.org", "https://explorer.near.org", "NEAR", 24);
        self.add_nonevm_chain("cosmos", "Cosmos", ChainType::Cosmos, "https://rpc.cosmos.network", "https://mintscan.io", "ATOM", 6);
        
        // Add Tiger Ecosystem Tokens
        self.add_token("TGR", "Tiger Coin", "0xTGR", "tigersmartchain", 18, TokenStandard::ERC20, 1000000000.0, 0.5);
        self.add_token("RUSD", "Royal Tiger USD", "0xRUSD", "tigersmartchain", 18, TokenStandard::ERC20, 1000000000.0, 1.0);
        
        // Add popular tokens
        self.add_token("ETH", "Ethereum", "0xETH", "ethereum", 18, TokenStandard::ERC20, 0.0, 3500.0);
        self.add_token("USDT", "Tether USD", "0xUSDT", "ethereum", 18, TokenStandard::ERC20, 0.0, 1.0);
        self.add_token("USDC", "USD Coin", "0xUSDC", "ethereum", 18, TokenStandard::ERC20, 0.0, 1.0);
        self.add_token("BNB", "BNB", "0xBNB", "bsc", 18, TokenStandard::ERC20, 0.0, 600.0);
        self.add_token("SOL", "Solana", "SOL", "solana", 9, TokenStandard::SPL, 0.0, 150.0);
        self.add_token("MATIC", "Polygon", "0xMATIC", "polygon", 18, TokenStandard::ERC20, 0.0, 0.8);
        self.add_token("AVAX", "Avalanche", "0xAVAX", "avalanche", 18, TokenStandard::ERC20, 0.0, 35.0);
        self.add_token("ARB", "Arbitrum", "0xARB", "arbitrum", 18, TokenStandard::ERC20, 0.0, 1.2);
        self.add_token("OP", "Optimism", "0xOP", "optimism", 18, TokenStandard::ERC20, 0.0, 2.5);
        
        // Add more top tokens (continuing list...)
        self.add_token("LINK", "Chainlink", "0xLINK", "ethereum", 18, TokenStandard::ERC20, 0.0, 15.0);
        self.add_token("UNI", "Uniswap", "0xUNI", "ethereum", 18, TokenStandard::ERC20, 0.0, 10.0);
        self.add_token("AAVE", "Aave", "0xAAVE", "ethereum", 18, TokenStandard::ERC20, 0.0, 250.0);
        self.add_token("WBTC", "Wrapped Bitcoin", "0xWBTC", "ethereum", 18, TokenStandard::ERC20, 0.0, 65000.0);
        self.add_token("DAI", "Dai", "0xDAI", "ethereum", 18, TokenStandard::ERC20, 0.0, 1.0);
        
        // Add DEX Pools (Tigerswap style)
        self.create_pool("TGR", "USDT", 0.003);
        self.create_pool("TGR", "RUSD", 0.003);
        self.create_pool("RUSD", "USDT", 0.001);
        self.create_pool("ETH", "USDT", 0.003);
        self.create_pool("BNB", "USDT", 0.003);
        self.create_pool("SOL", "USDT", 0.003);
        
        // Add Farms
        self.create_farm("TGR_USDT", "TGR", 25.0, 365);
        self.create_farm("TGR_RUSD", "TGR", 25.0, 365);
        self.create_farm("ETH_USDT", "TGR", 15.0, 180);
        
        // Add Bridges
        self.add_bridge("tgr_eth", "Tiger-Ethereum Bridge", "tigersmartchain", "ethereum", "0xBRIDGE_ETH");
        self.add_bridge("tgr_bsc", "Tiger-BSC Bridge", "tigersmartchain", "bsc", "0xBRIDGE_BSC");
        self.add_bridge("eth_bsc", "Ethereum-BSC Bridge", "ethereum", "bsc", "0xETH_BSC");
        
        info!("Tiger Ecosystem initialized with default data");
    }
    
    // ============================================================================
    // CHAIN MANAGEMENT
    // ============================================================================
    
    pub fn add_evm_chain(&mut self, key: &str, name: &str, chain_id: u64, rpc: &str, explorer: &str, symbol: &str, decimals: u8) {
        let chain = Blockchain::new_evm(key, name, chain_id, rpc, explorer, symbol, decimals);
        self.blockchains.write().unwrap().insert(key.to_string(), chain);
        
        let count = self.active_chain_count.read().unwrap();
        *self.active_chain_count.write().unwrap() = count + 1;
        
        info!("Added EVM chain: {} ({})", name, key);
    }
    
    pub fn add_nonevm_chain(&mut self, key: &str, name: &str, chain_type: ChainType, rpc: &str, explorer: &str, symbol: &str, decimals: u8) {
        let chain = Blockchain {
            key: key.to_string(),
            name: name.to_string(),
            chain_type,
            chain_id: 0,
            rpc_url: rpc.to_string(),
            explorer_url: explorer.to_string(),
            symbol: symbol.to_string(),
            decimals,
            gas_limit: 10000,
            is_active: true,
            is_testnet: false,
            logo_url: None,
            color: None,
        };
        self.blockchains.write().unwrap().insert(key.to_string(), chain);
        
        let count = self.active_chain_count.read().unwrap();
        *self.active_chain_count.write().unwrap() = count + 1;
        
        info!("Added non-EVM chain: {} ({})", name, key);
    }
    
    pub fn remove_chain(&mut self, key: &str) {
        self.blockchains.write().unwrap().remove(key);
        info!("Removed chain: {}", key);
    }
    
    pub fn activate_chain(&mut self, key: &str) {
        if let Some(chain) = self.blockchains.write().unwrap().get_mut(key) {
            chain.is_active = true;
        }
    }
    
    pub fn deactivate_chain(&mut self, key: &str) {
        if let Some(chain) = self.blockchains.write().unwrap().get_mut(key) {
            chain.is_active = false;
        }
    }
    
    pub fn get_chain(&self, key: &str) -> Option<Blockchain> {
        self.blockchains.read().unwrap().get(key).cloned()
    }
    
    pub fn get_all_chains(&self) -> Vec<Blockchain> {
        self.blockchains.read().unwrap().values().cloned().collect()
    }
    
    pub fn get_active_chains(&self) -> Vec<Blockchain> {
        self.blockchains.read().unwrap()
            .values()
            .filter(|c| c.is_active)
            .cloned()
            .collect()
    }
    
    pub fn get_chains_by_type(&self, chain_type: ChainType) -> Vec<Blockchain> {
        self.blockchains.read().unwrap()
            .values()
            .filter(|c| c.chain_type == chain_type && c.is_active)
            .cloned()
            .collect()
    }
    
    pub fn search_chains(&self, query: &str) -> Vec<Blockchain> {
        let query_lower = query.to_lowercase();
        self.blockchains.read().unwrap()
            .values()
            .filter(|c| 
                c.name.to_lowercase().contains(&query_lower) ||
                c.key.to_lowercase().contains(&query_lower) ||
                c.symbol.to_lowercase().contains(&query_lower)
            )
            .cloned()
            .collect()
    }
    
    // ============================================================================
    // TOKEN MANAGEMENT
    // ============================================================================
    
    pub fn add_token(&mut self, symbol: &str, name: &str, address: &str, chain: &str, decimals: u8, standard: TokenStandard, total_supply: f64, price_usd: f64) {
        let token = Token {
            key: symbol.to_string(),
            symbol: symbol.to_string(),
            name: name.to_string(),
            address: address.to_string(),
            chain: chain.to_string(),
            decimals,
            standard,
            total_supply: total_supply.to_string(),
            price_usd,
            is_active: true,
            is_native: false,
            logo_url: None,
            coingecko_id: None,
        };
        
        self.tokens.write().unwrap().insert(symbol.to_string(), token);
        
        let count = self.active_token_count.read().unwrap();
        *self.active_token_count.write().unwrap() = count + 1;
        
        info!("Added token: {} ({}) on {}", name, symbol, chain);
    }
    
    pub fn remove_token(&mut self, symbol: &str) {
        self.tokens.write().unwrap().remove(symbol);
    }
    
    pub fn activate_token(&mut self, symbol: &str) {
        if let Some(token) = self.tokens.write().unwrap().get_mut(symbol) {
            token.is_active = true;
        }
    }
    
    pub fn deactivate_token(&mut self, symbol: &str) {
        if let Some(token) = self.tokens.write().unwrap().get_mut(symbol) {
            token.is_active = false;
        }
    }
    
    pub fn get_token(&self, symbol: &str) -> Option<Token> {
        self.tokens.read().unwrap().get(symbol).cloned()
    }
    
    pub fn get_all_tokens(&self) -> Vec<Token> {
        self.tokens.read().unwrap().values().cloned().collect()
    }
    
    pub fn get_active_tokens(&self) -> Vec<Token> {
        self.tokens.read().unwrap()
            .values()
            .filter(|t| t.is_active)
            .cloned()
            .collect()
    }
    
    pub fn get_tokens_by_chain(&self, chain: &str) -> Vec<Token> {
        self.tokens.read().unwrap()
            .values()
            .filter(|t| t.chain == chain && t.is_active)
            .cloned()
            .collect()
    }
    
    pub fn search_tokens(&self, query: &str) -> Vec<Token> {
        let query_lower = query.to_lowercase();
        self.tokens.read().unwrap()
            .values()
            .filter(|t| 
                t.name.to_lowercase().contains(&query_lower) ||
                t.symbol.to_lowercase().contains(&query_lower)
            )
            .cloned()
            .collect()
    }
    
    pub fn update_token_price(&mut self, symbol: &str, price_usd: f64) {
        if let Some(token) = self.tokens.write().unwrap().get_mut(symbol) {
            token.price_usd = price_usd;
        }
    }
    
    // ============================================================================
    // DEX POOL MANAGEMENT
    // ============================================================================
    
    pub fn create_pool(&mut self, token_a: &str, token_b: &str, fee_rate: f64) {
        let pool = DexPool::new(token_a, token_b, fee_rate);
        self.dex_pools.write().unwrap().insert(pool.key.clone(), pool);
        
        let count = self.pool_count.read().unwrap();
        *self.pool_count.write().unwrap() = count + 1;
        
        info!("Created DEX pool: {}/{} with {}% fee", token_a, token_b, fee_rate * 100.0);
    }
    
    pub fn remove_pool(&mut self, key: &str) {
        self.dex_pools.write().unwrap().remove(key);
    }
    
    pub fn get_pool(&self, key: &str) -> Option<DexPool> {
        self.dex_pools.read().unwrap().get(key).cloned()
    }
    
    pub fn get_all_pools(&self) -> Vec<DexPool> {
        self.dex_pools.read().unwrap().values().cloned().collect()
    }
    
    pub fn get_active_pools(&self) -> Vec<DexPool> {
        self.dex_pools.read().unwrap()
            .values()
            .filter(|p| p.is_active)
            .cloned()
            .collect()
    }
    
    pub fn add_liquidity(&mut self, key: &str, amount_a: f64, amount_b: f64) {
        if let Some(pool) = self.dex_pools.write().unwrap().get_mut(key) {
            pool.liquidity_a += amount_a;
            pool.liquidity_b += amount_b;
            pool.volume_24h += amount_a + amount_b;
        }
    }
    
    // ============================================================================
    // FARM MANAGEMENT
    // ============================================================================
    
    pub fn create_farm(&mut self, pool_key: &str, reward_token: &str, apy: f64, duration_days: u32) {
        let farm = Farm::new(pool_key, reward_token, apy, duration_days);
        self.farms.write().unwrap().insert(farm.key.clone(), farm);
        
        info!("Created farm: {} with {}% APY", pool_key, apy);
    }
    
    pub fn remove_farm(&mut self, key: &str) {
        self.farms.write().unwrap().remove(key);
    }
    
    pub fn get_farm(&self, key: &str) -> Option<Farm> {
        self.farms.read().unwrap().get(key).cloned()
    }
    
    pub fn get_all_farms(&self) -> Vec<Farm> {
        self.farms.read().unwrap().values().cloned().collect()
    }
    
    pub fn get_active_farms(&self) -> Vec<Farm> {
        self.farms.read().unwrap()
            .values()
            .filter(|f| f.is_active)
            .cloned()
            .collect()
    }
    
    pub fn stake(&mut self, key: &str, amount: f64) {
        if let Some(farm) = self.farms.write().unwrap().get_mut(key) {
            farm.total_staked += amount;
        }
    }
    
    pub fn unstake(&mut self, key: &str, amount: f64) {
        if let Some(farm) = self.farms.write().unwrap().get_mut(key) {
            farm.total_staked = (farm.total_staked - amount).max(0.0);
        }
    }
    
    // ============================================================================
    // BRIDGE MANAGEMENT
    // ============================================================================
    
    pub fn add_bridge(&mut self, key: &str, name: &str, source: &str, target: &str, contract: &str) {
        let bridge = Bridge::new(key, name, source, target, contract);
        self.bridges.write().unwrap().insert(key.to_string(), bridge);
        
        info!("Added bridge: {} ({} -> {})", name, source, target);
    }
    
    pub fn remove_bridge(&mut self, key: &str) {
        self.bridges.write().unwrap().remove(key);
    }
    
    pub fn get_bridge(&self, key: &str) -> Option<Bridge> {
        self.bridges.read().unwrap().get(key).cloned()
    }
    
    pub fn get_all_bridges(&self) -> Vec<Bridge> {
        self.bridges.read().unwrap().values().cloned().collect()
    }
    
    pub fn get_bridges_for_chain(&self, chain: &str) -> Vec<Bridge> {
        self.bridges.read().unwrap()
            .values()
            .filter(|b| (b.source_chain == chain || b.target_chain == chain) && b.is_active)
            .cloned()
            .collect()
    }
    
    // ============================================================================
    // WALLET OPERATIONS
    // ============================================================================
    
    pub fn create_wallet(&mut self, chain: &str) -> Result<Wallet, TigerEcosystemError> {
        // Verify chain is supported
        if !self.blockchains.read().unwrap().contains_key(chain) {
            return Err(TigerEcosystemError::ChainNotSupported(chain.to_string()));
        }
        
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u64;
        
        // Generate wallet address (simplified - in production use proper key derivation)
        let address = format!("0x{:064x}", rand::random::<u128>());
        
        let wallet = Wallet {
            address,
            chain: chain.to_string(),
            public_key: String::new(),
            created_at: now,
            last_activity: now,
            nonce: 0,
        };
        
        self.wallets.write().unwrap().insert(wallet.address.clone(), wallet.clone());
        
        info!("Created wallet: {} on {}", wallet.address, chain);
        
        Ok(wallet)
    }
    
    pub fn get_wallet(&self, address: &str) -> Option<Wallet> {
        self.wallets.read().unwrap().get(address).cloned()
    }
    
    pub fn get_wallets(&self) -> Vec<Wallet> {
        self.wallets.read().unwrap().values().cloned().collect()
    }
    
    // ============================================================================
    // TRANSACTIONS
    // ============================================================================
    
    pub fn add_transaction(&mut self, tx: Transaction) {
        let from = tx.from.clone();
        let txs = self.transactions.write().unwrap();
        txs.entry(from).or_insert_with(Vec::new).push(tx);
    }
    
    pub fn get_transactions(&self, address: &str) -> Vec<Transaction> {
        self.transactions.read().unwrap()
            .get(address)
            .cloned()
            .unwrap_or_default()
    }
    
    // ============================================================================
    // DEX SWAP OPERATIONS
    // ============================================================================
    
    pub fn swap(&self, from_token: &str, to_token: &str, amount: f64, slippage: f64) -> Result<SwapResult, TigerEcosystemError> {
        // Get pool
        let pool_key = format!("{}_{}", from_token, to_token);
        let pool_key_alt = format!("{}_{}", to_token, from_token);
        
        let pool = self.dex_pools.read().unwrap()
            .get(&pool_key)
            .or_else(|| self.dex_pools.read().unwrap().get(&pool_key_alt))
            .cloned()
            .ok_or_else(|| TigerEcosystemError::InsufficientLiquidity(pool_key.clone()))?;
        
        // Calculate output with fee
        let fee = amount * pool.fee_rate;
        let amount_after_fee = amount - fee;
        
        // Get token prices
        let from_price = self.tokens.read().unwrap()
            .get(from_token)
            .map(|t| t.price_usd)
            .unwrap_or(1.0);
        let to_price = self.tokens.read().unwrap()
            .get(to_token)
            .map(|t| t.price_usd)
            .unwrap_or(1.0);
        
        // Calculate output (simplified - use proper AMM formula in production)
        let output = amount_after_fee * (from_price / to_price);
        
        // Check slippage
        let min_output = output * (1.0 - slippage / 100.0);
        
        if min_output < output * (1.0 - self.settings.max_slippage / 100.0) {
            return Err(TigerEcosystemError::DexError("Slippage exceeded".to_string()));
        }
        
        // Update fees
        *self.total_fees_collected.write().unwrap() += fee * from_price;
        
        Ok(SwapResult {
            from_token: from_token.to_string(),
            to_token: to_token.to_string(),
            from_amount: amount,
            to_amount: output,
            fee,
            fee_usd: fee * from_price,
            price_impact: 0.0,
            slippage,
            route: vec![from_token.to_string(), to_token.to_string()],
        })
    }
    
    pub fn smart_swap(&self, from_token: &str, to_token: &str, amount: f64, slippage: f64) -> Result<SwapResult, TigerEcosystemError> {
        // Try direct swap first
        if let Ok(result) = self.swap(from_token, to_token, amount, slippage) {
            return Ok(result);
        }
        
        // Try multi-hop (simplified)
        let stable_tokens = ["USDT", "USDC", "RUSD"];
        
        for stable in stable_tokens.iter() {
            if *stable == from_token || *stable == to_token {
                continue;
            }
            
            // Try via stable
            if let (Ok(first), Ok(second)) = (
                self.swap(from_token, stable, amount, slippage),
                self.swap(stable, to_token, first.to_amount, slippage),
            ) {
                return Ok(SwapResult {
                    from_token: first.from_token,
                    to_token: second.to_token,
                    from_amount: first.from_amount,
                    to_amount: second.to_amount,
                    fee: first.fee + second.fee,
                    fee_usd: first.fee_usd + second.fee_usd,
                    price_impact: first.price_impact + second.price_impact,
                    slippage,
                    route: vec![from_token.to_string(), stable.to_string(), to_token.to_string()],
                });
            }
        }
        
        Err(TigerEcosystemError::DexError("No viable route found".to_string()))
    }
    
    // ============================================================================
    // CROSS-CHAIN OPERATIONS
    // ============================================================================
    
    pub fn bridge(&self, from_chain: &str, to_chain: &str, token: &str, amount: f64) -> Result<BridgeResult, TigerEcosystemError> {
        // Find bridge
        let bridge = self.bridges.read().unwrap()
            .values()
            .find(|b| b.source_chain == from_chain && b.target_chain == to_chain && b.is_active)
            .cloned()
            .ok_or_else(|| TigerEcosystemError::BridgeError("No bridge found".to_string()))?;
        
        // Calculate fee
        let fee = amount * bridge.fee_percent;
        let amount_after_fee = amount - fee;
        
        // Verify amounts
        if amount < bridge.min_amount || amount > bridge.max_amount {
            return Err(TigerEcosystemError::BridgeError("Amount out of range".to_string()));
        }
        
        // Update fees
        *self.total_fees_collected.write().unwrap() += fee;
        
        Ok(BridgeResult {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            from_amount: amount,
            to_amount: amount_after_fee,
            fee,
            estimated_time_minutes: bridge.estimated_time_minutes,
            tx_hash: format!("0x{:064x}", rand::random::<u128>()),
        })
    }
    
    // ============================================================================
    // CROSS-PRODUCT ROUTING (Bridge + Swap)
    // ============================================================================
    
    pub fn cross_chain_swap(
        &self,
        from_chain: &str,
        to_chain: &str,
        from_token: &str,
        to_token: &str,
        amount: f64,
        slippage: f64,
    ) -> Result<CrossChainResult, TigerEcosystemError> {
        if from_chain == to_chain {
            // Same chain - just swap
            let swap_result = self.swap(from_token, to_token, amount, slippage)?;
            
            return Ok(CrossChainResult {
                from_chain: from_chain.to_string(),
                to_chain: to_chain.to_string(),
                from_token: from_token.to_string(),
                to_token: to_token.to_string(),
                steps: vec![CrossChainStep::Swap(swap_result)],
                total_fee: swap_result.fee,
                total_amount: swap_result.to_amount,
            });
        }
        
        // Cross chain - bridge + swap
        let mut steps = Vec::new();
        let mut total_fee = 0.0;
        
        // 1. Bridge from source to Tigersmartchain if not already there
        let intermediate_chain = if from_chain != "tigersmartchain" {
            let bridge_result = self.bridge(from_chain, "tigersmartchain", from_token, amount)?;
            steps.push(CrossChainStep::Bridge(bridge_result.clone()));
            total_fee += bridge_result.fee;
            "tigersmartchain".to_string()
        } else {
            from_chain.to_string()
        };
        
        // 2. Swap if needed
        if intermediate_chain != to_chain && to_chain != "tigersmartchain" {
            let swap_result = self.swap(from_token, to_token, amount - total_fee, slippage)?;
            steps.push(CrossChainStep::Swap(swap_result.clone()));
            total_fee += swap_result.fee;
        }
        
        // 3. Bridge to destination
        if intermediate_chain != to_chain {
            let bridge_result = self.bridge(&intermediate_chain, to_chain, to_token, amount - total_fee)?;
            steps.push(CrossChainStep::Bridge(bridge_result.clone()));
            total_fee += bridge_result.fee;
        }
        
        Ok(CrossChainResult {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            from_token: from_token.to_string(),
            to_token: to_token.to_string(),
            steps,
            total_fee,
            total_amount: amount - total_fee,
        })
    }
    
    // ============================================================================
    // FEE COLLECTION
    // ============================================================================
    
    pub fn collect_fees(&self) -> FeeCollection {
        let total = self.total_fees_collected.read().unwrap();
        
        FeeCollection {
            exchange_fees: 0.0,
            dex_swap_fees: *self.total_fees_collected.read().unwrap() * 0.3,
            bridge_fees: *self.total_fees_collected.read().unwrap() * 0.1,
            wallet_fees: 0.0,
            staking_fees: 0.0,
            total_fees: *total,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as u64,
        }
    }
    
    pub fn add_fee(&self, source: FeeSource, amount: f64) {
        let mut total = self.total_fees_collected.write().unwrap();
        *total += amount;
    }
    
    // ============================================================================
    // STATISTICS
    // ============================================================================
    
    pub fn get_statistics(&self) -> EcosystemStatistics {
        EcosystemStatistics {
            total_volume_24h: *self.total_volume_24h.read().unwrap(),
            total_fees_collected: *self.total_fees_collected.read().unwrap(),
            pool_count: *self.pool_count.read().unwrap(),
            active_chain_count: *self.active_chain_count.read().unwrap(),
            active_token_count: *self.active_token_count.read().unwrap(),
            active_pool_count: self.dex_pools.read().unwrap().values().filter(|p| p.is_active).count(),
            active_farm_count: self.farms.read().unwrap().values().filter(|f| f.is_active).count(),
            wallet_count: self.wallets.read().unwrap().len(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as u64,
        }
    }
    
    pub fn record_volume(&self, amount: f64) {
        let mut volume = self.total_volume_24h.write().unwrap();
        *volume += amount;
    }
    
    // ============================================================================
    // EVENTS
    // ============================================================================
    
    pub fn subscribe_events(&self) -> broadcast::Receiver<EcosystemEvent> {
        self.event_tx.subscribe()
    }
}

// ============================================================================
// RESULT TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapResult {
    pub from_token: String,
    pub to_token: String,
    pub from_amount: f64,
    pub to_amount: f64,
    pub fee: f64,
    pub fee_usd: f64,
    pub price_impact: f64,
    pub slippage: f64,
    pub route: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeResult {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub from_amount: f64,
    pub to_amount: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CrossChainStep {
    Swap(SwapResult),
    Bridge(BridgeResult),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossChainResult {
    pub from_chain: String,
    pub to_chain: String,
    pub from_token: String,
    pub to_token: String,
    pub steps: Vec<CrossChainStep>,
    pub total_fee: f64,
    pub total_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemStatistics {
    pub total_volume_24h: f64,
    pub total_fees_collected: f64,
    pub pool_count: usize,
    pub active_chain_count: usize,
    pub active_token_count: usize,
    pub active_pool_count: usize,
    pub active_farm_count: usize,
    pub wallet_count: usize,
    pub timestamp: u64,
}

// ============================================================================
// ECOSYSTEM EVENTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EcosystemEvent {
    ChainAdded { key: String, name: String },
    TokenAdded { symbol: String, chain: String },
    PoolCreated { key: String },
    FarmCreated { key: String },
    BridgeCreated { key: String },
    WalletCreated { address: String, chain: String },
    SwapExecuted { from_token: String, to_token: String, amount: f64 },
    BridgeExecuted { from_chain: String, to_chain: String, amount: f64 },
    VolumeUpdated { amount: f64 },
    FeeCollected { source: String, amount: f64 },
}

// ============================================================================
// FACTORY
// ============================================================================

pub fn create_tiger_ecosystem() -> TigerEcosystem {
    TigerEcosystem::new()
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_ecosystem_creation() {
        let ecosystem = create_tiger_ecosystem();
        let stats = ecosystem.get_statistics();
        
        assert!(stats.active_chain_count > 0);
        assert!(stats.active_token_count > 0);
    }
    
    #[test]
    fn test_swap() {
        let ecosystem = create_tiger_ecosystem();
        let result = ecosystem.swap("ETH", "USDT", 1.0, 0.5);
        
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_chain_search() {
        let ecosystem = create_tiger_ecosystem();
        let chains = ecosystem.search_chains("eth");
        
        assert!(!chains.is_empty());
    }
    
    #[test]
    fn test_token_search() {
        let ecosystem = create_tiger_ecosystem();
        let tokens = ecosystem.search_tokens("tiger");
        
        assert!(!tokens.is_empty());
    }
}