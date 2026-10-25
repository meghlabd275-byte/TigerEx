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

    pub fn credit(&mut self, asset: &str, amount: f64) -> Result<(), String> {
        // A negative credit would otherwise debit the wallet.
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Credit amount must be finite and positive".to_string());
        }
        let balance = self.balances.entry(asset.to_string()).or_insert_with(Balance::new);
        balance.available += amount;
        Ok(())
    }

    pub fn debit(&mut self, asset: &str, amount: f64) -> Result<(), String> {
        // A negative or NaN debit would slip past the balance check and credit
        // the wallet.
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Debit amount must be finite and positive".to_string());
        }

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
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Lock amount must be finite and positive".to_string());
        }

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
    wallets: RwLock<HashMap<String, Arc<RwLock<UserWallet>>>>,
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

    /// Get or create the wallet handle for a user.
    ///
    /// The shared `Arc` is returned, not a clone of the wallet: the previous
    /// version returned a fresh `Arc` wrapping a copy, so every credit, debit
    /// and lock was written to a throwaway and silently discarded, leaving all
    /// balances at zero.
    pub fn get_wallet(&self, user_id: &str) -> Arc<RwLock<UserWallet>> {
        let mut wallets = self.wallets.write().unwrap();
        wallets
            .entry(user_id.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(UserWallet::new(user_id))))
            .clone()
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
            if let Err(err) = wallet.credit(&deposit.asset, deposit.amount) {
                eprintln!("rejected deposit {}: {err}", deposit.id);
                return;
            }
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
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Withdrawal amount must be finite and positive".to_string());
        }

        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        
        // Check available balance
        let balance = wallet.balances.get(asset).map(|b| b.available).unwrap_or(0.0);
        if balance < amount {
            return Err("Insufficient balance".to_string());
        }
        
        // The fee must not exceed the withdrawal, or the user would be paid a
        // negative net amount.
        let fee = Self::calculate_fee(asset, amount);
        let net_amount = amount - fee;
        if net_amount <= 0.0 {
            return Err("Amount does not cover the withdrawal fee".to_string());
        }

        // Deduct amount
        wallet.debit(asset, amount)?;
        
        
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

    fn deposit(service: &UserWalletService, user: &str, asset: &str, amount: f64) {
        service.credit_deposit(Deposit {
            id: format!("d_{user}_{asset}"),
            user_id: user.to_string(),
            asset: asset.to_string(),
            amount,
            tx_hash: "0xabc".to_string(),
            confirmations: 6,
            status: DepositStatus::Confirmed,
            created_at: 0,
        });
    }

    #[test]
    fn deposits_persist_instead_of_being_discarded() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", 1.5);

        // The old get_wallet returned a throwaway clone, so this read 0.0.
        assert_eq!(service.get_balance("user1", "BTC"), 1.5);
    }

    #[test]
    fn negative_credits_debits_and_locks_are_rejected() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", 1.0);

        let wallet = service.get_wallet("user1");
        assert!(wallet.write().unwrap().credit("BTC", -1.0).is_err());
        assert!(wallet.write().unwrap().debit("BTC", -1.0).is_err());
        assert!(wallet.write().unwrap().lock("BTC", -1.0).is_err());
        assert_eq!(service.get_balance("user1", "BTC"), 1.0);
    }

    #[test]
    fn lock_moves_balance_between_available_and_locked() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", 1.0);

        let wallet = service.get_wallet("user1");
        wallet.write().unwrap().lock("BTC", 0.4).unwrap();
        {
            let w = wallet.read().unwrap();
            assert_eq!(w.get_balance("BTC"), 0.6);
            assert_eq!(w.balances.get("BTC").unwrap().locked, 0.4);
        }

        wallet.write().unwrap().unlock("BTC", 0.4);
        assert_eq!(service.get_balance("user1", "BTC"), 1.0);
    }

    #[test]
    fn withdrawals_debit_the_balance_and_reject_overspend() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", 1.0);

        assert!(service
            .request_withdrawal("user1", "BTC", 2.0, "addr")
            .is_err());

        let withdrawal = service
            .request_withdrawal("user1", "BTC", 0.5, "addr")
            .unwrap();
        assert_eq!(withdrawal.status, WithdrawalStatus::Pending);
        assert_eq!(service.get_balance("user1", "BTC"), 0.5);
        assert!((withdrawal.amount - (0.5 - withdrawal.fee)).abs() < 1e-12);
    }

    #[test]
    fn a_withdrawal_below_the_fee_is_rejected() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", 1.0);

        // The BTC fee is 0.0005, so a 0.0001 withdrawal nets negative.
        assert!(service
            .request_withdrawal("user1", "BTC", 0.0001, "addr")
            .is_err());
        assert_eq!(service.get_balance("user1", "BTC"), 1.0);
    }

    #[test]
    fn non_positive_deposits_are_not_recorded() {
        let service = UserWalletService::new();
        deposit(&service, "user1", "BTC", -1.0);

        assert_eq!(service.get_balance("user1", "BTC"), 0.0);
        assert!(service.get_deposits("user1").is_empty());
    }
}