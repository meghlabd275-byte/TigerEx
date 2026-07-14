//! TigerEx Wallet Service
//! Secure wallet management for deposits, withdrawals, and balances

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use thiserror::Error;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum WalletError {
    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    #[error("Address not found: {0}")]
    AddressNotFound(String),
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),
    #[error("Wallet not found: {0}")]
    WalletNotFound(String),
    #[error("Operation failed: {0}")]
    OperationFailed(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Transaction not found: {0}")]
    TransactionNotFound(String),
}

impl Serialize for WalletError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Asset represents a cryptocurrency
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub symbol: String,
    pub name: String,
    pub network: String,
    pub decimals: u8,
    pub is_native: bool,
    pub contract_address: Option<String>,
    pub min_deposit: f64,
    pub min_withdrawal: f64,
    pub withdrawal_fee: f64,
}

/// Wallet represents a user's wallet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub balance: f64,
    pub locked_balance: f64,
    pub address: Option<String>,
    pub memo: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Deposit represents a deposit transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deposit {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub address: String,
    pub tx_hash: String,
    pub confirmations: u32,
    pub required_confirmations: u32,
    pub status: TransactionStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Withdrawal represents a withdrawal transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Withdrawal {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub net_amount: f64,
    pub address: String,
    pub memo: Option<String>,
    pub tx_hash: Option<String>,
    pub status: TransactionStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Transaction status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

/// Transfer represents an internal transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transfer {
    pub id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub asset: String,
    pub amount: f64,
    pub status: TransactionStatus,
    pub created_at: i64,
}

/// Balance represents user balance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub asset: String,
    pub free: f64,
    pub locked: f64,
    pub total: f64,
}

// ============================================================================
// WALLET MANAGER
// ============================================================================

/// WalletManager manages all wallets
pub struct WalletManager {
    wallets: HashMap<String, Wallet>,
    user_wallets: HashMap<String, Vec<String>>,
    deposits: HashMap<String, Deposit>,
    withdrawals: HashMap<String, Withdrawal>,
    transfers: HashMap<String, Transfer>,
    addresses: HashMap<String, String>, // address -> wallet_id
    assets: HashMap<String, Asset>,
}

impl WalletManager {
    pub fn new() -> Self {
        let mut manager = Self {
            wallets: HashMap::new(),
            user_wallets: HashMap::new(),
            deposits: HashMap::new(),
            withdrawals: HashMap::new(),
            transfers: HashMap::new(),
            addresses: HashMap::new(),
            assets: HashMap::new(),
        };
        manager.initialize_assets();
        manager
    }

    fn initialize_assets(&mut self) {
        let assets = vec![
            Asset {
                symbol: "BTC".to_string(),
                name: "Bitcoin".to_string(),
                network: "Bitcoin".to_string(),
                decimals: 8,
                is_native: true,
                contract_address: None,
                min_deposit: 0.0001,
                min_withdrawal: 0.0001,
                withdrawal_fee: 0.0005,
            },
            Asset {
                symbol: "ETH".to_string(),
                name: "Ethereum".to_string(),
                network: "Ethereum".to_string(),
                decimals: 18,
                is_native: true,
                contract_address: None,
                min_deposit: 0.001,
                min_withdrawal: 0.001,
                withdrawal_fee: 0.005,
            },
            Asset {
                symbol: "USDT".to_string(),
                name: "Tether USD".to_string(),
                network: "Ethereum".to_string(),
                decimals: 6,
                is_native: false,
                contract_address: Some("0xdAC17F958D2ee523a2206206994597C13D831ec7".to_string()),
                min_deposit: 10.0,
                min_withdrawal: 10.0,
                withdrawal_fee: 1.0,
            },
            Asset {
                symbol: "BNB".to_string(),
                name: "Binance Coin".to_string(),
                network: "BNB Chain".to_string(),
                decimals: 18,
                is_native: true,
                contract_address: None,
                min_deposit: 0.01,
                min_withdrawal: 0.01,
                withdrawal_fee: 0.005,
            },
            Asset {
                symbol: "TGR".to_string(),
                name: "TigerEx Token".to_string(),
                network: "TigerEx".to_string(),
                decimals: 18,
                is_native: true,
                contract_address: None,
                min_deposit: 1.0,
                min_withdrawal: 1.0,
                withdrawal_fee: 0.1,
            },
        ];

        for asset in assets {
            self.assets.insert(asset.symbol.clone(), asset);
        }
    }

    /// Create a wallet for a user
    pub fn create_wallet(&mut self, user_id: String, asset: String) -> Result<Wallet, WalletError> {
        let wallet_id = format!("{}_{}", user_id, asset);

        if self.wallets.contains_key(&wallet_id) {
            return Err(WalletError::OperationFailed("Wallet already exists".to_string()));
        }

        let now = chrono::Utc::now().timestamp();
        let wallet = Wallet {
            id: wallet_id.clone(),
            user_id: user_id.clone(),
            asset: asset.clone(),
            balance: 0.0,
            locked_balance: 0.0,
            address: None,
            memo: None,
            created_at: now,
            updated_at: now,
        };

        self.wallets.insert(wallet_id.clone(), wallet.clone());
        
        // Add to user wallets
        self.user_wallets
            .entry(user_id)
            .or_insert_with(Vec::new)
            .push(wallet_id);

        Ok(wallet)
    }

    /// Get wallet by ID
    pub fn get_wallet(&self, wallet_id: &str) -> Result<Wallet, WalletError> {
        self.wallets
            .get(wallet_id)
            .cloned()
            .ok_or_else(|| WalletError::WalletNotFound(wallet_id.to_string()))
    }

    /// Get user wallets
    pub fn get_user_wallets(&self, user_id: &str) -> Vec<Wallet> {
        self.user_wallets
            .get(user_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.wallets.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get user balance for an asset
    pub fn get_balance(&self, user_id: &str, asset: &str) -> Result<Balance, WalletError> {
        let wallet_id = format!("{}_{}", user_id, asset);
        let wallet = self.get_wallet(&wallet_id)?;

        Ok(Balance {
            asset: asset.to_string(),
            free: wallet.balance,
            locked: wallet.locked_balance,
            total: wallet.balance + wallet.locked_balance,
        })
    }

    /// Get all user balances
    pub fn get_balances(&self, user_id: &str) -> Vec<Balance> {
        self.get_user_wallets(user_id)
            .into_iter()
            .map(|w| Balance {
                asset: w.asset,
                free: w.balance,
                locked: w.locked_balance,
                total: w.balance + w.locked_balance,
            })
            .collect()
    }

    /// Deposit funds
    pub fn deposit(&mut self, user_id: &str, asset: &str, amount: f64) -> Result<Deposit, WalletError> {
        if amount <= 0.0 {
            return Err(WalletError::InvalidAmount("Amount must be positive".to_string()));
        }

        let wallet_id = format!("{}_{}", user_id, asset);
        let wallet = self.wallets.get_mut(&wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(wallet_id.clone()))?;

        // Update balance
        wallet.balance += amount;
        wallet.updated_at = chrono::Utc::now().timestamp();

        // Create deposit record
        let now = chrono::Utc::now().timestamp();
        let deposit = Deposit {
            id: format!("DEP{}_{}", now, rand_id(8)),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            address: wallet.address.clone().unwrap_or_default(),
            tx_hash: format!("0x{}", rand_id(64)),
            confirmations: 0,
            required_confirmations: 6,
            status: TransactionStatus::Completed,
            created_at: now,
            updated_at: now,
        };

        self.deposits.insert(deposit.id.clone(), deposit.clone());
        
        Ok(deposit)
    }

    /// Withdraw funds
    pub fn withdraw(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: f64,
        address: &str,
    ) -> Result<Withdrawal, WalletError> {
        if amount <= 0.0 {
            return Err(WalletError::InvalidAmount("Amount must be positive".to_string()));
        }

        // Validate address format
        self.validate_address(asset, address)?;

        let wallet_id = format!("{}_{}", user_id, asset);
        let wallet = self.wallets.get_mut(&wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(wallet_id.clone()))?;

        // Check balance
        let asset_info = self.assets.get(asset)
            .ok_or_else(|| WalletError::InvalidAddress("Asset not supported".to_string()))?;

        if amount < asset_info.min_withdrawal {
            return Err(WalletError::InvalidAmount(format!(
                "Minimum withdrawal is {}",
                asset_info.min_withdrawal
            )));
        }

        let total_needed = amount + asset_info.withdrawal_fee;
        if wallet.balance < total_needed {
            return Err(WalletError::InsufficientBalance(format!(
                "Insufficient balance. Available: {}, Required: {}",
                wallet.balance, total_needed
            )));
        }

        // Deduct balance
        wallet.balance -= total_needed;
        wallet.updated_at = chrono::Utc::now().timestamp();

        // Create withdrawal record
        let now = chrono::Utc::now().timestamp();
        let withdrawal = Withdrawal {
            id: format!("WDR{}_{}", now, rand_id(8)),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            fee: asset_info.withdrawal_fee,
            net_amount: amount - asset_info.withdrawal_fee,
            address: address.to_string(),
            memo: None,
            tx_hash: None,
            status: TransactionStatus::Pending,
            created_at: now,
            updated_at: now,
        };

        self.withdrawals.insert(withdrawal.id.clone(), withdrawal.clone());

        Ok(withdrawal)
    }

    /// Lock funds (for orders)
    pub fn lock_funds(&mut self, user_id: &str, asset: &str, amount: f64) -> Result<(), WalletError> {
        if amount <= 0.0 {
            return Err(WalletError::InvalidAmount("Amount must be positive".to_string()));
        }

        let wallet_id = format!("{}_{}", user_id, asset);
        let wallet = self.wallets.get_mut(&wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(wallet_id.clone()))?;

        if wallet.balance < amount {
            return Err(WalletError::InsufficientBalance("Insufficient available balance".to_string()));
        }

        wallet.balance -= amount;
        wallet.locked_balance += amount;
        wallet.updated_at = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Unlock funds
    pub fn unlock_funds(&mut self, user_id: &str, asset: &str, amount: f64) -> Result<(), WalletError> {
        if amount <= 0.0 {
            return Err(WalletError::InvalidAmount("Amount must be positive".to_string()));
        }

        let wallet_id = format!("{}_{}", user_id, asset);
        let wallet = self.wallets.get_mut(&wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(wallet_id.clone()))?;

        if wallet.locked_balance < amount {
            return Err(WalletError::InsufficientBalance("Insufficient locked balance".to_string()));
        }

        wallet.locked_balance -= amount;
        wallet.balance += amount;
        wallet.updated_at = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Internal transfer between users
    pub fn transfer(
        &mut self,
        from_user_id: &str,
        to_user_id: &str,
        asset: &str,
        amount: f64,
    ) -> Result<Transfer, WalletError> {
        if amount <= 0.0 {
            return Err(WalletError::InvalidAmount("Amount must be positive".to_string()));
        }

        // Deduct from sender
        let from_wallet_id = format!("{}_{}", from_user_id, asset);
        let from_wallet = self.wallets.get_mut(&from_wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(from_wallet_id.clone()))?;

        if from_wallet.balance < amount {
            return Err(WalletError::InsufficientBalance("Insufficient balance".to_string()));
        }

        from_wallet.balance -= amount;
        from_wallet.updated_at = chrono::Utc::now().timestamp();

        // Add to receiver
        let to_wallet_id = format!("{}_{}", to_user_id, asset);
        let to_wallet = self.wallets.get_mut(&to_wallet_id)
            .ok_or_else(|| WalletError::WalletNotFound(to_wallet_id.clone()))?;

        to_wallet.balance += amount;
        to_wallet.updated_at = chrono::Utc::now().timestamp();

        // Create transfer record
        let now = chrono::Utc::now().timestamp();
        let transfer = Transfer {
            id: format!("TRF{}_{}", now, rand_id(8)),
            from_user_id: from_user_id.to_string(),
            to_user_id: to_user_id.to_string(),
            asset: asset.to_string(),
            amount,
            status: TransactionStatus::Completed,
            created_at: now,
        };

        self.transfers.insert(transfer.id.clone(), transfer.clone());

        Ok(transfer)
    }

    /// Validate address
    pub fn validate_address(&self, asset: &str, address: &str) -> Result<(), WalletError> {
        let asset_info = self.assets.get(asset)
            .ok_or_else(|| WalletError::InvalidAddress("Asset not supported".to_string()))?;

        if address.is_empty() {
            return Err(WalletError::InvalidAddress("Address cannot be empty".to_string()));
        }

        // Basic validation based on network
        match asset_info.network.as_str() {
            "Bitcoin" => {
                if !(address.starts_with("1") || address.starts_with("3") || address.starts_with("bc1")) {
                    return Err(WalletError::InvalidAddress("Invalid Bitcoin address".to_string()));
                }
            }
            "Ethereum" => {
                if !address.starts_with("0x") || address.len() != 42 {
                    return Err(WalletError::InvalidAddress("Invalid Ethereum address".to_string()));
                }
            }
            _ => {}
        }

        Ok(())
    }

    /// Get deposit history
    pub fn get_deposits(&self, user_id: &str) -> Vec<Deposit> {
        self.deposits
            .values()
            .filter(|d| d.user_id == user_id)
            .cloned()
            .collect()
    }

    /// Get withdrawal history
    pub fn get_withdrawals(&self, user_id: &str) -> Vec<Withdrawal> {
        self.withdrawals
            .values()
            .filter(|w| w.user_id == user_id)
            .cloned()
            .collect()
    }

    /// Get supported assets
    pub fn get_assets(&self) -> Vec<Asset> {
        self.assets.values().cloned().collect()
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn rand_id(length: usize) -> String {
    use std::iter;
    const CHARSET: &[u8] = b"0123456789abcdef";
    let mut rng = rand::thread_rng();
    let rng = &mut rng;
    
    iter::repeat_with(|| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .take(length)
        .collect()
}

// ============================================================================
// TYPE ALIASES
// ============================================================================

pub type WalletResult<T> = Result<T, WalletError>;
