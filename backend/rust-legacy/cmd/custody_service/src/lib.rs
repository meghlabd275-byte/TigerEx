//! TigerEx Custody Service - Fund Security in Rust
//! SECURITY-CRITICAL: Handles all user funds
//! WHY RUST: Memory safety, no buffer overflows, deterministic behavior

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Asset supported
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct Asset {
    pub symbol: String,
    pub decimals: u8,
    pub is_crypto: bool,
    pub min_withdrawal: f64,
    pub network: Option<String>,
}

impl Asset {
    pub fn crypto(symbol: &str, decimals: u8, min_withdrawal: f64) -> Self {
        Self {
            symbol: symbol.to_string(),
            decimals,
            is_crypto: true,
            min_withdrawal,
            network: None,
        }
    }
    
    pub fn fiat(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            decimals: 2,
            is_crypto: false,
            min_withdrawal: 10.0,
            network: None,
        }
    }
}

/// Balance for an asset
#[derive(Debug, Clone)]
pub struct Balance {
    pub available: f64,
    pub locked: f64,
    pub total: f64,
}

impl Balance {
    pub fn new() -> Self {
        Self {
            available: 0.0,
            locked: 0.0,
            total: 0.0,
        }
    }

    pub fn add(&mut self, amount: f64) {
        self.available += amount;
        self.total += amount;
    }

    pub fn lock(&mut self, amount: f64) -> Result<(), String> {
        if self.available < amount {
            return Err("Insufficient available balance".to_string());
        }
        self.available -= amount;
        self.locked += amount;
        Ok(())
    }

    pub fn unlock(&mut self, amount: f64) -> Result<(), String> {
        if self.locked < amount {
            return Err("Insufficient locked balance".to_string());
        }
        self.locked -= amount;
        self.available += amount;
        Ok(())
    }

    pub fn deduct(&mut self, amount: f64) -> Result<(), String> {
        if self.total < amount {
            return Err("Insufficient total balance".to_string());
        }
        self.total -= amount;
        if self.locked >= amount {
            self.locked -= amount;
        } else {
            self.available -= amount - self.locked;
            self.locked = 0.0;
        }
        Ok(())
    }
}

impl Default for Balance {
    fn default() -> Self {
        Self::new()
    }
}

/// User wallet balances
#[derive(Debug, Clone)]
pub struct Wallet {
    pub user_id: String,
    pub balances: HashMap<String, Balance>,
    pub is_verified: bool,
    pub kyc_level: u8,
    pub blocked: bool,
    pub block_reason: Option<String>,
}

impl Wallet {
    pub fn new(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_string(),
            balances: HashMap::new(),
            is_verified: false,
            kyc_level: 0,
            blocked: false,
            block_reason: None,
        }
    }

    pub fn get_balance(&self, symbol: &str) -> f64 {
        self.balances.get(symbol).map(|b| b.available).unwrap_or(0.0)
    }

    pub fn deposit(&mut self, symbol: &str, amount: f64) {
        let balance = self.balances.entry(symbol.to_string()).or_insert_with(Balance::new);
        balance.add(amount);
    }

    pub fn can_withdraw(&self, symbol: &str, amount: f64) -> bool {
        if self.blocked {
            return false;
        }
        
        // Check KYC requirements
        match symbol {
            "BTC" | "ETH" | "USDT" => return self.kyc_level >= 2,
            _ => return self.kyc_level >= 1,
        }
        
        self.balances
            .get(symbol)
            .map(|b| b.available >= amount)
            .unwrap_or(false)
    }

    pub fn withdraw(&mut self, symbol: &str, amount: f64) -> Result<(), String> {
        if self.blocked {
            return Err("Wallet blocked".to_string());
        }

        // Check minimum withdrawal
        let min_withdrawal = match symbol {
            "BTC" => 0.0001,
            "ETH" => 0.001,
            "USDT" => 10.0,
            _ => 1.0,
        };
        
        if amount < min_withdrawal {
            return Err(format!("Minimum withdrawal is {}", min_withdrawal));
        }

        let balance = self.balances
            .get_mut(symbol)
            .ok_or("No balance for asset")?;
        
        if balance.available < amount {
            return Err("Insufficient balance".to_string());
        }

        balance.available -= amount;
        balance.total -= amount;
        
        Ok(())
    }

    pub fn lock_for_trade(&mut self, symbol: &str, amount: f64) -> Result<(), String> {
        let balance = self.balances
            .entry(symbol.to_string()).or_insert_with(Balance::new);
        balance.lock(amount)
    }

    pub fn unlock_after_trade(&mut self, symbol: &str, amount: f64) -> Result<(), String> {
        let balance = self.balances
            .get_mut(symbol)
            .ok_or("No balance for asset")?;
        balance.unlock(amount)
    }
}

/// Withdrawal request
#[derive(Debug, Clone)]
pub struct WithdrawalRequest {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub amount: f64,
    pub address: String,
    pub network: Option<String>,
    pub status: WithdrawalStatus,
    pub fee: f64,
    pub tx_hash: Option<String>,
    pub created_at: u64,
    pub processed_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WithdrawalStatus {
    Pending,
    Approved,
    Processing,
    Sent,
    Completed,
    Failed,
    Cancelled,
}

impl WithdrawalRequest {
    pub fn new(user_id: &str, symbol: &str, amount: f64, address: &str) -> Self {
        Self {
            id: generate_id(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            amount,
            address: address.to_string(),
            network: None,
            status: WithdrawalStatus::Pending,
            fee: 0.0,
            tx_hash: None,
            created_at: current_timestamp(),
            processed_at: None,
        }
    }
}

/// Custody service - manages all funds
pub struct CustodyService {
    wallets: RwLock<HashMap<String, Wallet>>,
    withdrawals: RwLock<HashMap<String, WithdrawalRequest>>,
    assets: RwLock<HashMap<String, Asset>>,
}

impl CustodyService {
    pub fn new() -> Self {
        let mut service = Self {
            wallets: RwLock::new(HashMap::new()),
            withdrawals: RwLock::new(HashMap::new()),
            assets: RwLock::new(HashMap::new()),
        };
        
        // Register supported assets
        service.register_asset(Asset::crypto("BTC", 8, 0.0001));
        service.register_asset(Asset::crypto("ETH", 18, 0.001));
        service.register_asset(Asset::crypto("USDT", 6, 10.0));
        service.register_asset(Asset::crypto("USDC", 6, 10.0));
        service.register_asset(Asset::crypto("BNB", 18, 0.01));
        service.register_asset(Asset::crypto("SOL", 9, 0.01));
        service
    }

    fn register_asset(&mut self, asset: Asset) {
        let mut assets = self.assets.write().unwrap();
        assets.insert(asset.symbol.clone(), asset);
    }

    /// Get or create wallet
    pub fn get_wallet(&self, user_id: &str) -> Arc<RwLock<Wallet>> {
        let mut wallets = self.wallets.write().unwrap();
        if let Some(w) = wallets.get(user_id) {
            return Arc::new(RwLock::new(w.clone()));
        }
        
        let wallet = Wallet::new(user_id);
        let arc = Arc::new(RwLock::new(wallet.clone()));
        wallets.insert(user_id.to_string(), wallet);
        arc
    }

    /// Deposit funds
    pub fn deposit(&self, user_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        wallet.deposit(symbol, amount);
        Ok(())
    }

    /// Request withdrawal
    pub fn request_withdrawal(&self, request: WithdrawalRequest) -> Result<WithdrawalRequest, String> {
        // Verify wallet
        {
            let wallet = self.get_wallet(&request.user_id);
            let wallet = wallet.read().unwrap();
            
            if wallet.blocked {
                return Err("Wallet blocked".to_string());
            }
            
            if !wallet.can_withdraw(&request.symbol, request.amount) {
                return Err("Cannot withdraw - KYC required".to_string());
            }
        }

        // Check balance
        {
            let wallet = self.get_wallet(&request.user_id);
            let mut wallet = wallet.write().unwrap();
            wallet.withdraw(&request.symbol, request.amount)?;
        }

        // Store request
        let id = request.id.clone();
        let mut withdrawals = self.withdrawals.write().unwrap();
        withdrawals.insert(id, request.clone());
        
        Ok(request)
    }

    /// Approve withdrawal (admin only)
    pub fn approve_withdrawal(&self, withdrawal_id: &str) -> Result<(), String> {
        let mut withdrawals = self.withdrawals.write().unwrap();
        
        if let Some(req) = withdrawals.get_mut(withdrawal_id) {
            if req.status == WithdrawalStatus::Pending {
                req.status = WithdrawalStatus::Approved;
                Ok(())
            } else {
                Err("Invalid status for approval".to_string())
            }
        } else {
            Err("Withdrawal not found".to_string())
        }
    }

    /// Mark withdrawal as sent
    pub fn mark_sent(&self, withdrawal_id: &str, tx_hash: &str) -> Result<(), String> {
        let mut withdrawals = self.withdrawals.write().unwrap();
        
        if let Some(req) = withdrawals.get_mut(withdrawal_id) {
            req.tx_hash = Some(tx_hash.to_string());
            req.status = WithdrawalStatus::Sent;
            req.processed_at = Some(current_timestamp());
            Ok(())
        } else {
            Err("Withdrawal not found".to_string())
        }
    }

    /// Get balance
    pub fn get_balance(&self, user_id: &str, symbol: &str) -> f64 {
        let wallet = self.get_wallet(user_id);
        let wallet = wallet.read().unwrap();
        wallet.get_balance(symbol)
    }

    /// Block wallet (admin)
    pub fn block_wallet(&self, user_id: &str, reason: &str) -> Result<(), String> {
        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        wallet.blocked = true;
        wallet.block_reason = Some(reason.to_string());
        Ok(())
    }

    /// Unblock wallet (admin)
    pub fn unblock_wallet(&self, user_id: &str) -> Result<(), String> {
        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        wallet.blocked = false;
        wallet.block_reason = None;
        Ok(())
    }

    /// Verify KYC
    pub fn set_kyc(&self, user_id: &str, level: u8) -> Result<(), String> {
        let wallet = self.get_wallet(user_id);
        let mut wallet = wallet.write().unwrap();
        wallet.kyc_level = level;
        wallet.is_verified = level >= 2;
        Ok(())
    }
}

impl Default for CustodyService {
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
    format!("wdr_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deposit_withdraw() {
        let service = CustodyService::new();
        
        service.deposit("user1", "BTC", 1.0).unwrap();
        let balance = service.get_balance("user1", "BTC");
        
        assert_eq!(balance, 1.0);
    }
}