//! TigerEx Wallet Service - Rust Implementation
//! 
//! Production-grade wallet system with deposits, withdrawals, and transfers

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalletType {
    Spot,
    Margin,
    Futures,
    Earn,
    Fee,
    Collateral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    Transfer,
    Trade,
    Fee,
    Reward,
    Staking,
    Earn,
    Referral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub asset: String,
    pub balance: f64,
    pub locked_balance: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub user_id: String,
    pub wallet_id: String,
    pub tx_type: TransactionType,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub status: TransactionStatus,
    pub tx_hash: Option<String>,
    pub address: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub address: String,
    pub network: String,
    pub fee: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositAddress {
    pub asset: String,
    pub address: String,
    pub network: String,
    pub memo: Option<String>,
    pub qr_code: String,
}

pub struct WalletService {
    wallets: HashMap<String, Wallet>,
    transactions: HashMap<String, Transaction>,
    wallet_id_counter: u64,
    tx_id_counter: u64,
}

impl WalletService {
    pub fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
            wallet_id_counter: 0,
            tx_id_counter: 0,
        }
    }

    /// Initialize user wallets
    pub fn initialize_wallets(&mut self, user_id: &str, assets: &[&str]) -> Vec<Wallet> {
        let mut result = Vec::new();
        
        // Create spot wallets for each asset
        for asset in assets {
            if let Some(wallet) = self.create_wallet(user_id, WalletType::Spot, asset) {
                result.push(wallet);
            }
        }
        
        // Create special wallets
        if let Some(w) = self.create_wallet(user_id, WalletType::Margin, "USDT") { result.push(w); }
        if let Some(w) = self.create_wallet(user_id, WalletType::Futures, "USDT") { result.push(w); }
        if let Some(w) = self.create_wallet(user_id, WalletType::Earn, "USDT") { result.push(w); }
        if let Some(w) = self.create_wallet(user_id, WalletType::Fee, "USDT") { result.push(w); }
        
        result
    }

    fn create_wallet(&mut self, user_id: &str, wallet_type: WalletType, asset: &str) -> Option<Wallet> {
        self.wallet_id_counter += 1;
        let now = current_timestamp_ms();
        
        let wallet = Wallet {
            id: format!("WAL-{}", self.wallet_id_counter),
            user_id: user_id.to_string(),
            wallet_type,
            asset: asset.to_string(),
            balance: 0.0,
            locked_balance: 0.0,
            updated_at: now,
        };
        
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        self.wallets.insert(key, wallet.clone());
        Some(wallet)
    }

    /// Get wallet
    pub fn get_wallet(&self, user_id: &str, wallet_type: WalletType, asset: &str) -> Option<&Wallet> {
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        self.wallets.get(&key)
    }

    /// Get all user wallets
    pub fn get_user_wallets(&self, user_id: &str) -> Vec<&Wallet> {
        self.wallets.values()
            .filter(|w| w.user_id == user_id)
            .collect()
    }

    /// Get balance
    pub fn get_balance(&self, user_id: &str, wallet_type: WalletType, asset: &str) -> f64 {
        self.get_wallet(user_id, wallet_type, asset)
            .map(|w| w.balance)
            .unwrap_or(0.0)
    }

    /// Get available balance (total - locked)
    pub fn get_available_balance(&self, user_id: &str, wallet_type: WalletType, asset: &str) -> f64 {
        self.get_wallet(user_id, wallet_type, asset)
            .map(|w| w.balance - w.locked_balance)
            .unwrap_or(0.0)
    }

    /// Credit balance
    pub fn credit(&mut self, user_id: &str, wallet_type: WalletType, asset: &str, 
                 amount: f64, tx_type: TransactionType) -> Option<Transaction> {
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        let wallet = self.wallets.get_mut(&key)?;
        
        wallet.balance += amount;
        wallet.updated_at = current_timestamp_ms();
        
        // Create transaction
        self.tx_id_counter += 1;
        let tx = Transaction {
            id: format!("TX-{}", self.tx_id_counter),
            user_id: user_id.to_string(),
            wallet_id: wallet.id.clone(),
            tx_type,
            asset: asset.to_string(),
            amount,
            fee: 0.0,
            status: TransactionStatus::Completed,
            tx_hash: None,
            address: None,
            created_at: current_timestamp_ms(),
            completed_at: Some(current_timestamp_ms()),
        };
        
        self.transactions.insert(tx.id.clone(), tx.clone());
        Some(tx)
    }

    /// Debit balance
    pub fn debit(&mut self, user_id: &str, wallet_type: WalletType, asset: &str,
               amount: f64, tx_type: TransactionType) -> Option<Transaction> {
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        let wallet = self.wallets.get_mut(&key)?;
        
        let available = wallet.balance - wallet.locked_balance;
        if available < amount {
            return None;
        }
        
        wallet.balance -= amount;
        wallet.updated_at = current_timestamp_ms();
        
        // Create transaction
        self.tx_id_counter += 1;
        let tx = Transaction {
            id: format!("TX-{}", self.tx_id_counter),
            user_id: user_id.to_string(),
            wallet_id: wallet.id.clone(),
            tx_type,
            asset: asset.to_string(),
            amount,
            fee: 0.0,
            status: TransactionStatus::Pending,
            tx_hash: None,
            address: None,
            created_at: current_timestamp_ms(),
            completed_at: None,
        };
        
        self.transactions.insert(tx.id.clone(), tx.clone());
        Some(tx)
    }

    /// Lock funds (for pending orders etc)
    pub fn lock_funds(&mut self, user_id: &str, wallet_type: WalletType, asset: &str, 
                    amount: f64) -> bool {
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        let wallet = self.wallets.get_mut(&key)?;
        
        let available = wallet.balance - wallet.locked_balance;
        if available < amount {
            return false;
        }
        
        wallet.locked_balance += amount;
        wallet.updated_at = current_timestamp_ms();
        true
    }

    /// Unlock funds
    pub fn unlock_funds(&mut self, user_id: &str, wallet_type: WalletType, asset: &str,
                      amount: f64) -> bool {
        let key = format!("{}_{:?}_{}", user_id, wallet_type, asset);
        let wallet = self.wallets.get_mut(&key)?;
        
        if wallet.locked_balance < amount {
            wallet.locked_balance = 0.0;
        } else {
            wallet.locked_balance -= amount;
        }
        
        wallet.updated_at = current_timestamp_ms();
        true
    }

    /// Process withdrawal
    pub fn process_withdrawal(&mut self, request: WithdrawalRequest, network_fee: f64) -> Option<Transaction> {
        let wallet_type = WalletType::Spot;
        let key = format!("{}_{:?}_{}", request.user_id, wallet_type, request.asset);
        let wallet = self.wallets.get_mut(&key)?;
        
        let total = request.amount + network_fee;
        let available = wallet.balance - wallet.locked_balance;
        
        if available < total {
            return None;
        }
        
        wallet.balance -= total;
        wallet.updated_at = current_timestamp_ms();
        
        self.tx_id_counter += 1;
        let tx = Transaction {
            id: format!("TX-{}", self.tx_id_counter),
            user_id: request.user_id.clone(),
            wallet_id: wallet.id.clone(),
            tx_type: TransactionType::Withdrawal,
            asset: request.asset.clone(),
            amount: request.amount,
            fee: network_fee,
            status: TransactionStatus::Processing,
            tx_hash: None,
            address: Some(request.address.clone()),
            created_at: current_timestamp_ms(),
            completed_at: None,
        };
        
        self.transactions.insert(tx.id.clone(), tx.clone());
        Some(tx)
    }

    /// Get transaction history
    pub fn get_transaction_history(&self, user_id: &str, limit: usize) -> Vec<&Transaction> {
        let mut txs: Vec<&Transaction> = self.transactions.values()
            .filter(|t| t.user_id == user_id)
            .collect();
        
        txs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        txs.truncate(limit);
        txs
    }

    /// Get total balance across all wallets
    pub fn get_total_balance(&self, user_id: &str) -> f64 {
        self.get_user_wallets(user_id)
            .iter()
            .map(|w| w.balance)
            .sum()
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_wallets() {
        let mut service = WalletService::new();
        let assets = vec!["BTC", "ETH", "USDT"];
        let wallets = service.initialize_wallets("user1", &assets);
        assert!(wallets.len() >= 5);
    }

    #[test]
    fn test_credit_debit() {
        let mut service = WalletService::new();
        service.initialize_wallets("user1", &["USDT"]);
        
        let tx = service.credit("user1", WalletType::Spot, "USDT", 1000.0, TransactionType::Deposit);
        assert!(tx.is_some());
        
        let balance = service.get_balance("user1", WalletType::Spot, "USDT");
        assert_eq!(balance, 1000.0);
    }

    #[test]
    fn test_lock_funds() {
        let mut service = WalletService::new();
        service.initialize_wallets("user1", &["USDT"]);
        service.credit("user1", WalletType::Spot, "USDT", 1000.0, TransactionType::Deposit);
        
        let locked = service.lock_funds("user1", WalletType::Spot, "USDT", 500.0);
        assert!(locked);
        
        let available = service.get_available_balance("user1", WalletType::Spot, "USDT");
        assert_eq!(available, 500.0);
    }
}