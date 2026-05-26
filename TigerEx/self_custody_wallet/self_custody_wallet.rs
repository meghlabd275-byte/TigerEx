//! Self-Custody Wallet
//! Non-custodial, MPC, WalletConnect
//! Migration from TypeScript to Rust

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Wallet type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WalletType {
    Hot,
    Cold,
    Multisig,
}

impl Default for WalletType {
    fn default() -> Self {
        WalletType::Hot
    }
}

/// Wallet
#[derive(Debug, Clone)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub address: String,
    pub chains: Vec<String>,
    pub created_at: u64,
}

/// Self-custody wallet manager
#[derive(Default)]
pub struct SelfCustodyWalletManager {
    wallets: HashMap<String, Wallet>,
    wallet_counter: u64,
}

impl SelfCustodyWalletManager {
    /// Create new wallet
    pub fn new() -> Self {
        Self::default()
    }

    /// Create wallet
    pub fn create(&mut self, user_id: String, wallet_type: WalletType) -> Wallet {
        self.wallet_counter += 1;
        let id = format!("WALLET_{}", self.wallet_counter);
        
        // Generate random address (simplified)
        let address = format!("0x{:032x}", self.wallet_counter);
        
        let wallet = Wallet {
            id: id.clone(),
            user_id,
            wallet_type,
            address,
            chains: Vec::new(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };
        
        self.wallets.insert(id, wallet.clone());
        wallet
    }

    /// Sign transaction
    pub fn sign_transaction(&self, wallet_id: &str, _tx: &[u8]) -> Option<(bool, String)> {
        if !self.wallets.contains_key(wallet_id) {
            return None;
        }
        
        // Simplified - real impl would use MPC
        Some((true, format!("signature_{}", wallet_id)))
    }

    /// Get balance (simulated)
    pub fn get_balance(&self, wallet_id: &str) -> Option<HashMap<String, f64>> {
        if !self.wallets.contains_key(wallet_id) {
            return None;
        }
        
        let mut balances = HashMap::new();
        balances.insert("ETH".to_string(), 1.5);
        balances.insert("BTC".to_string(), 0.1);
        balances.insert("USDT".to_string(), 5000.0);
        
        Some(balances)
    }

    /// Add chain support
    pub fn add_chain(&mut self, wallet_id: &str, chain: String) -> bool {
        if let Some(wallet) = self.wallets.get_mut(wallet_id) {
            wallet.chains.push(chain);
            return true;
        }
        false
    }

    /// Get wallet
    pub fn get_wallet(&self, wallet_id: &str) -> Option<&Wallet> {
        self.wallets.get(wallet_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_wallet() {
        let mut manager = SelfCustodyWalletManager::new();
        
        let wallet = manager.create("user1".to_string(), WalletType::Hot);
        
        assert_eq!(wallet.wallet_type, WalletType::Hot);
    }

    #[test]
    fn test_sign() {
        let mut manager = SelfCustodyWalletManager::new();
        
        let wallet = manager.create("user1".to_string(), WalletType::Cold);
        let result = manager.sign_transaction(&wallet.id, b"tx data");
        
        assert!(result.is_some());
        assert_eq!(result.unwrap().0, true);
    }
}