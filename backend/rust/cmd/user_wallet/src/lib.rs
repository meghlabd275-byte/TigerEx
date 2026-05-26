//! TigerEx User Wallet Service - Rust
//! Converts from Go - manages user crypto wallets

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Asset balance
#[derive(Debug, Clone)]
pub struct Balance {
    pub available: f64,
    pub locked: f64,
}

impl Balance {
    pub fn new() -> Self {
        Self {
            available: 0.0,
            locked: 0.0,
        }
    }

    pub fn total(&self) -> f64 {
        self.available + self.locked
    }
}

impl Default for Balance {
    fn default() -> Self {
        Self::new()
    }
}

/// User Wallet
#[derive(Debug, Clone)]
pub struct UserWallet {
    pub user_id: String,
    pub balances: HashMap<String, Balance>,
    pub deposits: Vec<Deposit>,
    pub withdrawals: Vec<Withdrawal>,
}

impl UserWallet {
    pub fn new(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_string(),
            balances: HashMap::new(),
            deposits: Vec::new(),
            withdrawals: Vec::new(),
        }
    }

    pub fn get_balance(&self, asset: &str) -> f64 {
        self.balances.get(asset).map(|b| b.available).unwrap_or(0.0)
    }

    pub fn credit(&mut self, asset: &str, amount: f64) {
        let balance = self.balances.entry(asset.to_string()).or_insert_with(Balance::new);
        balance.available += amount;
    }

    pub fn debit(&mut self, asset: &str, amount: f64) -> Result<(), String> {
        let balance = self.balances
            .get_mut(asset)
            .ok_or("No balance")?;
        
        if balance.available < amount {
            return Err("Insufficient balance".to_string());
        }
        
        balance.available -= amount;
        Ok(())
    }

    pub fn lock(&mut self, asset: &str, amount: f64) -> Result<(), String> {
        let balance = self.balances
            .entry(asset.to_string()).or_insert_with(Balance::new);
        
        if balance.available < amount {
            return Err("Insufficient balance".to_string());
        }
        
        balance.available -= amount;
        balance.locked += amount;
        Ok(())
    }

    pub fn unlock(&mut self, asset: &str, amount: f64) {
        if let Some(balance) = self.balances.get_mut(asset) {
            balance.locked = (balance.locked - amount).max(0.0);
            balance.available += amount;
        }
    }
}

/// Deposit record
#[derive(Debug, Clone)]
pub struct Deposit {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub tx_hash: String,
    pub confirmations: u32,
    pub status: DepositStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DepositStatus {
    Pending,
    Confirmed,
    Completed,
    Failed,
}

/// Withdrawal record
#[derive(Debug, Clone)]
pub struct Withdrawal {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub address: String,
    pub status: WithdrawalStatus,
    pub tx_hash: Option<String>,
    pub created_at: u64,
    pub processed_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WithdrawalStatus {
    Pending,
    Processing,
    Sent,
    Completed,
    Failed,
    Cancelled,
}

/// UserWalletService
pub struct UserWalletService {
    wallets: RwLock<HashMap<String, UserWallet>>,
    deposit_history: RwLock<HashMap<String, Vec<Deposit>>>,
    withdrawal_history: RwLock<HashMap<String, Vec<Withdrawal>>>,
}

impl UserWalletService {
    pub fn new() -> Self {
        Self {
            wallets: RwLock::new(HashMap::new()),
            deposit_history: RwLock::new(HashMap::new()),
            withdrawal_history: RwLock::new(HashMap::new()),
        }
    }

    /// Get or create wallet
    pub fn get_wallet(&self, user_id: &str) -> Arc<RwLock<UserWallet>> {
        let mut wallets = self.wallets.write().unwrap();
        if let Some(w) = wallets.get(user_id) {
            return Arc::new(RwLock::new(w.clone()));
        }
        
        let wallet = UserWallet::new(user_id);
        let arc = Arc::new(RwLock::new(wallet.clone()));
        wallets.insert(user_id.to_string(), wallet);
        arc
    }

    /// Get balance
    pub fn get_balance(&self, user_id: &str, asset: &str) -> f64 {
        let wallet = self.get_wallet(user_id);
        let wallet = wallet.read().unwrap();
        wallet.get_balance(asset)
    }

    /// Credit deposit
    pub fn credit_deposit(&self, deposit: Deposit) {
        let user_id = deposit.user_id.clone();
        
        // Update wallet
        {
            let wallet = self.get_wallet(&user_id);
            let mut wallet = wallet.write().unwrap();
            wallet.credit(&deposit.asset, deposit.amount);
        }
        
        // Store deposit
        let mut history = self.deposit_history.write().unwrap();
        history
            .entry(user_id.clone())
            .or_insert_with(Vec::new)
            .push(deposit);
    }

    /// Process withdrawal request
    pub fn request_withdrawal(&self, user_id: &str, asset: &str, amount: f64, address: &str) -> Result<Withdrawal, String> {
        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        
        // Check available balance
        let balance = wallet.balances.get(asset).map(|b| b.available).unwrap_or(0.0);
        if balance < amount {
            return Err("Insufficient balance".to_string());
        }
        
        // Deduct amount
        wallet.debit(asset, amount)?;
        
        let fee = Self::calculate_fee(asset, amount);
        let net_amount = amount - fee;
        
        let withdrawal = Withdrawal {
            id: generate_id(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount: net_amount,
            fee,
            address: address.to_string(),
            status: WithdrawalStatus::Pending,
            tx_hash: None,
            created_at: current_timestamp(),
            processed_at: None,
        };
        
        // Store
        let mut history = self.withdrawal_history.write().unwrap();
        history
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(withdrawal.clone());
        
        Ok(withdrawal)
    }

    /// Get deposit history
    pub fn get_deposits(&self, user_id: &str) -> Vec<Deposit> {
        let history = self.deposit_history.read().unwrap();
        history.get(user_id).cloned().unwrap_or_default()
    }

    /// Get withdrawal history
    pub fn get_withdrawals(&self, user_id: &str) -> Vec<Withdrawal> {
        let history = self.withdrawal_history.read().unwrap();
        history.get(user_id).cloned().unwrap_or_default()
    }

    /// Calculate withdrawal fee
    fn calculate_fee(asset: &str, amount: f64) -> f64 {
        let fee_rates: HashMap<&str, f64> = HashMap::from([
            ("BTC", 0.0005),
            ("ETH", 0.005),
            ("USDT", 1.0),
            ("USDC", 1.0),
        ]);
        
        fee_rates.get(asset).copied().unwrap_or(0.01)
    }
}

impl Default for UserWalletService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("wd_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet() {
        let service = UserWalletService::new();
        let wallet = service.get_wallet("user1");
        let balance = wallet.read().unwrap().get_balance("BTC");
        assert_eq!(balance, 0.0);
    }
}