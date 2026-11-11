// TigerEx Hardware Wallet Integration
//
// Records a hardware signer and builds unsigned transactions for it. The device
// handshake and signature capture are deliberately unimplemented: a service that
// is not talking to a real device must refuse to sign, never return a fabricated
// signature that would be treated as a valid one.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HardwareWalletError {
    WalletNotFound,
    TransactionNotFound,
    AlreadySigned,
    InvalidParameters(String),
    /// The device communication layer is not wired.
    DeviceUnavailable,
}

impl std::fmt::Display for HardwareWalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HardwareWalletError::WalletNotFound => write!(f, "wallet not found"),
            HardwareWalletError::TransactionNotFound => write!(f, "transaction not found"),
            HardwareWalletError::AlreadySigned => write!(f, "transaction is already signed"),
            HardwareWalletError::InvalidParameters(m) => write!(f, "invalid parameters: {}", m),
            HardwareWalletError::DeviceUnavailable => {
                write!(f, "hardware device communication is not available")
            }
        }
    }
}

impl std::error::Error for HardwareWalletError {}

#[derive(Debug, Clone)]
pub struct HardwareWallet {
    pub id: String,
    pub device_type: String, // ledger, trezor, coldcard
    pub serial: String,
    pub pubkey: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub wallet_id: String,
    pub to: String,
    pub amount: u64,
    pub signed: bool,
    /// The device-produced signature. Never fabricated here.
    pub signature: Option<Vec<u8>>,
}

pub struct HardwareWalletService {
    wallets: HashMap<String, HardwareWallet>,
    transactions: HashMap<String, Transaction>,
}

impl Default for HardwareWalletService {
    fn default() -> Self {
        Self::new()
    }
}

impl HardwareWalletService {
    pub fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
        }
    }

    /// Register a device whose public key was read from the device itself.
    pub fn register_wallet(
        &mut self,
        device_type: &str,
        serial: &str,
        pubkey: &str,
    ) -> Result<String, HardwareWalletError> {
        if device_type.trim().is_empty() || serial.trim().is_empty() || pubkey.trim().is_empty() {
            return Err(HardwareWalletError::InvalidParameters(
                "device type, serial and public key are all required".into(),
            ));
        }
        let id = format!("HW_{}", self.wallets.len());
        self.wallets.insert(
            id.clone(),
            HardwareWallet {
                id: id.clone(),
                device_type: device_type.to_string(),
                serial: serial.to_string(),
                pubkey: pubkey.to_string(),
                status: "ACTIVE".to_string(),
            },
        );
        Ok(id)
    }

    /// Build an unsigned transaction for the device to sign.
    pub fn create_transaction(
        &mut self,
        wallet_id: &str,
        to: &str,
        amount: u64,
    ) -> Result<String, HardwareWalletError> {
        if !self.wallets.contains_key(wallet_id) {
            return Err(HardwareWalletError::WalletNotFound);
        }
        if to.trim().is_empty() || amount == 0 {
            return Err(HardwareWalletError::InvalidParameters(
                "destination must be non-empty and amount non-zero".into(),
            ));
        }
        let tx_id = format!("TX_{}", self.transactions.len());
        self.transactions.insert(
            tx_id.clone(),
            Transaction {
                id: tx_id.clone(),
                wallet_id: wallet_id.to_string(),
                to: to.to_string(),
                amount,
                signed: false,
                signature: None,
            },
        );
        Ok(tx_id)
    }

    /// Sign a transaction on the device.
    ///
    /// Fails closed: the device handshake is required, so this returns
    /// DeviceUnavailable rather than a fabricated signature.
    pub fn sign_transaction(&mut self, tx_id: &str) -> Result<Vec<u8>, HardwareWalletError> {
        let tx = self
            .transactions
            .get(tx_id)
            .ok_or(HardwareWalletError::TransactionNotFound)?;
        if tx.signed {
            return Err(HardwareWalletError::AlreadySigned);
        }
        Err(HardwareWalletError::DeviceUnavailable)
    }

    pub fn get_wallet(&self, id: &str) -> Option<&HardwareWallet> {
        self.wallets.get(id)
    }

    pub fn get_transaction(&self, id: &str) -> Option<&Transaction> {
        self.transactions.get(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_requires_device_details() {
        let mut hw = HardwareWalletService::new();
        assert!(hw.register_wallet("", "SN1", "0xPK").is_err());
        assert!(hw.register_wallet("ledger", "", "0xPK").is_err());
        assert!(hw.register_wallet("ledger", "SN1", "").is_err());
    }

    #[test]
    fn unknown_wallet_cannot_build_a_transaction() {
        let mut hw = HardwareWalletService::new();
        assert!(matches!(
            hw.create_transaction("missing", "0xDEST", 1),
            Err(HardwareWalletError::WalletNotFound)
        ));
    }

    #[test]
    fn signing_fails_closed_without_the_device() {
        let mut hw = HardwareWalletService::new();
        let w = hw.register_wallet("ledger", "SN1", "0xPK").unwrap();
        let tx = hw.create_transaction(&w, "0xDEST", 1_000_000).unwrap();
        assert!(matches!(
            hw.sign_transaction(&tx),
            Err(HardwareWalletError::DeviceUnavailable)
        ));
        // The transaction must not be marked signed by a fabricated signature.
        assert!(!hw.get_transaction(&tx).unwrap().signed);
        assert!(hw.get_transaction(&tx).unwrap().signature.is_none());
    }
}

fn main() {
    let mut hw = HardwareWalletService::new();
    let wallet = hw.register_wallet("ledger", "SN12345", "0xPUBKEY").expect("register");
    println!("registered {}", wallet);
    let tx = hw.create_transaction(&wallet, "0xDEST", 1_000_000).expect("create");
    match hw.sign_transaction(&tx) {
        Ok(_) => println!("signed"),
        Err(e) => println!("refused: {}", e),
    }
}
