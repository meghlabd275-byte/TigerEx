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

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::info;

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

    /// Record the token's on-chain total supply. A negative or non-finite value
    /// is refused, leaving the supply at its previous (initially zero) value
    /// rather than storing a number no chain could report.
    pub fn with_supply(mut self, total_supply: f64) -> Self {
        if total_supply.is_finite() && total_supply >= 0.0 {
            self.total_supply = total_supply.to_string();
        }
        self
    }
}

// ============================================================================
// TIGER ECOSYSTEM NATIVE TOKENS
// ============================================================================

/// The Tiger ecosystem's own tokens.
///
/// The chain ids and symbols are fixed by the chain itself, but the contract
/// addresses are not known to the library: they are deployment configuration.
/// `new` therefore takes them as arguments rather than embedding a placeholder
/// such as `0xTGR`, which would make the wallet read a contract that does not
/// exist and report a zero balance.
pub struct TigerTokens {
    pub tgr: Token,
    pub rusd: Token,
}

impl TigerTokens {
    /// The TGR and RUSD tokens on TigerSmartChain, from their real addresses.
    ///
    /// `tgr_address` is the wrapped/native-bridged TGR contract and
    /// `rusd_address` the RUSD stablecoin contract; both must be real 20-byte
    /// addresses on the chain the caller names. RUSD is a 1:1 USD stablecoin, so
    /// its decimals default to 6 (the chain's `Stablecoin` factory preset); pass
    /// the deployed contract's own decimals when they differ.
    pub fn new(chain: &str, tgr_address: &str, rusd_address: &str, tgr_total_supply: f64, rusd_total_supply: f64) -> Self {
        Self::with_rusd_decimals(chain, tgr_address, rusd_address, tgr_total_supply, rusd_total_supply, 6)
    }

    /// As [`TigerTokens::new`], with an explicit RUSD decimals value.
    pub fn with_rusd_decimals(
        chain: &str,
        tgr_address: &str,
        rusd_address: &str,
        tgr_total_supply: f64,
        rusd_total_supply: f64,
        rusd_decimals: u8,
    ) -> Self {
        let tgr = Token::new_erc20("tgr", "TGR", "Tiger Coin", tgr_address, chain, 18)
            .with_supply(tgr_total_supply);
        let rusd = Token::new_erc20(
            "rusd",
            "RUSD",
            "Royal Tiger USD",
            rusd_address,
            chain,
            rusd_decimals,
        )
        .with_supply(rusd_total_supply);

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
        if !amount.is_finite() || amount <= 0.0 {
            return;
        }
        match source {
            FeeSource::Exchange => self.exchange_fees += amount,
            FeeSource::DexSwap => self.dex_swap_fees += amount,
            FeeSource::Bridge => self.bridge_fees += amount,
            FeeSource::Wallet => self.wallet_fees += amount,
            FeeSource::Staking => self.staking_fees += amount,
        }
        self.total_fees += amount;
    }

    /// The fee booked against one source, which is what the split reports.
    pub fn for_source(&self, source: FeeSource) -> f64 {
        match source {
            FeeSource::Exchange => self.exchange_fees,
            FeeSource::DexSwap => self.dex_swap_fees,
            FeeSource::Bridge => self.bridge_fees,
            FeeSource::Wallet => self.wallet_fees,
            FeeSource::Staking => self.staking_fees,
        }
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
    hd_seed: RwLock<Option<[u8; 64]>>,
    hd_phrase: RwLock<Option<String>>,

    // Statistics
    total_volume_24h: RwLock<f64>,
    fees_collected: RwLock<FeeCollection>,
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

/// One chain a deployment operates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub key: String,
    pub name: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub explorer_url: String,
    pub native_symbol: String,
    pub native_decimals: u8,
}

/// One token a deployment lists, with its real contract address and reference
/// price. A token without a positive reference price cannot be swapped (fee
/// accounting is denominated in USD), so `price_usd` is required.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenConfig {
    pub symbol: String,
    pub name: String,
    pub address: String,
    pub chain: String,
    pub decimals: u8,
    pub standard: TokenStandard,
    pub total_supply: f64,
    pub price_usd: f64,
}

/// One DEX pool a deployment seeds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolConfig {
    pub token_a: String,
    pub token_b: String,
    pub fee_rate: f64,
}

/// One bridge a deployment operates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConfig {
    pub key: String,
    pub name: String,
    pub source_chain: String,
    pub target_chain: String,
    pub contract_address: String,
}

/// Everything a deployment operates, supplied by the caller.
///
/// There is deliberately no `Default`: a default would be a fabricated dataset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentConfig {
    pub chains: Vec<ChainConfig>,
    pub tokens: Vec<TokenConfig>,
    pub pools: Vec<PoolConfig>,
    pub bridges: Vec<BridgeConfig>,
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
    /// An empty ecosystem.
    ///
    /// Nothing is seeded: chains, tokens, pools, farms and bridges are all
    /// operator configuration added through the `add_*`/`create_*` methods (or
    /// the registry that fronts them). A default dataset would mean the process
    /// advertised endpoints, contract addresses and prices it had invented,
    /// which is exactly what a live exchange must never do.
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1000);

        Self {
            blockchains: RwLock::new(HashMap::new()),
            tokens: RwLock::new(HashMap::new()),
            bridges: RwLock::new(HashMap::new()),
            dex_pools: RwLock::new(HashMap::new()),
            farms: RwLock::new(HashMap::new()),
            wallets: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            hd_seed: RwLock::new(None),
            hd_phrase: RwLock::new(None),
            total_volume_24h: RwLock::new(0.0),
            fees_collected: RwLock::new(FeeCollection::new()),
            pool_count: RwLock::new(0),
            active_chain_count: RwLock::new(0),
            active_token_count: RwLock::new(0),
            event_tx,
            settings: EcosystemSettings::default(),
        }
    }

    /// The deployment settings this ecosystem runs with.
    pub fn settings(&self) -> EcosystemSettings {
        self.settings.clone()
    }

    /// Register the chains, tokens, pools and bridges a deployment operates.
    ///
    /// This is the seed point a caller drives from its own configuration: it
    /// takes each entry's real values (node URL, chain id, contract address,
    /// reference price) rather than a compiled-in list. It exists so a caller
    /// can build a populated ecosystem in one call, and it never invents an
    /// entry — every value comes from the argument.
    pub fn register_deployment(&mut self, deployment: &DeploymentConfig) {
        for chain in &deployment.chains {
            self.add_evm_chain(
                &chain.key,
                &chain.name,
                chain.chain_id,
                &chain.rpc_url,
                &chain.explorer_url,
                &chain.native_symbol,
                chain.native_decimals,
            );
        }
        for token in &deployment.tokens {
            self.add_token(
                &token.symbol,
                &token.name,
                &token.address,
                &token.chain,
                token.decimals,
                token.standard,
                token.total_supply,
                token.price_usd,
            );
        }
        for pool in &deployment.pools {
            self.create_pool(&pool.token_a, &pool.token_b, pool.fee_rate);
        }
        for bridge in &deployment.bridges {
            self.add_bridge(
                &bridge.key,
                &bridge.name,
                &bridge.source_chain,
                &bridge.target_chain,
                &bridge.contract_address,
            );
        }
    }

    // ============================================================================
    // CHAIN MANAGEMENT
    // ============================================================================

    pub fn add_evm_chain(&mut self, key: &str, name: &str, chain_id: u64, rpc: &str, explorer: &str, symbol: &str, decimals: u8) {
        let chain = Blockchain::new_evm(key, name, chain_id, rpc, explorer, symbol, decimals);
        self.blockchains.write().unwrap().insert(key.to_string(), chain);

        let count = *self.active_chain_count.read().unwrap();
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

        let count = *self.active_chain_count.read().unwrap();
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

        let count = *self.active_token_count.read().unwrap();
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

        let count = *self.pool_count.read().unwrap();
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

    /// Seeds a pool with `notional_usd` of value on each side, priced from the
    /// tokens' reference prices, so the pool's initial mid price equals the
    /// reference price. No-op if either token is unknown or a price is missing.
    pub fn bootstrap_pool(&mut self, token_a: &str, token_b: &str, notional_usd: f64) {
        let (price_a, price_b) = {
            let tokens = self.tokens.read().unwrap();
            match (tokens.get(token_a), tokens.get(token_b)) {
                (Some(a), Some(b)) if a.price_usd > 0.0 && b.price_usd > 0.0 => {
                    (a.price_usd, b.price_usd)
                }
                _ => return,
            }
        };
        let amount_a = notional_usd / price_a;
        let amount_b = notional_usd / price_b;
        let key = format!("{token_a}_{token_b}");
        self.add_liquidity(&key, amount_a, amount_b);
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

    /// Sets the HD seed used to derive wallet keys.
    ///
    /// The seed must be installed before any wallet can be created; without it
    /// [`TigerEcosystem::create_wallet`] fails closed rather than inventing an
    /// address that no key can ever spend from.
    pub fn set_hd_seed(&self, phrase: &str) -> Result<(), TigerEcosystemError> {
        if !tigerex_hdwallet::validate_mnemonic(phrase) {
            return Err(TigerEcosystemError::WalletError(
                "seed phrase failed BIP39 checksum validation".to_string(),
            ));
        }
        let seed = tigerex_hdwallet::mnemonic_to_seed(phrase)
            .map_err(|e| TigerEcosystemError::WalletError(e.to_string()))?;
        *self.hd_seed.write().unwrap() = Some(seed);
        *self.hd_phrase.write().unwrap() = Some(phrase.to_string());
        Ok(())
    }

    pub fn create_wallet(&mut self, chain: &str) -> Result<Wallet, TigerEcosystemError> {
        // Verify chain is supported
        if !self.blockchains.read().unwrap().contains_key(chain) {
            return Err(TigerEcosystemError::ChainNotSupported(chain.to_string()));
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u64;

        // Derive a real address from the configured seed.
        let seed = self.hd_seed.read().unwrap().clone().ok_or_else(|| {
            TigerEcosystemError::WalletError(
                "no HD seed configured; call set_hd_seed before creating wallets".to_string(),
            )
        })?;
        let phrase = self.hd_phrase.read().unwrap().clone().unwrap_or_default();
        let family = tigerex_hdwallet::ChainFamily::from_chain_id(chain);
        let path = tigerex_hdwallet::default_derivation_path(family);
        let derived = tigerex_hdwallet::derive_for_family(family, &seed, &phrase, &path)
            .map_err(|e| TigerEcosystemError::WalletError(e.to_string()))?;

        let wallet = Wallet {
            address: derived.address,
            chain: chain.to_string(),
            public_key: derived.public_key_hex,
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
        let mut txs = self.transactions.write().unwrap();
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

        let pool = {
            let pools = self.dex_pools.read().unwrap();
            pools
                .get(&pool_key)
                .or_else(|| pools.get(&pool_key_alt))
                .cloned()
        }
        .ok_or_else(|| TigerEcosystemError::InsufficientLiquidity(pool_key.clone()))?;

        if amount <= 0.0 || !amount.is_finite() {
            return Err(TigerEcosystemError::DexError(
                "swap amount must be positive and finite".to_string(),
            ));
        }

        // Resolve which side of the pool is being sold. The stored pool keeps
        // token_a/token_b; a swap may come in either direction.
        let (reserve_in, reserve_out, is_a_to_b) =
            if pool.token_a == from_token && pool.token_b == to_token {
                (pool.liquidity_a, pool.liquidity_b, true)
            } else {
                (pool.liquidity_b, pool.liquidity_a, false)
            };

        if reserve_in <= 0.0 || reserve_out <= 0.0 {
            return Err(TigerEcosystemError::InsufficientLiquidity(format!(
                "pool {pool_key} has no liquidity"
            )));
        }

        // Constant-product AMM (x*y=k) with the pool fee taken off the input.
        let fee = amount * pool.fee_rate;
        let amount_in_after_fee = amount - fee;
        let numerator = amount_in_after_fee * reserve_out;
        let denominator = reserve_in + amount_in_after_fee;
        let output = numerator / denominator;

        if !output.is_finite() || output <= 0.0 {
            return Err(TigerEcosystemError::InsufficientLiquidity(
                "swap output would be zero".to_string(),
            ));
        }

        // Price impact: how far the execution price moved from the pool mid price.
        let spot_price = reserve_out / reserve_in;
        let execution_price = output / amount_in_after_fee;
        let price_impact = ((spot_price - execution_price) / spot_price).abs() * 100.0;

        // Slippage guard: the realised impact must not exceed the caller's limit.
        if price_impact > slippage {
            return Err(TigerEcosystemError::DexError(format!(
                "price impact {price_impact:.4}% exceeds slippage tolerance {slippage:.4}%"
            )));
        }

        // The input token must have a real reference price: fee accounting is
        // denominated in USD, and an unknown token is not worth one dollar.
        let from_price = match self.tokens.read().unwrap().get(from_token) {
            Some(token) if token.price_usd.is_finite() && token.price_usd > 0.0 => token.price_usd,
            _ => {
                return Err(TigerEcosystemError::TokenNotFound(format!(
                    "no reference price for {from_token}"
                )))
            }
        };

        // Advance the pool reserves so subsequent swaps see the post-trade state.
        // The constant-product invariant is preserved by construction.
        self.add_fee(FeeSource::DexSwap, fee * from_price);
        {
            let mut pools = self.dex_pools.write().unwrap();
            let stored = if pools.contains_key(&pool_key) {
                pools.get_mut(&pool_key)
            } else {
                pools.get_mut(&pool_key_alt)
            };
            if let Some(stored) = stored {
                if is_a_to_b {
                    stored.liquidity_a += amount_in_after_fee;
                    stored.liquidity_b -= output;
                } else {
                    stored.liquidity_b += amount_in_after_fee;
                    stored.liquidity_a -= output;
                }
                stored.volume_24h += amount;
            }
        }

        Ok(SwapResult {
            from_token: from_token.to_string(),
            to_token: to_token.to_string(),
            from_amount: amount,
            to_amount: output,
            fee,
            fee_usd: fee * from_price,
            price_impact,
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

            // Try via stable: the second leg depends on the first leg's output.
            if let Ok(first) = self.swap(from_token, stable, amount, slippage) {
                if let Ok(second) = self.swap(stable, to_token, first.to_amount, slippage) {
                    return Ok(SwapResult {
                        from_token: first.from_token,
                        to_token: second.to_token,
                        from_amount: first.from_amount,
                        to_amount: second.to_amount,
                        fee: first.fee + second.fee,
                        fee_usd: first.fee_usd + second.fee_usd,
                        price_impact: first.price_impact + second.price_impact,
                        slippage,
                        route: vec![
                            from_token.to_string(),
                            stable.to_string(),
                            to_token.to_string(),
                        ],
                    });
                }
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
        self.add_fee(FeeSource::Bridge, fee);

        Ok(BridgeResult {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            from_amount: amount,
            to_amount: amount_after_fee,
            fee,
            estimated_time_minutes: bridge.estimated_time_minutes,
            // Deterministic reference derived from the bridge request, so the
            // same transfer always maps to the same id for reconciliation.
            tx_hash: bridge_reference(from_chain, to_chain, token, amount, &bridge),
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
                total_fee: swap_result.fee,
                total_amount: swap_result.to_amount,
                steps: vec![CrossChainStep::Swap(swap_result)],
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
        let mut snapshot = self.fees_collected.read().unwrap().clone();
        snapshot.timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u64;
        snapshot
    }

    /// Record a fee against its source. The split reports exactly what was
    /// recorded here; it is never estimated from a total.
    pub fn add_fee(&self, source: FeeSource, amount: f64) {
        self.fees_collected.write().unwrap().add(source, amount);
    }

    // ============================================================================
    // STATISTICS
    // ============================================================================

    pub fn get_statistics(&self) -> EcosystemStatistics {
        EcosystemStatistics {
            total_volume_24h: *self.total_volume_24h.read().unwrap(),
            total_fees_collected: self.fees_collected.read().unwrap().total_fees,
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


/// Deterministic reference id for a bridge transfer.
///
/// The value is the keccak256 of the transfer parameters, so the same request
/// always yields the same reference (safe for idempotency and reconciliation)
/// without inventing a random hash that no chain could ever confirm.
fn bridge_reference(
    from_chain: &str,
    to_chain: &str,
    token: &str,
    amount: f64,
    bridge: &Bridge,
) -> String {
    let mut payload = Vec::new();
    payload.extend_from_slice(from_chain.as_bytes());
    payload.push(0x1f);
    payload.extend_from_slice(to_chain.as_bytes());
    payload.push(0x1f);
    payload.extend_from_slice(token.as_bytes());
    payload.push(0x1f);
    payload.extend_from_slice(format!("{amount:.18}").as_bytes());
    payload.push(0x1f);
    payload.extend_from_slice(bridge.key.as_bytes());
    format!("0x{}", hex::encode(keccak_hash::keccak(&payload)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A test deployment. The addresses are documentation constants used only
    /// by these tests; the library itself never embeds an address.
    fn fixture() -> TigerEcosystem {
        let mut ecosystem = TigerEcosystem::new();
        ecosystem.register_deployment(&DeploymentConfig {
            chains: vec![
                ChainConfig {
                    key: "tigersmartchain".into(),
                    name: "TigerSmartChain".into(),
                    chain_id: 9001,
                    rpc_url: "https://rpc.test.invalid".into(),
                    explorer_url: "https://scan.test.invalid".into(),
                    native_symbol: "TGR".into(),
                    native_decimals: 18,
                },
                ChainConfig {
                    key: "ethereum".into(),
                    name: "Ethereum".into(),
                    chain_id: 1,
                    rpc_url: "https://eth.test.invalid".into(),
                    explorer_url: "https://etherscan.test.invalid".into(),
                    native_symbol: "ETH".into(),
                    native_decimals: 18,
                },
            ],
            tokens: vec![
                TokenConfig {
                    symbol: "TGR".into(),
                    name: "Tiger Coin".into(),
                    address: "0x1111111111111111111111111111111111111111".into(),
                    chain: "tigersmartchain".into(),
                    decimals: 18,
                    standard: TokenStandard::ERC20,
                    total_supply: 1_000_000_000.0,
                    price_usd: 0.5,
                },
                TokenConfig {
                    symbol: "RUSD".into(),
                    name: "Royal Tiger USD".into(),
                    address: "0x2222222222222222222222222222222222222222".into(),
                    chain: "tigersmartchain".into(),
                    decimals: 6,
                    standard: TokenStandard::ERC20,
                    total_supply: 1_000_000_000.0,
                    price_usd: 1.0,
                },
                TokenConfig {
                    symbol: "USDT".into(),
                    name: "Tether USD".into(),
                    address: "0x3333333333333333333333333333333333333333".into(),
                    chain: "ethereum".into(),
                    decimals: 18,
                    standard: TokenStandard::ERC20,
                    total_supply: 0.0,
                    price_usd: 1.0,
                },
            ],
            pools: vec![
                PoolConfig { token_a: "TGR".into(), token_b: "USDT".into(), fee_rate: 0.003 },
                PoolConfig { token_a: "RUSD".into(), token_b: "USDT".into(), fee_rate: 0.001 },
            ],
            bridges: vec![BridgeConfig {
                key: "tgr_eth".into(),
                name: "Tiger-Ethereum Bridge".into(),
                source_chain: "tigersmartchain".into(),
                target_chain: "ethereum".into(),
                contract_address: "0x4444444444444444444444444444444444444444".into(),
            }],
        });
        ecosystem
    }

    /// A new ecosystem advertises nothing: no chains, tokens, pools or farms.
    #[test]
    fn a_new_ecosystem_is_empty() {
        let ecosystem = TigerEcosystem::new();
        let stats = ecosystem.get_statistics();
        assert_eq!(stats.active_chain_count, 0);
        assert_eq!(stats.active_token_count, 0);
        assert_eq!(stats.active_pool_count, 0);
        assert_eq!(stats.active_farm_count, 0);
        assert_eq!(stats.total_fees_collected, 0.0);
        assert!(ecosystem.get_all_chains().is_empty());
        assert!(ecosystem.get_all_tokens().is_empty());
    }

    #[test]
    fn register_deployment_populates_from_caller_config() {
        let ecosystem = fixture();
        let stats = ecosystem.get_statistics();
        assert_eq!(stats.active_chain_count, 2);
        assert_eq!(stats.active_token_count, 3);
        assert_eq!(stats.active_pool_count, 2);

        // The token carries the caller's address and price, not an invented one.
        let tgr = ecosystem.get_token("TGR").expect("TGR listed");
        assert_eq!(tgr.address, "0x1111111111111111111111111111111111111111");
        assert_eq!(tgr.price_usd, 0.5);
        assert_eq!(tgr.total_supply, "1000000000");
    }

    /// A swap whose input token has no reference price is rejected rather than
    /// booked at a made-up one dollar.
    #[test]
    fn swap_rejects_unpriced_token() {
        let mut ecosystem = fixture();
        // A listed token with no price feed yet, and a pool it can trade in.
        ecosystem.add_token("NOPRICE", "No Price Token", "0x5555555555555555555555555555555555555555", "ethereum", 18, TokenStandard::ERC20, 1.0, 0.0);
        ecosystem.create_pool("NOPRICE", "USDT", 0.003);
        // Give the pool reserves directly: bootstrap_pool refuses to seed from a
        // token that has no price, which is the behaviour under test.
        ecosystem.add_liquidity("NOPRICE_USDT", 10_000.0, 10_000.0);

        let result = ecosystem.swap("NOPRICE", "USDT", 1.0, 50.0);
        assert!(matches!(result, Err(TigerEcosystemError::TokenNotFound(_))));
    }

    #[test]
    fn test_chain_search() {
        let ecosystem = fixture();
        let chains = ecosystem.search_chains("eth");

        assert!(!chains.is_empty());
    }

    #[test]
    fn test_token_search() {
        let ecosystem = fixture();
        let tokens = ecosystem.search_tokens("tiger");

        assert!(!tokens.is_empty());
    }

    #[test]
    fn wallet_creation_requires_seed_and_derives_real_address() {
        let mut ecosystem = fixture();
        // Without a seed, wallet creation must fail closed.
        assert!(ecosystem.create_wallet("ethereum").is_err());

        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon art";
        ecosystem.set_hd_seed(phrase).unwrap();

        let wallet = ecosystem.create_wallet("ethereum").unwrap();
        assert_eq!(wallet.address, "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");
        assert!(!wallet.public_key.is_empty());
        assert!(tigerex_hdwallet::is_valid_evm_address(&wallet.address));

        // Rejecting an invalid phrase keeps the seed unset.
        let mut fresh = TigerEcosystem::new();
        assert!(fresh.set_hd_seed("not a real mnemonic").is_err());
        assert!(fresh.create_wallet("ethereum").is_err());
    }

    #[test]
    fn swap_uses_constant_product_and_moves_price() {
        let mut ecosystem = fixture();
        ecosystem.add_liquidity("TGR_USDT", 1_000_000.0, 500_000.0);

        let pool = ecosystem.get_pool("TGR_USDT").expect("pool exists");
        let reserve_in = pool.liquidity_a;
        let reserve_out = pool.liquidity_b;
        let amount = reserve_in / 1000.0;

        let result = ecosystem
            .swap("TGR", "USDT", amount, 5.0)
            .expect("swap should succeed");

        // x*y=k: output must match the constant-product formula exactly.
        let fee = amount * pool.fee_rate;
        let expected_out = (amount - fee) * reserve_out / (reserve_in + (amount - fee));
        assert!((result.to_amount - expected_out).abs() < 1e-9);
        // Selling into a pool must move the price against the trader.
        assert!(result.price_impact > 0.0);

        // Reserves advanced: token_in up, token_out down.
        let after = ecosystem.get_pool("TGR_USDT").unwrap();
        assert!(after.liquidity_a > pool.liquidity_a);
        assert!(after.liquidity_b < pool.liquidity_b);

        // The swap fee is booked to the DEX bucket, and the split sums to it.
        let fees = ecosystem.collect_fees();
        assert!(fees.dex_swap_fees > 0.0);
        assert!((fees.total_fees - fees.dex_swap_fees).abs() < 1e-9);
    }

    #[test]
    fn swap_rejects_empty_pool_and_bad_amounts() {
        let mut ecosystem = fixture();
        assert!(ecosystem.swap("NOPE", "ALSO", 10.0, 1.0).is_err());
        // An empty pool cannot quote.
        assert!(ecosystem.swap("TGR", "USDT", 1.0, 1.0).is_err());
        ecosystem.add_liquidity("TGR_USDT", 100_000.0, 50_000.0);
        assert!(ecosystem.swap("TGR", "USDT", 0.0, 1.0).is_err());
        assert!(ecosystem.swap("TGR", "USDT", -5.0, 1.0).is_err());
    }

    /// The fee split reports exactly what was recorded against each source, and
    /// refuses a non-positive amount.
    #[test]
    fn fee_split_reports_recorded_fees_only() {
        let ecosystem = TigerEcosystem::new();
        ecosystem.add_fee(FeeSource::DexSwap, 30.0);
        ecosystem.add_fee(FeeSource::Bridge, 10.0);
        ecosystem.add_fee(FeeSource::Exchange, 5.0);
        ecosystem.add_fee(FeeSource::DexSwap, -1.0);

        let fees = ecosystem.collect_fees();
        assert_eq!(fees.dex_swap_fees, 30.0);
        assert_eq!(fees.bridge_fees, 10.0);
        assert_eq!(fees.exchange_fees, 5.0);
        assert_eq!(fees.wallet_fees, 0.0);
        assert_eq!(fees.staking_fees, 0.0);
        assert_eq!(fees.total_fees, 45.0);
    }

    #[test]
    fn bridge_reference_is_deterministic() {
        let ecosystem = fixture();
        let bridge = Bridge::new("b1", "Test", "ethereum", "polygon", "0xabc");
        let first = bridge_reference("ethereum", "polygon", "USDT", 100.0, &bridge);
        let second = bridge_reference("ethereum", "polygon", "USDT", 100.0, &bridge);
        let different = bridge_reference("ethereum", "polygon", "USDT", 101.0, &bridge);
        assert_eq!(first, second);
        assert_ne!(first, different);
        assert_eq!(first.len(), 66);
        assert!(first.starts_with("0x"));
        // A bridge request books its fee against the bridge bucket.
        ecosystem.bridge("tigersmartchain", "ethereum", "TGR", 100.0).unwrap();
        assert!(ecosystem.collect_fees().bridge_fees > 0.0);
    }

    /// `TigerTokens` uses the caller's real addresses, never a placeholder.
    #[test]
    fn tiger_tokens_use_configured_addresses() {
        let tokens = TigerTokens::new(
            "tigersmartchain",
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            1_000_000_000.0,
            1_000_000_000.0,
        );
        assert_eq!(tokens.tgr.address, "0x1111111111111111111111111111111111111111");
        assert_eq!(tokens.rusd.address, "0x2222222222222222222222222222222222222222");
        assert_eq!(tokens.tgr.total_supply, "1000000000");
        // RUSD is a USD stablecoin: 6 decimals by default, overridable.
        assert_eq!(tokens.rusd.decimals, 6);
        let eighteen = TigerTokens::with_rusd_decimals(
            "tigersmartchain",
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            1.0,
            1.0,
            18,
        );
        assert_eq!(eighteen.rusd.decimals, 18);
    }
}
