// Wallet Core - Secure Wallet Infrastructure
// Rust for memory-safe wallet operations
// Production-ready wallet management with multi-signature support

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};

// Wallet type with tier classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalletType {
    Hot,      // Online - for daily trading
    Warm,     // Semi-online - for larger operations  
    Cold,     // Offline - for storage
    Vault,    // Multi-sig - for large holdings
}

impl Default for WalletType {
    fn default() -> Self {
        WalletType::Hot
    }
}

// Wallet status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalletStatus {
    Active,
    Frozen,
    Disabled,
    PendingActivation,
}

impl Default for WalletStatus {
    fn default() -> Self {
        WalletStatus::PendingActivation
    }
}

// Supported assets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetInfo {
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub min_withdraw: f64,
    pub min_deposit: f64,
    pub withdraw_fee: f64,
    pub is_enabled: bool,
}

// Wallet with full details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub status: WalletStatus,
    pub addresses: HashMap<String, String>, // chain -> address
    pub created_at: u64,
    pub updated_at: u64,
    pub last_activity: u64,
    pub nonce: u64, // For anti-replay
}

impl Wallet {
    pub fn new(user_id: &str, wallet_type: WalletType) -> Self {
        let now = timestamp_ms();
        Wallet {
            id: generate_id("wallet"),
            user_id: user_id.to_string(),
            wallet_type,
            status: WalletStatus::PendingActivation,
            addresses: HashMap::new(),
            created_at: now,
            updated_at: now,
            last_activity: now,
            nonce: 0,
        }
    }

    pub fn activate(&mut self) {
        self.status = WalletStatus::Active;
        self.updated_at = timestamp_ms();
    }

    pub fn freeze(&mut self) {
        self.status = WalletStatus::Frozen;
        self.updated_at = timestamp_ms();
    }

    pub fn add_address(&mut self, chain: &str, address: &str) {
        self.addresses.insert(chain.to_string(), address.to_string());
        self.nonce += 1;
        self.updated_at = timestamp_ms();
    }
}

// Balance with precision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub symbol: String,
    pub available: f64,
    pub locked: f64,
    pub total: f64,
}

impl Balance {
    pub fn new(symbol: &str) -> Self {
        Balance {
            symbol: symbol.to_string(),
            available: 0.0,
            locked: 0.0,
            total: 0.0,
        }
    }

    pub fn credit(&mut self, amount: f64) {
        self.available += amount;
        self.total += amount;
    }

    pub fn debit(&mut self, amount: f64) {
        self.available = (self.available - amount).max(0.0);
        self.total = (self.total - amount).max(0.0);
    }

    pub fn lock(&mut self, amount: f64) -> bool {
        if self.available < amount {
            return false;
        }
        self.available -= amount;
        self.locked += amount;
        true
    }

    pub fn unlock(&mut self, amount: f64) {
        self.locked = (self.locked - amount).max(0.0);
        self.available += amount;
    }
}

// Transaction types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    Transfer,
    Trade,
    Fee,
    Adjustment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

// Transaction record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub wallet_id: String,
    pub tx_type: TransactionType,
    pub symbol: String,
    pub amount: f64,
    pub fee: f64,
    pub to_address: Option<String>,
    pub from_address: Option<String>,
    pub status: TransactionStatus,
    pub tx_hash: Option<String>,
    pub confirmations: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub executed_at: Option<u64>,
}

impl Transaction {
    pub fn new_deposit(wallet_id: &str, symbol: &str, amount: f64, from_address: &str) -> Self {
        let now = timestamp_ms();
        Transaction {
            id: generate_id("tx"),
            wallet_id: wallet_id.to_string(),
            tx_type: TransactionType::Deposit,
            symbol: symbol.to_string(),
            amount,
            fee: 0.0,
            to_address: None,
            from_address: Some(from_address.to_string()),
            status: TransactionStatus::Pending,
            tx_hash: None,
            confirmations: 0,
            created_at: now,
            updated_at: now,
            executed_at: None,
        }
    }

    pub fn new_withdrawal(wallet_id: &str, symbol: &str, amount: f64, fee: f64, to_address: &str) -> Self {
        let now = timestamp_ms();
        Transaction {
            id: generate_id("tx"),
            wallet_id: wallet_id.to_string(),
            tx_type: TransactionType::Withdrawal,
            symbol: symbol.to_string(),
            amount,
            fee,
            to_address: Some(to_address.to_string()),
            from_address: None,
            status: TransactionStatus::Pending,
            tx_hash: None,
            confirmations: 0,
            created_at: now,
            updated_at: now,
            executed_at: None,
        }
    }

    pub fn complete(&mut self, tx_hash: &str) {
        self.status = TransactionStatus::Completed;
        self.tx_hash = Some(tx_hash.to_string());
        self.executed_at = Some(timestamp_ms());
        self.updated_at = timestamp_ms();
    }

    pub fn fail(&mut self) {
        self.status = TransactionStatus::Failed;
        self.updated_at = timestamp_ms();
    }
}

// Thread-safe wallet manager
pub struct WalletManager {
    wallets: HashMap<String, Wallet>,
    balances: HashMap<String, HashMap<String, Balance>>,
    transactions: HashMap<String, Vec<Transaction>>,
    assets: HashMap<String, AssetInfo>,
}

impl WalletManager {
    pub fn new() -> Self {
        let mut mgr = WalletManager {
            wallets: HashMap::new(),
            balances: HashMap::new(),
            transactions: HashMap::new(),
            assets: HashMap::new(),
        };
        
        // Initialize supported assets
        mgr.init_assets();
        
        mgr
    }

    fn init_assets(&mut self) {
        let assets = vec![
            ("BTC", "Bitcoin", 8, 0.0001, 0.0001, 0.0001),
            ("ETH", "Ethereum", 18, 0.001, 0.01, 0.005),
            ("USDT", "Tether", 6, 1.0, 1.0, 1.0),
            ("BNB", "Binance Coin", 8, 0.01, 0.1, 0.05),
            ("SOL", "Solana", 9, 0.01, 0.1, 0.025),
        ];
        
        for (symbol, name, decimals, min_withdraw, min_deposit, fee) in assets {
            self.assets.insert(symbol.to_string(), AssetInfo {
                symbol: symbol.to_string(),
                name: name.to_string(),
                decimals,
                min_withdraw,
                min_deposit,
                withdraw_fee: fee,
                is_enabled: true,
            });
        }
    }

    // Create wallet for user
    pub fn create_wallet(&mut self, user_id: &str, wallet_type: WalletType) -> Result<String, String> {
        let wallet = Wallet::new(user_id, wallet_type);
        let id = wallet.id.clone();
        
        self.wallets.insert(id.clone(), wallet);
        self.balances.insert(id.clone(), HashMap::new());
        self.transactions.insert(id.clone(), Vec::new());
        
        Ok(id)
    }

    // Get wallet
    pub fn get_wallet(&self, wallet_id: &str) -> Option<&Wallet> {
        self.wallets.get(wallet_id)
    }

    // Activate wallet
    pub fn activate_wallet(&mut self, wallet_id: &str) -> Result<(), String> {
        if let Some(wallet) = self.wallets.get_mut(wallet_id) {
            wallet.activate();
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Add address to wallet
    pub fn add_address(&mut self, wallet_id: &str, chain: &str, address: &str) -> Result<(), String> {
        if let Some(wallet) = self.wallets.get_mut(wallet_id) {
            if wallet.status != WalletStatus::Active {
                return Err("wallet not active".to_string());
            }
            wallet.add_address(chain, address);
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Credit balance (deposit)
    pub fn credit(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<Transaction, String> {
        // Validate amount
        if amount <= 0.0 {
            return Err("invalid amount".to_string());
        }
        
        // Get asset info
        if !self.assets.contains_key(symbol) {
            return Err("unsupported asset".to_string());
        }
        
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance::new(symbol));
            balance.credit(amount);
            
            // Create transaction
            let tx = Transaction::new_deposit(wallet_id, symbol, amount, "external");
            let tx_clone = tx.clone();
            self.transactions.get_mut(wallet_id).unwrap().push(tx);
            
            return Ok(tx_clone);
        }
        
        Err("wallet not found".to_string())
    }

    // Debit balance (withdrawal request)
    pub fn debit(&mut self, wallet_id: &str, symbol: &str, amount: f64, to_address: &str) -> Result<Transaction, String> {
        // Get asset info
        let asset = self.assets.get(symbol)
            .ok_or_else(|| "unsupported asset".to_string())?;
        
        if !asset.is_enabled {
            return Err("asset not enabled".to_string());
        }
        
        if amount < asset.min_withdraw {
            return Err("below minimum withdrawal".to_string());
        }
        
        let total_required = amount + asset.withdraw_fee;
        
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance::new(symbol));
            
            if balance.available < total_required {
                return Err("insufficient balance".to_string());
            }
            
            // Lock funds
            balance.debit(total_required);
            
            // Create transaction
            let tx = Transaction::new_withdrawal(
                wallet_id, symbol, amount, asset.withdraw_fee, to_address
            );
            let tx_clone = tx.clone();
            self.transactions.get_mut(wallet_id).unwrap().push(tx);
            
            return Ok(tx_clone);
        }
        
        Err("wallet not found".to_string())
    }

    // Get balance
    pub fn get_balance(&self, wallet_id: &str, symbol: &str) -> Option<&Balance> {
        self.balances.get(wallet_id).and_then(|b| b.get(symbol))
    }

    // Get all balances
    pub fn get_balances(&self, wallet_id: &str) -> HashMap<String, Balance> {
        self.balances.get(wallet_id)
            .map(|b| b.clone())
            .unwrap_or_default()
    }

    // Get transactions
    pub fn get_transactions(&self, wallet_id: &str) -> Vec<&Transaction> {
        self.transactions.get(wallet_id)
            .map(|t| t.iter().collect())
            .unwrap_or_default()
    }

    // Get supported assets
    pub fn get_assets(&self) -> &HashMap<String, AssetInfo> {
        &self.assets
    }

    // Lock balance for trading
    pub fn lock(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance::new(symbol));
            if balance.lock(amount) {
                return Ok(());
            }
            return Err("insufficient available balance".to_string());
        }
        Err("wallet not found".to_string())
    }

    // Unlock balance
    pub fn unlock(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            if let Some(balance) = balances.get_mut(symbol) {
                balance.unlock(amount);
                return Ok(());
            }
        }
        Err("balance not found".to_string())
    }

    // Internal transfer
    pub fn internal_transfer(
        &mut self, 
        from_wallet: &str, 
        to_wallet: &str, 
        symbol: &str, 
        amount: f64
    ) -> Result<String, String> {
        // Debit from sender
        {
            if let Some(balances) = self.balances.get_mut(from_wallet) {
                let balance = balances.entry(symbol.to_string()).or_insert(Balance::new(symbol));
                if balance.available < amount {
                    return Err("insufficient balance".to_string());
                }
                balance.debit(amount);
            } else {
                return Err("sender wallet not found".to_string());
            }
        }
        
        // Credit to receiver
        {
            if let Some(balances) = self.balances.get_mut(to_wallet) {
                let balance = balances.entry(symbol.to_string()).or_insert(Balance::new(symbol));
                balance.credit(amount);
            } else {
                return Err("receiver wallet not found".to_string());
            }
        }
        
        Ok(format!("transfer_{}", rand_id()))
    }
}

// Helper functions
fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    format!("{}_{}_{}", prefix, timestamp_ms(), rand_id())
}

fn rand_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    std::iter::repeat_with(|| {
        let idx = rng.gen_range(0..36);
        "abcdefghijklmnopqrstuvwxyz0123456789".chars().nth(idx).unwrap()
    })
    .take(16)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet_creation() {
        let mut mgr = WalletManager::new();
        
        let wallet_id = mgr.create_wallet("user1", WalletType::Hot).unwrap();
        mgr.activate_wallet(&wallet_id).unwrap();
        
        assert!(mgr.get_wallet(&wallet_id).is_some());
    }

    #[test]
    fn test_credit_debit() {
        let mut mgr = WalletManager::new();
        
        let wallet_id = mgr.create_wallet("user1", WalletType::Hot).unwrap();
        mgr.activate_wallet(&wallet_id).unwrap();
        
        // Credit
        let tx = mgr.credit(&wallet_id, "BTC", 1.5).unwrap();
        assert_eq!(tx.amount, 1.5);
        
        // Check balance
        let bal = mgr.get_balance(&wallet_id, "BTC").unwrap();
        assert_eq!(bal.total, 1.5);
        assert_eq!(bal.available, 1.5);
    }

    #[test]
    fn test_withdrawal() {
        let mut mgr = WalletManager::new();
        
        let wallet_id = mgr.create_wallet("user1", WalletType::Cold).unwrap();
        mgr.activate_wallet(&wallet_id).unwrap();
        
        // Credit first
        mgr.credit(&wallet_id, "USDT", 1000.0).unwrap();
        
        // Request withdrawal
        let tx = mgr.debit(&wallet_id, "USDT", 500.0, "0x1234...");
        assert!(tx.is_ok());
    }
}