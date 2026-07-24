// TigerEx Hardware Wallet Integration
// Built with Rust for security

use std::collections::HashMap;

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
    pub signature: Option<String>,
}

pub struct HardwareWalletService {
    wallets: HashMap<String, HardwareWallet>,
    transactions: HashMap<String, Transaction>,
}

impl HardwareWalletService {
    pub fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
        }
    }

    // Register hardware wallet
    pub fn register_wallet(&mut self, device_type: &str, serial: &str, pubkey: &str) -> String {
        let id = format!("HW_{}", self.wallets.len());
        
        let wallet = HardwareWallet {
            id: id.clone(),
            device_type: device_type.to_string(),
            serial: serial.to_string(),
            pubkey: pubkey.to_string(),
            status: "ACTIVE".to_string(),
        };
        
        self.wallets.insert(id.clone(), wallet);
        id
    }

    // Create transaction for signing
    pub fn create_transaction(&mut self, wallet_id: &str, to: &str, amount: u64) -> Option<String> {
        if !self.wallets.contains_key(wallet_id) {
            return None;
        }
        
        let tx_id = format!("TX_{}", self.transactions.len());
        let tx = Transaction {
            id: tx_id.clone(),
            wallet_id: wallet_id.to_string(),
            to: to.to_string(),
            amount,
            signed: false,
            signature: None,
        };
        
        self.transactions.insert(tx_id.clone(), tx);
        Some(tx_id)
    }

    // Sign transaction (simulated - in production, communicate with device)
    pub fn sign_transaction(&mut self, tx_id: &str) -> Option<String> {
        let tx = self.transactions.get_mut(tx_id)?;
        
        if tx.signed {
            return None;
        }
        
        // Simulate hardware signature
        let sig = format!("sig_{}_{}_{}", tx.wallet_id, tx.to, tx.amount);
        tx.signature = Some(sig.clone());
        tx.signed = true;
        
        Some(sig)
    }

    // Get wallet
    pub fn get_wallet(&self, id: &str) -> Option<&HardwareWallet> {
        self.wallets.get(id)
    }
}

fn main() {
    println!("TigerEx Hardware Wallet Service");
    
    let mut hw = HardwareWalletService::new();
    
    // Register wallet
    let wallet_id = hw.register_wallet("ledger", "SN12345", "0xPUBKEY");
    println!("Registered: {}", wallet_id);
    
    // Create transaction
    let tx_id = hw.create_transaction(&wallet_id, "0xDEST", 1000000).unwrap();
    println!("Created TX: {}", tx_id);
    
    // Sign
    let sig = hw.sign_transaction(&tx_id).unwrap();
    println!("Signed: {}", sig);
}
