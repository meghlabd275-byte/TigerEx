//! TigerEx Cold Wallet - Secure Multi-Sig Wallet Infrastructure
//! Built with Rust for maximum security
//! Features: Multi-signature, Hardware Security Module (HSM) integration, Cold storage

use std::collections::HashMap;
use ed25519_dalek::{Signature as Ed25519Signature, Signer, SigningKey, Verifier};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

// ============================================================================
// Cryptographic Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKey {
    pub key: String,
    pub key_type: KeyType,
    pub chain: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KeyType {
    Secp256k1,
    Ed25519,
    RSA2048,
    RSA4096,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub signer: String,
    pub signature: String,
    pub timestamp: i64,
}

// ============================================================================
// Wallet Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub id: String,
    pub address: String,
    pub chain: String,
    pub network: String,
    pub wallet_type: WalletType,
    pub created_at: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WalletType {
    Hot,
    Warm,
    Cold,
    Custody,
    MultiSig,
}

// ============================================================================
// Multi-Sig Wallet
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigWallet {
    pub id: String,
    pub name: String,
    pub threshold: u8,
    pub signers: Vec<String>,
    pub addresses: Vec<WalletAddress>,
    pub created_at: i64,
    pub status: WalletStatus,
}

impl MultiSigWallet {
    pub fn new(name: String, threshold: u8, signers: Vec<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            threshold,
            signers,
            addresses: Vec::new(),
            created_at: Utc::now().timestamp_millis(),
            status: WalletStatus::Active,
        }
    }

    /// Count only signatures from a registered signer, each signer at most
    /// once. A bare length check let one signer submit `threshold` signatures
    /// and satisfy a 3-of-5 policy single-handedly.
    #[inline]
    pub fn is_valid_threshold(&self, signatures: &[Signature]) -> bool {
        let mut seen: Vec<&str> = Vec::new();
        for sig in signatures {
            if !self.signers.iter().any(|s| s == &sig.signer) {
                continue;
            }
            if seen.contains(&sig.signer.as_str()) {
                continue;
            }
            seen.push(&sig.signer);
        }
        seen.len() >= self.threshold as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WalletStatus {
    Active,
    Frozen,
    Compromised,
    Decommissioned,
}

// ============================================================================
// Transaction
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub wallet_id: String,
    pub tx_type: TransactionType,
    pub from_address: String,
    pub to_address: String,
    pub amount: f64,
    pub fee: f64,
    pub asset: String,
    pub status: TransactionStatus,
    pub signatures: Vec<Signature>,
    pub tx_hash: Option<String>,
    pub created_at: i64,
    pub confirmed_at: Option<i64>,
    pub nonce: u64,
}

impl Transaction {
    pub fn new(
        wallet_id: String,
        tx_type: TransactionType,
        from_address: String,
        to_address: String,
        amount: f64,
        asset: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            wallet_id,
            tx_type,
            from_address,
            to_address,
            amount,
            fee: amount * 0.0001, // 0.01% fee
            asset,
            status: TransactionStatus::Pending,
            signatures: Vec::new(),
            tx_hash: None,
            created_at: Utc::now().timestamp_millis(),
            confirmed_at: None,
            nonce: 0,
        }
    }

    #[inline]
    pub fn add_signature(&mut self, signature: Signature) {
        // A signer contributes once; a repeated signature does not advance the
        // threshold.
        if !self.signatures.iter().any(|s| s.signer == signature.signer) {
            self.signatures.push(signature);
        }
    }

    /// Distinct signers that have signed this transaction.
    #[inline]
    pub fn distinct_signers(&self) -> usize {
        let mut seen: Vec<&str> = Vec::new();
        for sig in &self.signatures {
            if !seen.contains(&sig.signer.as_str()) {
                seen.push(&sig.signer);
            }
        }
        seen.len()
    }

    #[inline]
    pub fn is_fully_signed(&self, threshold: u8) -> bool {
        self.distinct_signers() >= threshold as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    Transfer,
    Internal,
    CrossChain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Signing,
    Signed,
    Broadcasting,
    Confirmed,
    Failed,
    Cancelled,
}

// ============================================================================
// Cold Wallet Manager
// ============================================================================

pub struct ColdWalletManager {
    wallets: HashMap<String, MultiSigWallet>,
    transactions: HashMap<String, Transaction>,
    addresses: HashMap<String, WalletAddress>,
    pending_transactions: Vec<String>,
}

impl ColdWalletManager {
    pub fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
            addresses: HashMap::new(),
            pending_transactions: Vec::new(),
        }
    }

    /// Create multi-sig wallet.
    ///
    /// A threshold of zero (or one larger than the signer set) makes the wallet
    /// either trivially spendable or permanently unspendable, so both are
    /// rejected.
    #[inline]
    pub fn create_wallet(
        &mut self,
        name: String,
        threshold: u8,
        signers: Vec<String>,
    ) -> Result<MultiSigWallet, String> {
        if threshold == 0 {
            return Err("Threshold must be at least 1".to_string());
        }
        if signers.is_empty() {
            return Err("At least one signer is required".to_string());
        }
        if threshold as usize > signers.len() {
            return Err("Threshold cannot exceed the number of signers".to_string());
        }
        let wallet = MultiSigWallet::new(name, threshold, signers);
        self.wallets.insert(wallet.id.clone(), wallet.clone());
        Ok(wallet)
    }

    /// Add address to wallet
    #[inline]
    pub fn add_address(
        &mut self,
        wallet_id: &str,
        address: String,
        chain: String,
        network: String,
    ) -> Result<WalletAddress, String> {
        let wallet = self.wallets.get_mut(wallet_id)
            .ok_or("Wallet not found")?;

        let wallet_address = WalletAddress {
            id: Uuid::new_v4().to_string(),
            address,
            chain,
            network,
            wallet_type: WalletType::Cold,
            created_at: Utc::now().timestamp_millis(),
            is_active: true,
        };

        wallet.addresses.push(wallet_address.clone());
        self.addresses
            .insert(wallet_address.id.clone(), wallet_address.clone());
        Ok(wallet_address)
    }

    /// Create withdrawal transaction
    #[inline]
    pub fn create_withdrawal(
        &mut self,
        wallet_id: &str,
        to_address: String,
        amount: f64,
        asset: String,
    ) -> Result<Transaction, String> {
        if amount <= 0.0 {
            return Err("Amount must be positive".to_string());
        }
        let wallet = self.wallets.get(wallet_id)
            .ok_or("Wallet not found")?;

        let from_address = wallet.addresses.first()
            .ok_or("No addresses in wallet")?
            .address.clone();

        let tx = Transaction::new(
            wallet_id.to_string(),
            TransactionType::Withdrawal,
            from_address,
            to_address,
            amount,
            asset,
        );

        let tx_id = tx.id.clone();
        self.transactions.insert(tx_id.clone(), tx.clone());
        self.pending_transactions.push(tx_id);

        Ok(tx)
    }

    /// Sign transaction
    #[inline]
    pub fn sign_transaction(
        &mut self,
        tx_id: &str,
        signer: String,
        signature: String,
    ) -> Result<Transaction, String> {
        let wallet_id = self
            .transactions
            .get(tx_id)
            .ok_or("Transaction not found")?
            .wallet_id
            .clone();
        // A signature is only meaningful from a signer registered on the wallet.
        if !self
            .wallets
            .get(&wallet_id)
            .map(|w| w.signers.iter().any(|s| s == &signer))
            .unwrap_or(false)
        {
            return Err("Signer is not authorised on this wallet".to_string());
        }

        let tx = self.transactions.get_mut(tx_id)
            .ok_or("Transaction not found")?;

        let sig = Signature {
            signer,
            signature,
            timestamp: Utc::now().timestamp_millis(),
        };

        tx.add_signature(sig);

        Ok(tx.clone())
    }

    /// Mark a transaction broadcast once it carries a valid threshold of
    /// signatures and the caller supplies the real broadcast hash.
    ///
    /// This previously invented a transaction hash with `Uuid::new_v4()`, which
    /// made a transaction that was never broadcast look like a real on-chain
    /// transaction. The hash must now come from the broadcaster.
    #[inline]
    pub fn execute_transaction(
        &mut self,
        tx_id: &str,
        broadcast_hash: &str,
    ) -> Result<Transaction, String> {
        if broadcast_hash.trim().is_empty() {
            return Err("A broadcast hash is required".to_string());
        }
        let wallet_id = self
            .transactions
            .get(tx_id)
            .ok_or("Transaction not found")?
            .wallet_id
            .clone();
        let threshold_ok = {
            let wallet = self.wallets.get(&wallet_id).ok_or("Wallet not found")?;
            let tx = self.transactions.get(tx_id).ok_or("Transaction not found")?;
            wallet.is_valid_threshold(&tx.signatures)
        };
        if !threshold_ok {
            return Err("Insufficient distinct signer signatures".to_string());
        }

        let tx = self.transactions.get_mut(tx_id)
            .ok_or("Transaction not found")?;
        tx.status = TransactionStatus::Signed;
        tx.tx_hash = Some(broadcast_hash.to_string());

        Ok(tx.clone())
    }

    /// Get wallet balance
    #[inline]
    pub fn get_balance(&self, wallet_id: &str) -> HashMap<String, f64> {
        let mut balances = HashMap::new();

        for tx in self.transactions.values() {
            if tx.wallet_id == wallet_id {
                let entry = balances.entry(tx.asset.clone()).or_insert(0.0);

                match tx.status {
                    TransactionStatus::Confirmed => {
                        match tx.tx_type {
                            TransactionType::Deposit | TransactionType::Transfer => {
                                *entry += tx.amount;
                            }
                            TransactionType::Withdrawal => {
                                *entry -= tx.amount + tx.fee;
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }

        balances
    }
}

// ============================================================================
// Hardware Security Module (HSM) Interface
// ============================================================================

pub struct HSMInterface {
    keys: HashMap<String, SigningKey>,
}

impl HSMInterface {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    /// Generate an Ed25519 key inside the HSM and return its public key. The
    /// private half never leaves the interface: only the public key is
    /// returned, so key material cannot be serialized into a response or log.
    #[inline]
    pub fn generate_key(&mut self, key_type: KeyType, chain: String) -> PublicKey {
        let signing_key = SigningKey::generate(&mut OsRng);
        let public = signing_key.verifying_key().to_bytes();
        let key_id = hex::encode(public);
        self.keys.insert(key_id, signing_key);

        PublicKey {
            key: format!("0x{}", hex::encode(public)),
            key_type,
            chain,
        }
    }

    /// Sign a message with the key held under `key_id`.
    ///
    /// This previously returned the fabricated string
    /// `signature_for_<message>` for any known key, which is not a signature at
    /// all and cannot be verified. An unknown key fails closed.
    #[inline]
    pub fn sign(&self, key_id: &str, message: &[u8]) -> Result<String, String> {
        let signing_key = self.keys.get(key_id).ok_or("Key not found in HSM")?;
        Ok(hex::encode(signing_key.sign(message).to_bytes()))
    }

    /// Verify an Ed25519 signature over `message` with the key `key_id`.
    ///
    /// This previously returned `true` for any message once the key id was
    /// known, which accepted a forged signature. It now performs a real
    /// verification and returns `false` on any malformed input.
    #[inline]
    pub fn verify(&self, key_id: &str, message: &[u8], signature: &str) -> bool {
        let signing_key = match self.keys.get(key_id) {
            Some(key) => key,
            None => return false,
        };
        let raw = match hex::decode(signature) {
            Ok(raw) => raw,
            Err(_) => return false,
        };
        let sig = match Ed25519Signature::from_slice(&raw) {
            Ok(sig) => sig,
            Err(_) => return false,
        };
        signing_key.verifying_key().verify(message, &sig).is_ok()
    }
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    println!("TigerEx Cold Wallet Security System v1.0");
    println!("Built with Rust for maximum security");
    println!();

    // Create wallet manager
    let mut manager = ColdWalletManager::new();

    // Create multi-sig cold wallet
    let wallet = manager
        .create_wallet(
            "Main Cold Wallet".to_string(),
            3, // Require 3 of 5 signatures
            vec![
                "signer1".to_string(),
                "signer2".to_string(),
                "signer3".to_string(),
                "signer4".to_string(),
                "signer5".to_string(),
            ],
        )
        .expect("wallet creation must succeed for a valid threshold");

    println!("Created wallet: {} (threshold: {})", wallet.name, wallet.threshold);

    // Add addresses
    let _ = manager.add_address(
        &wallet.id,
        "0x742d35Cc6634C0532925a3b844Bc9e7595f".to_string(),
        "Ethereum".to_string(),
        "mainnet".to_string(),
    );

    // Create withdrawal
    let tx = manager
        .create_withdrawal(
            &wallet.id,
            "0x8Ba1f109551bD432803012645Ac136ddd64DBA72".to_string(),
            10.0,
            "USDT".to_string(),
        )
        .unwrap();

    println!(
        "Created transaction: {} (amount: {} {})",
        tx.id, tx.amount, tx.asset
    );

    // Sign transaction
    let _ = manager.sign_transaction(&tx.id, "signer1".to_string(), "sig1".to_string());
    let _ = manager.sign_transaction(&tx.id, "signer2".to_string(), "sig2".to_string());
    let _ = manager.sign_transaction(&tx.id, "signer3".to_string(), "sig3".to_string());

    // Execute when threshold reached. The broadcast hash is supplied by the
    // broadcaster; the wallet never invents one.
    let tx = manager
        .execute_transaction(&tx.id, "0x0000000000000000000000000000000000000000000000000000000000000000")
        .unwrap();
    println!("Executed transaction: {} (hash: {:?})", tx.id, tx.tx_hash);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wallet_with(threshold: u8) -> ColdWalletManager {
        let mut manager = ColdWalletManager::new();
        manager
            .create_wallet(
                "test".to_string(),
                threshold,
                vec!["a".to_string(), "b".to_string(), "c".to_string()],
            )
            .unwrap();
        manager
    }

    // The old verify() returned true for any signature once the key id was
    // known. A forged signature must now be rejected.
    #[test]
    fn hsm_rejects_a_forged_signature() {
        let mut hsm = HSMInterface::new();
        let key = hsm.generate_key(KeyType::Ed25519, "Ethereum".to_string());
        let key_id = key.key.trim_start_matches("0x").to_string();

        let good = hsm.sign(&key_id, b"withdraw 10 USDT").unwrap();
        assert!(hsm.verify(&key_id, b"withdraw 10 USDT", &good));
        assert!(!hsm.verify(&key_id, b"withdraw 999 USDT", &good));
        assert!(!hsm.verify(&key_id, b"withdraw 10 USDT", "deadbeef"));
        assert!(!hsm.verify("unknown-key", b"x", &good));
    }

    // A 3-of-5 policy must not be satisfied by one signer signing three times.
    #[test]
    fn threshold_counts_distinct_registered_signers() {
        let wallet = MultiSigWallet::new(
            "w".to_string(),
            3,
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
        );
        let repeated: Vec<Signature> = (0..3)
            .map(|i| Signature {
                signer: "a".to_string(),
                signature: format!("sig{i}"),
                timestamp: 0,
            })
            .collect();
        assert!(!wallet.is_valid_threshold(&repeated));

        let distinct: Vec<Signature> = ["a", "b", "c"]
            .iter()
            .map(|s| Signature {
                signer: s.to_string(),
                signature: "sig".to_string(),
                timestamp: 0,
            })
            .collect();
        assert!(wallet.is_valid_threshold(&distinct));

        let unregistered: Vec<Signature> = ["a", "b", "stranger"]
            .iter()
            .map(|s| Signature {
                signer: s.to_string(),
                signature: "sig".to_string(),
                timestamp: 0,
            })
            .collect();
        assert!(!wallet.is_valid_threshold(&unregistered));
    }

    #[test]
    fn an_unsatisfiable_threshold_is_rejected() {
        let mut manager = ColdWalletManager::new();
        assert!(manager
            .create_wallet("x".to_string(), 4, vec!["a".to_string(), "b".to_string()])
            .is_err());
        assert!(manager
            .create_wallet("x".to_string(), 0, vec!["a".to_string()])
            .is_err());
    }

    #[test]
    fn execute_requires_a_real_broadcast_hash() {
        let mut manager = wallet_with(2);
        let wallet_id = manager.wallets.keys().next().unwrap().clone();
        manager
            .add_address(
                &wallet_id,
                "0xabc".to_string(),
                "Ethereum".to_string(),
                "mainnet".to_string(),
            )
            .unwrap();
        let tx = manager
            .create_withdrawal(&wallet_id, "0xdef".to_string(), 1.0, "USDT".to_string())
            .unwrap();
        let tx_id = tx.id.clone();

        // Not enough distinct signers yet.
        manager
            .sign_transaction(&tx_id, "a".to_string(), "s".to_string())
            .unwrap();
        assert!(manager.execute_transaction(&tx_id, "0xhash").is_err());

        // An empty broadcast hash is refused even with enough signatures.
        manager
            .sign_transaction(&tx_id, "b".to_string(), "s".to_string())
            .unwrap();
        assert!(manager.execute_transaction(&tx_id, "   ").is_err());

        let done = manager.execute_transaction(&tx_id, "0xrealhash").unwrap();
        assert_eq!(done.tx_hash.as_deref(), Some("0xrealhash"));
    }

    #[test]
    fn an_unauthorised_signer_is_refused() {
        let mut manager = wallet_with(2);
        let wallet_id = manager.wallets.keys().next().unwrap().clone();
        manager
            .add_address(
                &wallet_id,
                "0xabc".to_string(),
                "Ethereum".to_string(),
                "mainnet".to_string(),
            )
            .unwrap();
        let tx = manager
            .create_withdrawal(&wallet_id, "0xdef".to_string(), 1.0, "USDT".to_string())
            .unwrap();
        let tx_id = tx.id.clone();
        assert!(manager
            .sign_transaction(&tx_id, "stranger".to_string(), "s".to_string())
            .is_err());
    }
}
