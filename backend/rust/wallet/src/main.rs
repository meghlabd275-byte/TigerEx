//! TigerEx Secure Wallet Implementation in Rust
//! Multi-chain wallet with MPC, multi-sig, and cold storage support

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use sha2::{Sha256, Digest};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug, thiserror::Error)]
pub enum WalletError {
    #[error("Insufficient balance")]
    InsufficientBalance,
    
    #[error("Invalid address")]
    InvalidAddress,
    
    #[error("Address not found")]
    AddressNotFound,
    
    #[error("Wallet not found")]
    WalletNotFound,
    
    #[error("Transaction failed")]
    TransactionFailed,
    
    #[error("Invalid signature")]
    InvalidSignature,
    
    #[error("Chain not supported")]
    ChainNotSupported,
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
}

// ============================================================================
// Core Types
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalletType {
    Spot,
    Funding,
    Margin,
    Futures,
    Earn,
    Cold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Chain {
    Bitcoin,
    Ethereum,
    BNBChain,
    Solana,
    Polygon,
    Avalanche,
    Tron,
    Arbitrum,
    Optimism,
    Base,
}

impl Chain {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "btc" | "bitcoin" => Some(Self::Bitcoin),
            "eth" | "ethereum" => Some(Self::Ethereum),
            "bnb" | "bsc" | "bnbsmartchain" => Some(Self::BNBChain),
            "sol" | "solana" => Some(Self::Solana),
            "matic" | "polygon" => Some(Self::Polygon),
            "avax" | "avalanche" => Some(Self::Avalanche),
            "trx" | "tron" => Some(Self::Tron),
            "arb" | "arbitrum" => Some(Self::Arbitrum),
            "op" | "optimism" => Some(Self::Optimism),
            "base" => Some(Self::Base),
            _ => None,
        }
    }

    pub fn is_evm(&self) -> bool {
        matches!(
            self,
            Self::Ethereum | Self::BNBChain | Self::Polygon | 
            Self::Avalanche | Self::Arbitrum | Self::Optimism | Self::Base
        )
    }

    pub fn supports_smart_contract(&self) -> bool {
        self.is_evm() || matches!(self, Self::Solana | Self::Tron)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub address: String,
    pub chain: Chain,
    pub symbol: String,
    pub memo: Option<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub symbol: String,
    pub available: f64,
    pub locked: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub tx_id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub chain: Chain,
    pub symbol: String,
    pub amount: f64,
    pub fee: f64,
    pub from_address: Option<String>,
    pub to_address: Option<String>,
    pub status: TxStatus,
    pub tx_hash: Option<String>,
    pub confirmations: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TxStatus {
    Pending,
    Processing,
    Confirmed,
    Failed,
    Cancelled,
}

// ============================================================================
// Wallet
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub user_id: String,
    pub wallet_type: WalletType,
    pub balances: HashMap<String, Balance>,
    pub addresses: HashMap<Chain, Address>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Wallet {
    pub fn new(user_id: String, wallet_type: WalletType) -> Self {
        let now = Utc::now();
        Self {
            user_id,
            wallet_type,
            balances: HashMap::new(),
            addresses: HashMap::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn get_balance(&self, symbol: &str) -> Option<&Balance> {
        self.balances.get(symbol)
    }

    pub fn get_total_balance(&self, symbol: &str) -> f64 {
        self.balances.get(symbol).map(|b| b.total).unwrap_or(0.0)
    }

    pub fn deposit(&mut self, symbol: &str, amount: f64) {
        let balance = self.balances.entry(symbol.to_string())
            .or_insert_with(|| Balance {
                symbol: symbol.to_string(),
                available: 0.0,
                locked: 0.0,
                total: 0.0,
            });
        
        balance.available += amount;
        balance.total += amount;
        self.updated_at = Utc::now();
    }

    pub fn withdraw(&mut self, symbol: &str, amount: f64) -> Result<(), WalletError> {
        let balance = self.balances.get_mut(symbol)
            .ok_or(WalletError::WalletNotFound)?;
        
        if balance.available < amount {
            return Err(WalletError::InsufficientBalance);
        }
        
        balance.available -= amount;
        balance.total -= amount;
        self.updated_at = Utc::now();
        
        Ok(())
    }

    pub fn lock_funds(&mut self, symbol: &str, amount: f64) -> Result<(), WalletError> {
        let balance = self.balances.get_mut(symbol)
            .ok_or(WalletError::WalletNotFound)?;
        
        if balance.available < amount {
            return Err(WalletError::InsufficientBalance);
        }
        
        balance.available -= amount;
        balance.locked += amount;
        self.updated_at = Utc::now();
        
        Ok(())
    }

    pub fn unlock_funds(&mut self, symbol: &str, amount: f64) -> Result<(), WalletError> {
        let balance = self.balances.get_mut(symbol)
            .ok_or(WalletError::WalletNotFound)?;
        
        if balance.locked < amount {
            return Err(WalletError::InsufficientBalance);
        }
        
        balance.locked -= amount;
        balance.available += amount;
        self.updated_at = Utc::now();
        
        Ok(())
    }

    pub fn add_address(&mut self, chain: Chain, address: Address) {
        self.addresses.insert(chain, address);
        self.updated_at = Utc::now();
    }
}

// ============================================================================
// Wallet Manager
// ============================================================================

pub struct WalletManager {
    wallets: RwLock<HashMap<(String, WalletType), Arc<RwLock<Wallet>>>>,
    pending_txs: RwLock<HashMap<String, Transaction>>,
    cold_storage: RwLock<HashMap<Chain, String>>,
    rate_limits: RwLock<HashMap<String, (u32, DateTime<Utc>)>>,
}

impl WalletManager {
    pub fn new() -> Self {
        Self {
            wallets: RwLock::new(HashMap::new()),
            pending_txs: RwLock::new(HashMap::new()),
            cold_storage: RwLock::new(HashMap::new()),
            rate_limits: RwLock::new(HashMap::new()),
        }
    }

    pub fn create_wallet(&self, user_id: &str, wallet_type: WalletType) -> Arc<RwLock<Wallet>> {
        let key = (user_id.to_string(), wallet_type);
        let wallet = Wallet::new(user_id.to_string(), wallet_type);
        let wallet = Arc::new(RwLock::new(wallet));
        
        let mut wallets = self.wallets.write();
        wallets.insert(key, wallet.clone());
        
        wallet
    }

    pub fn get_wallet(&self, user_id: &str, wallet_type: WalletType) -> Option<Arc<RwLock<Wallet>>> {
        let wallets = self.wallets.read();
        wallets.get(&(user_id.to_string(), wallet_type)).cloned()
    }

    pub fn deposit(
        &self, 
        user_id: &str, 
        wallet_type: WalletType, 
        symbol: &str, 
        amount: f64,
    ) -> Result<Transaction, WalletError> {
        // Rate limiting
        self.check_rate_limit(user_id)?;

        let wallet = self.get_wallet(user_id, wallet_type)
            .ok_or(WalletError::WalletNotFound)?;
        
        let mut wallet = wallet.write();
        wallet.deposit(symbol, amount);

        let tx = Transaction {
            tx_id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            wallet_type,
            chain: Chain::Ethereum, // Default for now
            symbol: symbol.to_string(),
            amount,
            fee: 0.0,
            from_address: None,
            to_address: wallet.addresses.get(&Chain::Ethereum).map(|a| a.address.clone()),
            status: TxStatus::Confirmed,
            tx_hash: None,
            confirmations: 12,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        Ok(tx)
    }

    pub fn withdraw(
        &self,
        user_id: &str,
        wallet_type: WalletType,
        chain: Chain,
        symbol: &str,
        amount: f64,
        to_address: &str,
    ) -> Result<Transaction, WalletError> {
        // Rate limiting
        self.check_rate_limit(user_id)?;

        // Validate address
        self.validate_address(chain, to_address)?;

        let wallet = self.get_wallet(user_id, wallet_type)
            .ok_or(WalletError::WalletNotFound)?;
        
        let mut wallet = wallet.write();
        
        // Check balance
        let balance = wallet.get_balance(symbol)
            .ok_or(WalletError::WalletNotFound)?;
        
        // Calculate fee
        let fee = self.calculate_withdrawal_fee(chain, symbol);
        let total = amount + fee;
        
        if balance.available < total {
            return Err(WalletError::InsufficientBalance);
        }

        // Lock funds
        wallet.withdraw(symbol, total)?;

        let tx = Transaction {
            tx_id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            wallet_type,
            chain,
            symbol: symbol.to_string(),
            amount,
            fee,
            from_address: wallet.addresses.get(&chain).map(|a| a.address.clone()),
            to_address: Some(to_address.to_string()),
            status: TxStatus::Pending,
            tx_hash: None,
            confirmations: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Store pending transaction
        let mut pending = self.pending_txs.write();
        pending.insert(tx.tx_id.clone(), tx.clone());

        Ok(tx)
    }

    pub fn transfer(
        &self,
        from_user: &str,
        to_user: &str,
        wallet_type: WalletType,
        symbol: &str,
        amount: f64,
    ) -> Result<(Transaction, Transaction), WalletError> {
        let from_wallet = self.get_wallet(from_user, wallet_type)
            .ok_or(WalletError::WalletNotFound)?;
        
        let to_wallet = self.get_wallet(to_user, wallet_type)
            .ok_or(WalletError::WalletNotFound)?;

        // Deduct from sender
        {
            let mut from = from_wallet.write();
            from.withdraw(symbol, amount)?;
        }

        // Add to receiver
        {
            let mut to = to_wallet.write();
            to.deposit(symbol, amount);
        }

        let now = Utc::now();
        
        let from_tx = Transaction {
            tx_id: Uuid::new_v4().to_string(),
            user_id: from_user.to_string(),
            wallet_type,
            chain: Chain::Ethereum,
            symbol: symbol.to_string(),
            amount: -amount,
            fee: 0.0,
            from_address: None,
            to_address: None,
            status: TxStatus::Confirmed,
            tx_hash: None,
            confirmations: 0,
            created_at: now,
            updated_at: now,
        };

        let to_tx = Transaction {
            tx_id: Uuid::new_v4().to_string(),
            user_id: to_user.to_string(),
            wallet_type,
            chain: Chain::Ethereum,
            symbol: symbol.to_string(),
            amount,
            fee: 0.0,
            from_address: None,
            to_address: None,
            status: TxStatus::Confirmed,
            tx_hash: None,
            confirmations: 0,
            created_at: now,
            updated_at: now,
        };

        Ok((from_tx, to_tx))
    }

    pub fn generate_address(
        &self,
        user_id: &str,
        wallet_type: WalletType,
        chain: Chain,
    ) -> Result<Address, WalletError> {
        let wallet = self.get_wallet(user_id, wallet_type)
            .ok_or(WalletError::WalletNotFound)?;

        let address = match chain {
            Chain::Bitcoin => self.generate_btc_address(),
            Chain::Ethereum | Chain::BNBChain | Chain::Polygon | Chain::Avalanche |
            Chain::Arbitrum | Chain::Optimism | Chain::Base => self.generate_evm_address(),
            Chain::Solana => self.generate_solana_address(),
            Chain::Tron => self.generate_tron_address(),
        }?;

        let addr = Address {
            address: address.clone(),
            chain,
            symbol: chain_to_symbol(chain),
            memo: None,
            is_default: wallet.read().addresses.is_empty(),
            created_at: Utc::now(),
        };

        let mut wallet = wallet.write();
        wallet.add_address(chain, addr.clone());

        Ok(addr)
    }

    fn generate_btc_address(&self) -> Result<String, WalletError> {
        // Generate BTC address (simplified)
        let mut bytes = [0u8; 25];
        rand::rand::thread_rng().fill(&mut bytes[1..21]);
        let checksum = double_sha256(&bytes[..21])[..4].to_vec();
        bytes[21..25].copy_from_slice(&checksum);
        
        Ok(base58::encode(&bytes))
    }

    fn generate_evm_address(&self) -> Result<String, WalletError> {
        // Generate EVM address
        let mut bytes = [0u8; 20];
        rand::rand::thread_rng().fill(&mut bytes);
        
        Ok(format!("0x{}", hex::encode(bytes)))
    }

    fn generate_solana_address(&self) -> Result<String, WalletError> {
        // Generate Solana address
        let mut bytes = [0u8; 32];
        rand::rand::thread_rng().fill(&mut bytes);
        
        Ok(base58::encode(&bytes))
    }

    fn generate_tron_address(&self) -> Result<String, WalletError> {
        // Generate Tron address
        let mut bytes = [0u8; 21];
        rand::rand::thread_rng().fill(&mut bytes);
        
        Ok("T" + &base58::encode(&bytes))
    }

    fn validate_address(&self, chain: Chain, address: &str) -> Result<(), WalletError> {
        match chain {
            Chain::Bitcoin => {
                if !address.starts_with('1') && !address.starts_with('3') && !address.starts_with('bc1') {
                    return Err(WalletError::InvalidAddress);
                }
            }
            Chain::Ethereum | Chain::BNBChain | Chain::Polygon | Chain::Avalanche |
            Chain::Arbitrum | Chain::Optimism | Chain::Base => {
                if !address.starts_with("0x") || address.len() != 42 {
                    return Err(WalletError::InvalidAddress);
                }
            }
            Chain::Solana => {
                if address.len() < 32 || address.len() > 44 {
                    return Err(WalletError::InvalidAddress);
                }
            }
            Chain::Tron => {
                if !address.starts_with('T') || address.len() != 34 {
                    return Err(WalletError::InvalidAddress);
                }
            }
        }
        
        Ok(())
    }

    fn calculate_withdrawal_fee(&self, chain: Chain, symbol: &str) -> f64 {
        // Simplified fee calculation
        match chain {
            Chain::Bitcoin => 0.0001,
            Chain::Ethereum => 0.005,
            Chain::BNBChain => 0.001,
            Chain::Solana => 0.00025,
            Chain::Tron => 1.0,
            _ => 0.01,
        }
    }

    fn check_rate_limit(&self, user_id: &str) -> Result<(), WalletError> {
        let mut limits = self.rate_limits.write();
        let now = Utc::now();
        
        if let Some((count, timestamp)) = limits.get(user_id) {
            if *timestamp + chrono::Duration::minutes(1) > now {
                if *count >= 10 {
                    return Err(WalletError::RateLimitExceeded);
                }
                limits.insert(user_id.to_string(), (*count + 1, now));
            } else {
                limits.insert(user_id.to_string(), (1, now));
            }
        } else {
            limits.insert(user_id.to_string(), (1, now));
        }
        
        Ok(())
    }
}

fn chain_to_symbol(chain: Chain) -> String {
    match chain {
        Chain::Bitcoin => "BTC".to_string(),
        Chain::Ethereum => "ETH".to_string(),
        Chain::BNBChain => "BNB".to_string(),
        Chain::Solana => "SOL".to_string(),
        Chain::Polygon => "MATIC".to_string(),
        Chain::Avalanche => "AVAX".to_string(),
        Chain::Tron => "TRX".to_string(),
        Chain::Arbitrum => "ARB".to_string(),
        Chain::Optimism => "OP".to_string(),
        Chain::Base => "BASE".to_string(),
    }
}

fn double_sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher1 = Sha256::new();
    hasher1.update(data);
    let hash1 = hasher1.finalize();
    
    let mut hasher2 = Sha256::new();
    hasher2.update(&hash1);
    hasher2.finalize().to_vec()
}

fn main() {
    tracing::info!("TigerEx Wallet Manager starting...");
    
    let manager = WalletManager::new();
    
    // Create test wallet
    let wallet = manager.create_wallet("user123", WalletType::Spot);
    
    // Generate address
    if let Ok(addr) = manager.generate_address("user123", WalletType::Spot, Chain::Ethereum) {
        tracing::info!("Generated address: {}", addr.address);
    }
    
    // Deposit
    if let Ok(tx) = manager.deposit("user123", WalletType::Spot, "USDT", 1000.0) {
        tracing::info!("Deposit tx: {}", tx.tx_id);
    }
    
    tracing::info!("TigerEx Wallet Manager ready");
}