//! Self-Custody Wallet
//!
//! Non-custodial wallet registry. Address derivation, MPC signing and balance
//! reads are deliberately unimplemented: a non-custodial wallet that cannot run
//! its real key ceremony or read the chain must refuse, never fabricate an
//! address, a signature or a balance.

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalletError {
    WalletNotFound,
    /// Address derivation / key ceremony is not wired.
    KeyCeremonyUnavailable,
    /// MPC signing is not wired.
    SigningUnavailable,
    /// No chain data source is configured.
    ChainDataUnavailable,
    InvalidParameters(String),
}

impl std::fmt::Display for WalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WalletError::WalletNotFound => write!(f, "wallet not found"),
            WalletError::KeyCeremonyUnavailable => {
                write!(f, "key ceremony is not available; cannot derive an address")
            }
            WalletError::SigningUnavailable => write!(f, "MPC signing is not available"),
            WalletError::ChainDataUnavailable => write!(f, "no chain data source is configured"),
            WalletError::InvalidParameters(m) => write!(f, "invalid parameters: {}", m),
        }
    }
}

impl std::error::Error for WalletError {}

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
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a wallet around an address produced by the real key ceremony.
    ///
    /// Fails closed: with no address there is nothing to register, and a
    /// fabricated address would be unrecoverable, so this refuses.
    pub fn create(
        &mut self,
        user_id: String,
        wallet_type: WalletType,
        address: String,
    ) -> Result<Wallet, WalletError> {
        if user_id.trim().is_empty() {
            return Err(WalletError::InvalidParameters("user id is required".into()));
        }
        if address.trim().is_empty() {
            return Err(WalletError::KeyCeremonyUnavailable);
        }
        self.wallet_counter += 1;
        let id = format!("WALLET_{}", self.wallet_counter);
        let wallet = Wallet {
            id: id.clone(),
            user_id,
            wallet_type,
            address,
            chains: Vec::new(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        };
        self.wallets.insert(id, wallet.clone());
        Ok(wallet)
    }

    /// Sign a transaction.
    ///
    /// Fails closed: no signature is returned unless the real MPC protocol
    /// produced one.
    pub fn sign_transaction(&self, wallet_id: &str, tx: &[u8]) -> Result<Vec<u8>, WalletError> {
        if !self.wallets.contains_key(wallet_id) {
            return Err(WalletError::WalletNotFound);
        }
        if tx.is_empty() {
            return Err(WalletError::InvalidParameters(
                "transaction payload is empty".into(),
            ));
        }
        Err(WalletError::SigningUnavailable)
    }

    /// Read a wallet's on-chain balances.
    ///
    /// Fails closed: there is no chain data source, so this returns an error
    /// rather than a hardcoded balance map.
    pub fn get_balance(
        &self,
        wallet_id: &str,
    ) -> Result<HashMap<String, f64>, WalletError> {
        if !self.wallets.contains_key(wallet_id) {
            return Err(WalletError::WalletNotFound);
        }
        Err(WalletError::ChainDataUnavailable)
    }

    /// Add chain support
    pub fn add_chain(&mut self, wallet_id: &str, chain: String) -> bool {
        if chain.trim().is_empty() {
            return false;
        }
        if let Some(wallet) = self.wallets.get_mut(wallet_id) {
            if !wallet.chains.contains(&chain) {
                wallet.chains.push(chain);
            }
            return true;
        }
        false
    }

    pub fn get_wallet(&self, wallet_id: &str) -> Option<&Wallet> {
        self.wallets.get(wallet_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_requires_a_real_address() {
        let mut manager = SelfCustodyWalletManager::new();
        assert!(matches!(
            manager.create("user1".to_string(), WalletType::Hot, String::new()),
            Err(WalletError::KeyCeremonyUnavailable)
        ));
        assert!(matches!(
            manager.create(String::new(), WalletType::Hot, "0xabc".to_string()),
            Err(WalletError::InvalidParameters(_))
        ));
    }

    #[test]
    fn create_registers_the_supplied_address() {
        let mut manager = SelfCustodyWalletManager::new();
        let wallet = manager
            .create("user1".to_string(), WalletType::Hot, "0xdeadbeef".to_string())
            .unwrap();
        assert_eq!(wallet.address, "0xdeadbeef");
        assert_eq!(wallet.wallet_type, WalletType::Hot);
    }

    #[test]
    fn signing_fails_closed_and_never_fabricates() {
        let mut manager = SelfCustodyWalletManager::new();
        let wallet = manager
            .create("user1".to_string(), WalletType::Cold, "0xabc".to_string())
            .unwrap();
        assert!(matches!(
            manager.sign_transaction(&wallet.id, b"tx data"),
            Err(WalletError::SigningUnavailable)
        ));
        assert!(matches!(
            manager.sign_transaction("missing", b"tx data"),
            Err(WalletError::WalletNotFound)
        ));
    }

    #[test]
    fn balance_fails_closed_without_a_chain_source() {
        let mut manager = SelfCustodyWalletManager::new();
        let wallet = manager
            .create("user1".to_string(), WalletType::Hot, "0xabc".to_string())
            .unwrap();
        assert!(matches!(
            manager.get_balance(&wallet.id),
            Err(WalletError::ChainDataUnavailable)
        ));
    }
}
