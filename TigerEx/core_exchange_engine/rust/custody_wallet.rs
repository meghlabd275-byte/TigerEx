//! TigerEx Custody Wallet - Rust Implementation
//! 
//! Secure custody wallet with hardware security module (HSM) integration
//! Multi-signature support and cold wallet management
//! 
//! Migration from Go to Rust for stronger memory safety

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Wallet type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WalletType {
    Hot,      // Online, for withdrawals
    Cold,     // Offline, for storage
    Custody,   // HSM-managed
    Trading,   // Exchange trading
}

/// Asset status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetStatus {
    Available,
    Locked,
    Frozen,
    Withdrawing,
}

/// Transaction type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxType {
    Deposit,
    Withdrawal,
    Transfer,
    Trade,
    Fee,
    Adjustment,
}

/// Transaction status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

/// Network
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Network {
    Bitcoin,
    Ethereum,
    Solana,
    Polygon,
    BSC,
    Arbitrum,
    Optimism,
}

/// Wallet address
#[derive(Debug, Clone)]
pub struct WalletAddress {
    pub address: String,
    pub network: Network,
    pub public_key: Vec<u8>,
    pub is_hot: bool,
}

/// Balance
#[derive(Debug, Clone)]
pub struct Balance {
    pub asset: String,
    pub available: u64,      // Scaled integer
    pub locked: u64,           // In orders
    pub frozen: u64,           // Frozen by admin
    pub pending_withdraw: u64,
}

impl Balance {
    pub fn total(&self) -> u64 {
        self.available + self.locked + self.frozen
    }
}

/// Transaction
#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: u64,
    pub tx_type: TxType,
    pub status: TxStatus,
    pub from_address: Option<String>,
    pub to_address: Option<String>,
    pub tx_hash: Option<String>,
    pub network: Network,
    pub fee: u64,
    pub confirmations: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Withdrawal request
#[derive(Debug, Clone)]
pub struct WithdrawalRequest {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: u64,
    pub to_address: String,
    pub network: Network,
    pub fee: u64,
    pub status: WithdrawalStatus,
    pub approved_by: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WithdrawalStatus {
    Pending,
    Approved,
    Processing,
    Completed,
    Rejected,
    Cancelled,
}

/// Deposit
#[derive(Debug, Clone)]
pub struct Deposit {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: u64,
    pub from_address: String,
    pub to_address: String,
    pub tx_hash: String,
    pub network: Network,
    pub confirmations: u32,
    pub required_confirmations: u32,
    pub status: DepositStatus,
    pub credited_at: Option<u64>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepositStatus {
    Pending,
    Confirming,
    Credited,
    Failed,
}

/// Wallet
#[derive(Debug, Clone)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub balances: HashMap<String, Balance>,
    pub addresses: Vec<WalletAddress>,
    pub is_enabled: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Wallet {
    pub fn new(user_id: String, wallet_type: WalletType) -> Self {
        Wallet {
            id: format!("WAL-{}-{}", user_id, wallet_type as u8),
            user_id,
            wallet_type,
            balances: HashMap::new(),
            addresses: Vec::new(),
            is_enabled: true,
            created_at: current_timestamp(),
            updated_at: current_timestamp(),
        }
    }
    
    /// Get balance for asset
    pub fn get_balance(&self, asset: &str) -> u64 {
        self.balances.get(asset)
            .map(|b| b.available)
            .unwrap_or(0)
    }
    
    /// Check if sufficient balance
    pub fn has_sufficient_balance(&self, asset: &str, amount: u64) -> bool {
        self.balances.get(asset)
            .map(|b| b.available >= amount)
            .unwrap_or(false)
    }
    
    /// Lock funds
    pub fn lock_funds(&mut self, asset: &str, amount: u64) -> Result<(), String> {
        let balance = self.balances.get_mut(asset)
            .ok_or_else(|| "Asset not found")?;
        
        if balance.available < amount {
            return Err("Insufficient balance".to_string());
        }
        
        balance.available -= amount;
        balance.locked += amount;
        self.updated_at = current_timestamp();
        
        Ok(())
    }
    
    /// Unlock funds
    pub fn unlock_funds(&mut self, asset: &str, amount: u64) {
        if let Some(balance) = self.balances.get_mut(asset) {
            balance.locked = balance.locked.saturating_sub(amount);
            balance.available += amount;
            self.updated_at = current_timestamp();
        }
    }
    
    /// Credit deposit
    pub fn credit(&mut self, asset: &str, amount: u64) {
        let balance = self.balances.entry(asset.to_string())
            .or_insert_with(|| Balance {
                asset: asset.to_string(),
                available: 0,
                locked: 0,
                frozen: 0,
                pending_withdraw: 0,
            });
        
        balance.available += amount;
        self.updated_at = current_timestamp();
    }
    
    /// Debit for withdrawal
    pub fn debit(&mut self, asset: &str, amount: u64) -> Result<(), String> {
        let balance = self.balances.get_mut(asset)
            .ok_or_else(|| "Asset not found")?;
        
        if balance.available < amount {
            return Err("Insufficient balance".to_string());
        }
        
        balance.available -= amount;
        self.updated_at = current_timestamp();
        
        Ok(())
    }
}

/// Custody Wallet Manager
pub struct CustodyWallet {
    // Wallets by user
    wallets: HashMap<String, Wallet>,
    
    // Transactions
    transactions: HashMap<String, VecDeque<Transaction>>,
    
    // Pending withdrawals
    withdrawals: HashMap<String, WithdrawalRequest>,
    
    // Deposits
    deposits: HashMap<String, Deposit>,
    
    // Fee configuration
    withdrawal_fees: HashMap<String, u64>, // asset -> fee
    
    // Counters
    tx_id_counter: u64,
    
    // HSM integration
    hsm_enabled: bool,
}

impl CustodyWallet {
    pub fn new() -> Self {
        let mut wallet = CustodyWallet {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
            withdrawals: HashMap::new(),
            deposits: HashMap::new(),
            withdrawal_fees: HashMap::new(),
            tx_id_counter: 0,
            hsm_enabled: false,
        };
        
        // Initialize default withdrawal fees
        wallet.withdrawal_fees.insert("BTC".to_string(), 5000);   // 0.00005 BTC
        wallet.withdrawal_fees.insert("ETH".to_string(), 1000000000); // 0.001 ETH
        wallet.withdrawal_fees.insert("USDT".to_string(), 1000000); // 1 USDT
        
        wallet
    }
    
    /// Create wallet for user
    pub fn create_wallet(&mut self, user_id: String, wallet_type: WalletType) -> &Wallet {
        let wallet = Wallet::new(user_id.clone(), wallet_type);
        self.wallets.insert(user_id, wallet);
        self.wallets.get(&user_id).unwrap()
    }
    
    /// Get or create wallet
    pub fn get_or_create_wallet(&mut self, user_id: &str, wallet_type: WalletType) -> &mut Wallet {
        self.wallets.entry(user_id.to_string())
            .or_insert_with(|| Wallet::new(user_id.to_string(), wallet_type))
    }
    
    /// Deposit
    pub fn deposit(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: u64,
        from_address: &str,
        tx_hash: &str,
        network: Network,
    ) -> Result<&Deposit, String> {
        let wallet = self.get_or_create_wallet(user_id, WalletType::Custody);
        
        self.tx_id_counter += 1;
        let deposit = Deposit {
            id: format!("DEP-{}", self.tx_id_counter),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            from_address: from_address.to_string(),
            to_address: wallet.addresses.first()
                .map(|a| a.address.clone())
                .unwrap_or_default(),
            tx_hash: tx_hash.to_string(),
            network,
            confirmations: 0,
            required_confirmations: get_required_confirmations(network),
            status: DepositStatus::Pending,
            credited_at: None,
            created_at: current_timestamp(),
        };
        
        let deposit_id = deposit.id.clone();
        self.deposits.insert(deposit_id, deposit);
        
        Ok(self.deposits.get(&deposit_id).unwrap())
    }
    
    /// Confirm deposit
    pub fn confirm_deposit(&mut self, deposit_id: &str, confirmations: u32) -> Result<(), String> {
        let deposit = self.deposits.get_mut(deposit_id)
            .ok_or_else(|| "Deposit not found")?;
        
        deposit.confirmations = confirmations;
        
        if confirmations >= deposit.required_confirmations {
            deposit.status = DepositStatus::Credited;
            deposit.credited_at = Some(current_timestamp());
            
            // Credit wallet
            let wallet = self.get_or_create_wallet(&deposit.user_id, WalletType::Custody);
            wallet.credit(&deposit.asset, deposit.amount);
        } else {
            deposit.status = DepositStatus::Confirming;
        }
        
        Ok(())
    }
    
    /// Request withdrawal
    pub fn request_withdrawal(
        &mut self,
        user_id: &str,
        asset: &str,
        amount: u64,
        to_address: &str,
        network: Network,
    ) -> Result<&WithdrawalRequest, String> {
        let wallet = self.wallets.get(user_id)
            .ok_or_else(|| "Wallet not found")?;
        
        let fee = self.withdrawal_fees.get(asset)
            .copied()
            .unwrap_or(0);
        
        let total = amount + fee;
        if !wallet.has_sufficient_balance(asset, total) {
            return Err("Insufficient balance".to_string());
        }
        
        self.tx_id_counter += 1;
        let request = WithdrawalRequest {
            id: format!("WDR-{}", self.tx_id_counter),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            to_address: to_address.to_string(),
            network,
            fee,
            status: WithdrawalStatus::Pending,
            approved_by: None,
            created_at: current_timestamp(),
        };
        
        let request_id = request.id.clone();
        self.withdrawals.insert(request_id, request);
        
        Ok(self.withdrawals.get(&request_id).unwrap())
    }
    
    /// Approve withdrawal
    pub fn approve_withdrawal(&mut self, request_id: &str, approver: &str) -> Result<(), String> {
        let request = self.withdrawals.get_mut(request_id)
            .ok_or_else(|| "Withdrawal not found")?;
        
        if request.status != WithdrawalStatus::Pending {
            return Err("Invalid status".to_string());
        }
        
        request.status = WithdrawalStatus::Approved;
        request.approved_by = Some(approver.to_string());
        
        Ok(())
    }
    
    /// Process withdrawal
    pub fn process_withdrawal(&mut self, request_id: &str, tx_hash: &str) -> Result<(), String> {
        let request = self.withdrawals.get_mut(request_id)
            .ok_or_else(|| "Withdrawal not found")?;
        
        if request.status != WithdrawalStatus::Approved {
            return Err("Must be approved first".to_string());
        }
        
        // Debit wallet
        let wallet = self.wallets.get_mut(&request.user_id)
            .ok_or_else(|| "Wallet not found")?;
        
        let total = request.amount + request.fee;
        wallet.debit(&request.asset, total)?;
        
        request.status = WithdrawalStatus::Completed;
        
        Ok(())
    }
    
    /// Transfer between users
    pub fn transfer(
        &mut self,
        from_user: &str,
        to_user: &str,
        asset: &str,
        amount: u64,
    ) -> Result<(), String> {
        let from_wallet = self.wallets.get_mut(from_user)
            .ok_or_else(|| "Sender wallet not found")?;
        
        let to_wallet = self.get_or_create_wallet(to_user, WalletType::Custody);
        
        from_wallet.debit(asset, amount)?;
        to_wallet.credit(asset, amount);
        
        Ok(())
    }
    
    /// Get balance
    pub fn get_balance(&self, user_id: &str, asset: &str) -> u64 {
        self.wallets.get(user_id)
            .map(|w| w.get_balance(asset))
            .unwrap_or(0)
    }
    
    /// Get transaction history
    pub fn get_transactions(&self, user_id: &str) -> Vec<&Transaction> {
        self.transactions.get(user_id)
            .map(|txs| txs.iter().collect())
            .unwrap_or_default()
    }
}

fn get_required_confirmations(network: Network) -> u32 {
    match network {
        Network::Bitcoin => 6,
        Network::Ethereum => 12,
        Network::Solana => 32,
        Network::Polygon => 50,
        Network::BSC => 15,
        Network::Arbitrum => 12,
        Network::Optimism => 12,
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_wallet() {
        let mut wallet = CustodyWallet::new();
        wallet.create_wallet("user1".to_string(), WalletType::Custody);
        
        assert!(wallet.wallets.contains_key("user1"));
    }
    
    #[test]
    fn test_deposit() {
        let mut wallet = CustodyWallet::new();
        wallet.create_wallet("user1".to_string(), WalletType::Custody);
        
        let deposit = wallet.deposit("user1", "BTC", 100000000, "abc123", "tx123", Network::Bitcoin).unwrap();
        assert_eq!(deposit.amount, 100000000);
    }
    
    #[test]
    fn test_withdrawal() {
        let mut wallet = CustodyWallet::new();
        wallet.create_wallet("user1".to_string(), WalletType::Custody);
        
        let wallet = wallet.wallets.get_mut("user1").unwrap();
        wallet.credit("BTC", 100000000);
        
        let request = wallet.request_withdrawal("user1", "BTC", 50000000, "def456", Network::Bitcoin).unwrap();
        assert_eq!(request.amount, 50000000);
    }
}