/**
 * TigerEx - Rust Integration Core
 * 
 * High-performance Rust backend for TigerEx platform
 * Features: Transaction processing, Fee collection, Order matching
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ==================== Chain Types ====================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChainType {
    EVM,
    Solana,
    Near,
    Aptos,
    Sui,
}

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub id: u32,
    pub key: String,
    pub name: String,
    pub chain_type: ChainType,
    pub symbol: String,
    pub decimals: u8,
    pub rpc_url: String,
    pub explorer_url: String,
    pub chain_id: String,
    pub is_active: bool,
    pub is_native: bool,
}

impl ChainConfig {
    pub fn new(
        id: u32,
        key: &str,
        name: &str,
        chain_type: ChainType,
        symbol: &str,
        decimals: u8,
    ) -> Self {
        Self {
            id,
            key: key.to_string(),
            name: name.to_string(),
            chain_type,
            symbol: symbol.to_string(),
            decimals,
            rpc_url: String::new(),
            explorer_url: String::new(),
            chain_id: String::new(),
            is_active: true,
            is_native: false,
        }
    }
}

// ==================== Token Types ====================

#[derive(Debug, Clone)]
pub struct TokenConfig {
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub chain_key: String,
    pub is_native: bool,
    pub total_supply: u128,
    pub price_usd: f64,
    pub is_stablecoin: bool,
    pub is_verified: bool,
}

// ==================== Wallet Types ====================

#[derive(Debug, Clone)]
pub struct Wallet {
    pub address: String,
    pub public_key: String,
    pub chain_key: String,
    pub created_at: u64,
    pub encrypted: bool,
}

impl Wallet {
    pub fn new(address: &str, public_key: &str, chain_key: &str) -> Self {
        Self {
            address: address.to_string(),
            public_key: public_key.to_string(),
            chain_key: chain_key.to_string(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            encrypted: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub value: u128,
    pub gas_limit: u64,
    pub gas_price: u64,
    pub nonce: u64,
    pub chain_key: String,
    pub status: TransactionStatus,
    pub block_number: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
}

// ==================== DEX Types ====================

#[derive(Debug, Clone)]
pub struct LiquidityPool {
    pub id: String,
    pub token_a: String,
    pub token_b: String,
    pub reserve_a: u128,
    pub reserve_b: u128,
    pub liquidity: u128,
    pub fee: f64,
    pub chain_key: String,
    pub apr: f64,
}

impl LiquidityPool {
    pub fn new(token_a: &str, token_b: &str, chain_key: &str, fee: f64) -> Self {
        Self {
            id: format!("{}_{}", token_a, token_b),
            token_a: token_a.to_string(),
            token_b: token_b.to_string(),
            reserve_a: 0,
            reserve_b: 0,
            liquidity: 0,
            fee,
            chain_key: chain_key.to_string(),
            apr: 0.0,
        }
    }

    pub fn calculate_output(&self, amount_in: u128) -> u128 {
        let amount_in_with_fee = (amount_in as f64 * (1.0 - self.fee)) as u128;
        (amount_in_with_fee * self.reserve_b as u128) / (self.reserve_a as u128 + amount_in_with_fee)
    }
}

#[derive(Debug, Clone)]
pub struct Farm {
    pub pool_id: String,
    pub reward_token: String,
    pub reward_rate: u128,
    pub total_staked: u128,
    pub apr: f64,
    pub start_time: u64,
    pub end_time: u64,
}

// ==================== Bridge Types ====================

#[derive(Debug, Clone)]
pub struct Bridge {
    pub id: String,
    pub source_chain: String,
    pub target_chain: String,
    pub min_amount: u128,
    pub max_amount: u128,
    pub fee: u128,
    pub fee_percent: f64,
    pub time_estimate: u64,
    pub is_active: bool,
}

impl Bridge {
    pub fn new(
        source_chain: &str,
        target_chain: &str,
        min_amount: u128,
        max_amount: u128,
        fee: u128,
        fee_percent: f64,
        time_estimate: u64,
    ) -> Self {
        Self {
            id: format!("{}_{}", source_chain, target_chain),
            source_chain: source_chain.to_string(),
            target_chain: target_chain.to_string(),
            min_amount,
            max_amount,
            fee,
            fee_percent,
            time_estimate,
            is_active: true,
        }
    }

    pub fn calculate_fee(&self, amount: u128) -> u128 {
        let percent_fee = (amount as f64 * self.fee_percent / 100.0) as u128;
        self.fee + percent_fee
    }
}

// ==================== Fee Types ====================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeeType {
    Exchange,
    DEX,
    Bridge,
    Wallet,
    Staking,
    Platform,
}

#[derive(Debug, Clone)]
pub struct Fee {
    pub fee_type: FeeType,
    pub amount: u128,
    pub token: String,
    pub chain_key: String,
    pub timestamp: u64,
    pub tx_hash: Option<String>,
}

// ==================== Core Services ====================

pub struct TigerWalletService {
    wallets: RwLock<HashMap<String, Wallet>>,
    providers: RwLock<HashMap<String, ChainConfig>>,
    transactions: RwLock<HashMap<String, Transaction>>,
    base_fee: u64,
    gas_fee_multiplier: f64,
}

impl TigerWalletService {
    pub fn new() -> Self {
        Self {
            wallets: RwLock::new(HashMap::new()),
            providers: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            base_fee: 100000000000000, // 0.0001 TGR
            gas_fee_multiplier: 1.1,
        }
    }

    pub fn add_chain(&self, config: ChainConfig) {
        let mut providers = self.providers.write().unwrap();
        providers.insert(config.key.clone(), config);
    }

    pub fn create_wallet(&self, chain_key: &str) -> Result<Wallet, String> {
        let providers = self.providers.read().unwrap();
        if !providers.contains_key(chain_key) {
            return Err(format!("Chain not supported: {}", chain_key));
        }
        drop(providers);

        // Generate wallet (in production, use proper key derivation)
        let address = generate_address();
        let public_key = generate_public_key();
        let wallet = Wallet::new(&address, &public_key, chain_key);

        let mut wallets = self.wallets.write().unwrap();
        wallets.insert(address.clone(), wallet.clone());

        Ok(wallet)
    }

    pub fn send_transaction(&self, tx: Transaction) -> Result<String, String> {
        let providers = self.providers.read().unwrap();
        let chain = providers.get(&tx.chain_key);
        
        if chain.is_none() {
            return Err(format!("Chain not supported: {}", tx.chain_key));
        }
        
        if !chain.unwrap().is_active {
            return Err(format!("Chain not active: {}", tx.chain_key));
        }
        drop(providers);

        // Calculate fee
        let fee = self.calculate_transaction_fee(&tx);
        
        // Execute transaction (in production, use RPC)
        let tx_hash = generate_tx_hash();
        let mut tx = tx;
        tx.hash = tx_hash.clone();
        tx.status = TransactionStatus::Confirmed;
        tx.timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let mut transactions = self.transactions.write().unwrap();
        transactions.insert(tx_hash.clone(), tx);

        Ok(tx_hash)
    }

    fn calculate_transaction_fee(&self, tx: &Transaction) -> u128 {
        let gas_limit = tx.gas_limit as u128;
        let gas_price = tx.gas_price as u128;
        let base_fee = self.base_fee as u128;
        let gas_fee = gas_limit * gas_price / 1_000_000_000_000_000_000;
        
        base_fee + ((gas_fee as f64 * self.gas_fee_multiplier) as u128)
    }

    pub fn get_transaction(&self, tx_hash: &str) -> Option<Transaction> {
        let transactions = self.transactions.read().unwrap();
        transactions.get(tx_hash).cloned()
    }

    pub fn get_balance(&self, address: &str, _chain_key: &str) -> u128 {
        // In production, query RPC
        0
    }
}

pub struct TigerswapService {
    pools: RwLock<HashMap<String, LiquidityPool>>,
    farms: RwLock<HashMap<String, Farm>>,
    swap_fee: f64,
    owner_fee: f64,
}

impl TigerswapService {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            farms: RwLock::new(HashMap::new()),
            swap_fee: 0.003, // 0.3%
            owner_fee: 0.15, // 15% to platform
        }
    }

    pub fn create_pool(&self, token_a: &str, token_b: &str, chain_key: &str, fee: f64) -> LiquidityPool {
        let pool = LiquidityPool::new(token_a, token_b, chain_key, fee);
        
        let mut pools = self.pools.write().unwrap();
        pools.insert(pool.id.clone(), pool.clone());
        
        pool
    }

    pub fn add_liquidity(&self, pool_id: &str, amount_a: u128, amount_b: u128) -> Result<(), String> {
        let mut pools = self.pools.write().unwrap();
        let pool = pools.get_mut(pool_id).ok_or("Pool not found")?;
        
        pool.reserve_a += amount_a;
        pool.reserve_b += amount_b;
        
        Ok(())
    }

    pub fn swap(&self, token_in: &str, token_out: &str, amount_in: u128) -> Result<u128, String> {
        let pool_key = format!("{}_{}", token_in, token_out);
        
        let mut pools = self.pools.write().unwrap();
        let pool = pools.get_mut(&pool_key).ok_or("Pool not found")?;
        
        let amount_out = pool.calculate_output(amount_in);
        
        // Update reserves
        pool.reserve_a += amount_in;
        pool.reserve_b = pool.reserve_b.saturating_sub(amount_out);
        
        Ok(amount_out)
    }

    pub fn get_quote(&self, token_in: &str, token_out: &str, amount_in: u128) -> Result<(u128, f64), String> {
        let pool_key = format!("{}_{}", token_in, token_out);
        
        let pools = self.pools.read().unwrap();
        let pool = pools.get(&pool_key).ok_or("Pool not found")?;
        
        let amount_out = pool.calculate_output(amount_in);
        let price_impact = (amount_in as f64 / pool.reserve_a as f64) * 100.0;
        
        Ok((amount_out, price_impact))
    }

    pub fn create_farm(
        &self,
        pool_id: &str,
        reward_token: &str,
        reward_rate: u128,
        apy: f64,
        duration_days: u64,
    ) -> Farm {
        let farm = Farm {
            pool_id: pool_id.to_string(),
            reward_token: reward_token.to_string(),
            reward_rate,
            total_staked: 0,
            apy,
            start_time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            end_time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() + (duration_days * 86400),
        };

        let mut farms = self.farms.write().unwrap();
        farms.insert(pool_id.to_string(), farm.clone());

        farm
    }

    pub fn get_pool(&self, pool_id: &str) -> Option<LiquidityPool> {
        let pools = self.pools.read().unwrap();
        pools.get(pool_id).cloned()
    }

    pub fn get_all_pools(&self) -> Vec<LiquidityPool> {
        let pools = self.pools.read().unwrap();
        pools.values().cloned().collect()
    }
}

pub struct TigerSmartChainService {
    nodes: RwLock<HashMap<String, ChainConfig>>,
    bridges: RwLock<HashMap<String, Bridge>>,
    tgr_price: RwLock<f64>,
    rusd_price: RwLock<f64>,
}

impl TigerSmartChainService {
    pub fn new() -> Self {
        Self {
            nodes: RwLock::new(HashMap::new()),
            bridges: RwLock::new(HashMap::new()),
            tgr_price: RwLock::new(0.05),
            rusd_price: RwLock::new(1.0),
        }
    }

    pub fn create_bridge(
        &self,
        source_chain: &str,
        target_chain: &str,
        min_amount: u128,
        max_amount: u128,
        fee: u128,
        fee_percent: f64,
        time_estimate: u64,
    ) -> Bridge {
        let bridge = Bridge::new(
            source_chain,
            target_chain,
            min_amount,
            max_amount,
            fee,
            fee_percent,
            time_estimate,
        );

        let mut bridges = self.bridges.write().unwrap();
        bridges.insert(bridge.id.clone(), bridge.clone());

        bridge
    }

    pub fn initiate_bridge(&self, sender: &str, amount: u128, target_chain: &str) -> Result<(String, u128), String> {
        let bridges = self.bridges.read().unwrap();
        let bridge = bridges
            .get(&format!("tigersmartchain_{}", target_chain))
            .ok_or("Bridge not found")?;
        
        if !bridge.is_active {
            return Err("Bridge not active".to_string());
        }
        
        if amount < bridge.min_amount {
            return Err(format!("Amount below minimum: {}", bridge.min_amount));
        }
        
        if amount > bridge.max_amount {
            return Err(format!("Amount above maximum: {}", bridge.max_amount));
        }

        let fee = bridge.calculate_fee(amount);
        let total = amount + fee;

        Ok((generate_tx_hash(), fee))
    }

    pub fn get_tgr_price(&self) -> f64 {
        *self.tgr_price.read().unwrap()
    }

    pub fn get_rusd_price(&self) -> f64 {
        *self.rusd_price.read().unwrap()
    }

    pub fn set_tgr_price(&self, price: f64) {
        let mut tgr_price = self.tgr_price.write().unwrap();
        *tgr_price = price;
    }

    pub fn set_rusd_price(&self, price: f64) {
        let mut rusd_price = self.rusd_price.write().unwrap();
        *rusd_price = price;
    }

    pub fn get_all_bridges(&self) -> Vec<Bridge> {
        let bridges = self.bridges.read().unwrap();
        bridges.values().cloned().collect()
    }
}

pub struct FeeCollectorService {
    fees: RwLock<HashMap<FeeType, u128>>,
    chain_fees: RwLock<HashMap<String, HashMap<FeeType, u128>>>,
}

impl FeeCollectorService {
    pub fn new() -> Self {
        Self {
            fees: RwLock::new(HashMap::new()),
            chain_fees: RwLock::new(HashMap::new()),
        }
    }

    pub fn record_fee(&self, fee_type: FeeType, amount: u128, chain_key: &str) {
        // Update total fees
        {
            let mut fees = self.fees.write().unwrap();
            *fees.entry(fee_type).or_insert(0) += amount;
        }

        // Update chain fees
        {
            let mut chain_fees = self.chain_fees.write().unwrap();
            let chain_fee = chain_fees.entry(chain_key.to_string()).or_insert_with(HashMap::new);
            *chain_fee.entry(fee_type).or_insert(0) += amount;
        }
    }

    pub fn get_total_fees(&self) -> HashMap<FeeType, u128> {
        let fees = self.fees.read().unwrap();
        fees.clone()
    }

    pub fn get_chain_fees(&self, chain_key: &str) -> HashMap<FeeType, u128> {
        let chain_fees = self.chain_fees.read().unwrap();
        chain_fees.get(chain_key).cloned().unwrap_or_default()
    }

    pub fn get_total(&self) -> u128 {
        let fees = self.fees.read().unwrap();
        fees.values().sum()
    }
}

// ==================== Unified Service ====================

pub struct UnifiedService {
    pub wallet: Arc<TigerWalletService>,
    pub dex: Arc<TigerswapService>,
    pub chain: Arc<TigerSmartChainService>,
    pub fees: Arc<FeeCollectorService>,
    chains: RwLock<HashMap<String, ChainConfig>>,
}

impl UnifiedService {
    pub fn new() -> Self {
        Self {
            wallet: Arc::new(TigerWalletService::new()),
            dex: Arc::new(TigerswapService::new()),
            chain: Arc::new(TigerSmartChainService::new()),
            fees: Arc::new(FeeCollectorService::new()),
            chains: RwLock::new(HashMap::new()),
        }
    }

    pub fn initialize(&self) {
        // Initialize default chains
        let default_chains = vec![
            ChainConfig::new(2024, "tigersmartchain", "TigerSmartChain", ChainType::EVM, "TGR", 18),
            ChainConfig::new(1, "ethereum", "Ethereum", ChainType::EVM, "ETH", 18),
            ChainConfig::new(56, "bsc", "BNB Smart Chain", ChainType::EVM, "BNB", 18),
            ChainConfig::new(137, "polygon", "Polygon", ChainType::EVM, "MATIC", 18),
            ChainConfig::new(43114, "avalanche", "Avalanche", ChainType::EVM, "AVAX", 18),
            ChainConfig::new(42161, "arbitrum", "Arbitrum One", ChainType::EVM, "ETH", 18),
            ChainConfig::new(10, "optimism", "Optimism", ChainType::EVM, "ETH", 18),
            ChainConfig::new(8453, "base", "Base", ChainType::EVM, "ETH", 18),
            ChainConfig::new(101, "solana", "Solana", ChainType::Solana, "SOL", 9),
            ChainConfig::new(1313161555, "near", "NEAR Protocol", ChainType::Near, "NEAR", 24),
        ];

        let mut chains = self.chains.write().unwrap();
        for chain in default_chains {
            chains.insert(chain.key.clone(), chain.clone());
            self.wallet.add_chain(chain);
        }

        // Initialize default bridges
        self.chain.create_bridge(
            "tigersmartchain",
            "ethereum",
            100_000_000_000_000_000, // 0.1 TGR
            100_000_000_000_000_000_000, // 100 TGR
            100_000_000_000_000_000, // 0.0001 TGR
            0.1, // 0.1%
            300, // 5 min
        );

        // Initialize default pools
        self.dex.create_pool("TGR", "USDT", "tigersmartchain", 0.003);
        self.dex.create_pool("TGR", "RUSD", "tigersmartchain", 0.003);
        self.dex.create_pool("TGR", "ETH", "tigersmartchain", 0.003);
        self.dex.create_pool("RUSD", "USDT", "tigersmartchain", 0.003);
    }

    pub fn add_chain(&self, config: ChainConfig) {
        let mut chains = self.chains.write().unwrap();
        chains.insert(config.key.clone(), config.clone());
        self.wallet.add_chain(config);
    }

    pub fn get_supported_chains(&self) -> Vec<ChainConfig> {
        let chains = self.chains.read().unwrap();
        chains.values().cloned().collect()
    }
}

// ==================== Helper Functions ====================

fn generate_address() -> String {
    format!("0x{}", random_hex(40))
}

fn generate_public_key() -> String {
    format!("0x04{}", random_hex(128))
}

fn generate_tx_hash() -> String {
    format!("0x{}", random_hex(64))
}

fn random_hex(len: usize) -> String {
    use std::time::SystemTime;
    
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    
    let hex_chars = "0123456789abcdef";
    let mut result = String::with_capacity(len);
    
    for i in 0..len {
        let idx = ((seed + i as u128) % 16) as usize;
        result.push(hex_chars.chars().nth(idx).unwrap());
    }
    
    result
}

// ==================== Main Entry ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_service() {
        let service = UnifiedService::new();
        service.initialize();

        let chains = service.get_supported_chains();
        assert!(chains.len() >= 10);

        let pools = service.dex.get_all_pools();
        assert!(pools.len() >= 4);

        let bridges = service.chain.get_all_bridges();
        assert!(bridges.len() >= 1);
    }

    #[test]
    fn test_swap() {
        let service = UnifiedService::new();
        service.initialize();

        let result = service.dex.swap("TGR", "USDT", 1000000000000000000000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_bridge() {
        let service = UnifiedService::new();
        service.initialize();

        let result = service.chain.initiate_bridge("sender", 1000000000000000000000, "ethereum");
        assert!(result.is_ok());
    }
}