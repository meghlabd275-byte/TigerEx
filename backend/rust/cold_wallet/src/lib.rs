//! TigerEx Cold Wallet - Production-Grade Multi-Signature Wallet
//! Ultra-secure cold storage with HSM integration, multi-signature support, and air-gapped operation

use std::collections::HashMap;

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use ripemd::Digest as _;
use sha2::{Digest, Sha256};
use thiserror::Error;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum ColdWalletError {
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),
    #[error("Insufficient signers: required {required}, got {got}")]
    InsufficientSigners { required: usize, got: usize },
    #[error("Duplicate signature")]
    DuplicateSignature,
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    #[error("Insufficient balance: available {available}, required {required}")]
    InsufficientBalance { available: f64, required: f64 },
    #[error("Transaction not found: {0}")]
    TransactionNotFound(String),
    #[error("Encryption error: {0}")]
    EncryptionError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("HSM error: {0}")]
    HSMError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
}

impl Serialize for ColdWalletError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MULTISIG_THRESHOLD_MIN: usize = 2;
const MULTISIG_THRESHOLD_MAX: usize = 10;
const MAX_SIGNERS: usize = 15;
const TRANSACTION_FEE_SATS: u64 = 1000;
const CONFIRMATION_BLOCKS: u32 = 6;

// ============================================================================
// CORE TYPES
// ============================================================================

/// Supported blockchain networks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Bitcoin,
    Ethereum,
    Solana,
    Polygon,
    BNBChain,
    Avalanche,
    Arbitrum,
    Optimism,
}

impl Network {
    pub fn chain_id(&self) -> u64 {
        match self {
            Network::Bitcoin => 0,
            Network::Ethereum => 1,
            Network::Solana => 101,
            Network::Polygon => 137,
            Network::BNBChain => 56,
            Network::Avalanche => 43114,
            Network::Arbitrum => 42161,
            Network::Optimism => 10,
        }
    }

    pub fn decimals(&self) -> u8 {
        match self {
            Network::Bitcoin => 8,
            Network::Ethereum | Network::Solana | Network::Polygon | Network::BNBChain
            | Network::Avalanche | Network::Arbitrum | Network::Optimism => 18,
        }
    }

    pub fn confirmations(&self) -> u32 {
        match self {
            Network::Bitcoin => 6,
            Network::Ethereum => 12,
            Network::Solana => 32,
            Network::Polygon => 128,
            Network::BNBChain => 15,
            Network::Avalanche => 25,
            Network::Arbitrum => 12,
            Network::Optimism => 12,
        }
    }
}

impl std::fmt::Display for Network {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self {
            Network::Bitcoin => "bitcoin",
            Network::Ethereum => "ethereum",
            Network::Solana => "solana",
            Network::Polygon => "polygon",
            Network::BNBChain => "bnbchain",
            Network::Avalanche => "avalanche",
            Network::Arbitrum => "arbitrum",
            Network::Optimism => "optimism",
        };
        f.write_str(name)
    }
}

/// Wallet type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WalletType {
    /// Hot wallet - online, minimal funds
    Hot,
    /// Warm wallet - semi-online, moderate funds
    Warm,
    /// Cold wallet - offline, maximum security
    Cold,
    /// Archive - long-term storage
    Archive,
}

impl std::fmt::Display for WalletType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self {
            WalletType::Hot => "hot",
            WalletType::Warm => "warm",
            WalletType::Cold => "cold",
            WalletType::Archive => "archive",
        };
        f.write_str(name)
    }
}

/// Wallet status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WalletStatus {
    Active,
    Frozen,
    Compromised,
    Archived,
}

/// Transaction status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Pending,
    Signed,
    Broadcasting,
    Confirmed,
    Failed,
}

/// Signature status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureStatus {
    Unsigned,
    Signed,
    Verified,
}

/// Key usage type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyType {
    Master,
    Signing,
    Recovery,
    Audit,
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Public key information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKeyInfo {
    pub key_type: KeyType,
    pub key_id: String,
    pub public_key: Vec<u8>,
    pub verifier_public_key: Vec<u8>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub is_active: bool,
}

/// Signer information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub signer_id: String,
    pub name: String,
    pub public_keys: Vec<PublicKeyInfo>,
    pub threshold: usize,
    pub is_hsm: bool,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

/// Wallet address
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub network: Network,
    pub address: String,
    pub wallet_type: WalletType,
    pub balance: String,
    pub pending_balance: String,
    pub status: WalletStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Transaction input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub network: Network,
    pub from_address: String,
    pub to_address: String,
    pub amount: String,
    pub fee: Option<String>,
    pub nonce: Option<u64>,
    pub data: Option<String>,
    pub memo: Option<String>,
}

/// Transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub tx_id: String,
    pub network: Network,
    pub from_address: String,
    pub to_address: String,
    pub amount: String,
    pub fee: String,
    pub status: TransactionStatus,
    pub signatures: Vec<TransactionSignature>,
    pub tx_hash: Option<String>,
    pub block_hash: Option<String>,
    pub block_number: Option<u64>,
    pub confirmations: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Transaction signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionSignature {
    pub signer_id: String,
    pub signature: Vec<u8>,
    /// The exact bytes covered by `signature`. Stored so verification can
    /// recompute the signed digest instead of trusting the signature's
    /// presence, which is what a real cold-wallet threshold check requires.
    #[serde(default)]
    pub signed_payload: Vec<u8>,
    pub signed_at: i64,
    pub status: SignatureStatus,
}

/// Multi-signature configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigConfig {
    pub signers: Vec<SignerInfo>,
    pub threshold: usize,
    pub network: Network,
    pub address: String,
    pub created_at: i64,
}

/// Withdrawal request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub request_id: String,
    pub user_id: String,
    pub network: Network,
    pub to_address: String,
    pub amount: String,
    pub fee_level: String,
    pub status: WalletStatus,
    pub created_at: i64,
    pub approved_at: Option<i64>,
    pub processed_at: Option<i64>,
}

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub log_id: String,
    pub event_type: String,
    pub user_id: Option<String>,
    pub signer_id: Option<String>,
    pub tx_id: Option<String>,
    pub details: String,
    pub ip_address: Option<String>,
    pub created_at: i64,
}

/// Wallet configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub network: Network,
    pub wallet_type: WalletType,
    pub signers: Vec<SignerInfo>,
    pub threshold: usize,
    pub daily_limit: Option<String>,
    pub max_single_transaction: Option<String>,
    pub require_approval_for_large: Option<String>,
    pub hsm_enabled: bool,
    pub air_gapped: bool,
}

// ============================================================================
// CRYPTOGRAPHIC OPERATIONS
// ============================================================================

/// Generate a new signing key
pub fn generate_signing_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

/// Generate a new verifier key from signing key
pub fn generate_verifier_key(signing_key: &SigningKey) -> VerifyingKey {
    signing_key.verifying_key()
}

/// Sign data with a signing key
pub fn sign_data(signing_key: &SigningKey, data: &[u8]) -> Vec<u8> {
    let signature = signing_key.sign(data);
    signature.to_bytes().to_vec()
}

/// Verify a signature
pub fn verify_signature(verifier_key: &VerifyingKey, data: &[u8], signature: &[u8]) -> Result<(), ColdWalletError> {
    if signature.len() != 64 {
        return Err(ColdWalletError::InvalidSignature(
            "Signature must be 64 bytes".to_string(),
        ));
    }

    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);

    let signature = Signature::from_bytes(&sig_bytes);
    if verifier_key.verify(data, &signature).is_ok() {
        Ok(())
    } else {
        Err(ColdWalletError::InvalidSignature(
            "Signature verification failed".to_string(),
        ))
    }
}

/// Hash160 = RIPEMD160(SHA256(data)), the hash Bitcoin uses for P2PKH/P2SH.
fn hash160(data: &[u8]) -> [u8; 20] {
    use ripemd::Ripemd160;
    let sha = Sha256::digest(data);
    let ripe = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&ripe);
    out
}

/// Base58Check encoding: payload followed by the first four bytes of
/// SHA256(SHA256(payload)).
fn base58check(payload: &[u8]) -> String {
    let checksum = Sha256::digest(Sha256::digest(payload));
    let mut buf = payload.to_vec();
    buf.extend_from_slice(&checksum[..4]);
    base58::ToBase58::to_base58(buf.as_slice())
}

/// Encode a secp256k1 public key as the SEC1 compressed form Bitcoin uses.
fn compressed_pubkey(public_key: &[u8]) -> Result<secp256k1::PublicKey, ColdWalletError> {
    secp256k1::PublicKey::from_slice(public_key).map_err(|e| {
        ColdWalletError::InvalidSignature(format!("invalid secp256k1 public key: {e}"))
    })
}

/// EIP-55 mixed-case checksum for a 20-byte EVM address.
fn eip55(addr: &[u8; 20]) -> String {
    use sha3::{Digest as _, Keccak256};
    let lower = hex::encode(addr);
    let hash = Keccak256::digest(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, ch) in lower.chars().enumerate() {
        if ch.is_ascii_alphabetic() {
            let nibble = if i % 2 == 0 {
                hash[i / 2] >> 4
            } else {
                hash[i / 2] & 0x0f
            };
            if nibble >= 8 {
                out.push(ch.to_ascii_uppercase());
                continue;
            }
        }
        out.push(ch);
    }
    out
}

/// Derive the on-chain address that a public key actually controls.
///
/// The key material must match the network: secp256k1 SEC1 keys (33-byte
/// compressed or 65-byte uncompressed) for Bitcoin and the EVM chains, and a
/// 32-byte Ed25519 key for Solana. Anything else is rejected rather than
/// turned into a string that no key can spend.
pub fn derive_address(network: Network, public_key: &[u8]) -> Result<String, ColdWalletError> {
    match network {
        Network::Bitcoin => {
            let key = compressed_pubkey(public_key)?;
            let serialized = key.serialize();
            let mut payload = Vec::with_capacity(21);
            payload.push(0x00); // mainnet P2PKH
            payload.extend_from_slice(&hash160(&serialized));
            Ok(base58check(&payload))
        }
        Network::Ethereum
        | Network::Polygon
        | Network::BNBChain
        | Network::Avalanche
        | Network::Arbitrum
        | Network::Optimism => {
            use sha3::{Digest as _, Keccak256};
            let key = compressed_pubkey(public_key)?;
            let uncompressed = key.serialize_uncompressed();
            let hash = Keccak256::digest(&uncompressed[1..]);
            let mut addr = [0u8; 20];
            addr.copy_from_slice(&hash[12..]);
            Ok(eip55(&addr))
        }
        Network::Solana => {
            if public_key.len() != 32 {
                return Err(ColdWalletError::InvalidSignature(
                    "Solana address requires a 32-byte Ed25519 public key".to_string(),
                ));
            }
            Ok(base58::ToBase58::to_base58(public_key))
        }
    }
}

/// Derive a P2SH multi-signature address from the redeem script
/// `OP_m <pubkey>... OP_n OP_CHECKMULTISIG`.
///
/// Only Bitcoin is supported; the other networks have no equivalent native
/// script address, and returning a plausible-looking string for them would be
/// a fabricated address.
pub fn derive_multisig_address(
    network: Network,
    public_keys: &[Vec<u8>],
    threshold: usize,
) -> Result<String, ColdWalletError> {
    if network != Network::Bitcoin {
        return Err(ColdWalletError::InvalidSignature(
            "multi-signature script addresses are only defined for Bitcoin".to_string(),
        ));
    }
    if threshold == 0 || threshold > public_keys.len() || public_keys.len() > MAX_SIGNERS {
        return Err(ColdWalletError::InvalidSignature(
            "threshold must be between 1 and the number of signers".to_string(),
        ));
    }

    let mut script = Vec::new();
    script.push(0x50 + threshold as u8); // OP_1..OP_16
    for pk in public_keys {
        let key = compressed_pubkey(pk)?;
        let serialized = key.serialize();
        script.push(serialized.len() as u8);
        script.extend_from_slice(&serialized);
    }
    script.push(0x50 + public_keys.len() as u8);
    script.push(0xae); // OP_CHECKMULTISIG

    let mut payload = Vec::with_capacity(21);
    payload.push(0x05); // mainnet P2SH
    payload.extend_from_slice(&hash160(&script));
    Ok(base58check(&payload))
}

/// Hash transaction for signing
pub fn hash_transaction(tx: &TransactionRequest) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(tx.network.chain_id().to_string().as_bytes());
    hasher.update(tx.from_address.as_bytes());
    hasher.update(tx.to_address.as_bytes());
    hasher.update(tx.amount.as_bytes());
    if let Some(ref fee) = tx.fee {
        hasher.update(fee.as_bytes());
    }
    if let Some(ref nonce) = tx.nonce {
        hasher.update(nonce.to_string().as_bytes());
    }
    if let Some(ref data) = tx.data {
        hasher.update(data.as_bytes());
    }
    hasher.finalize().to_vec()
}

// ============================================================================
// MULTI-SIGNATURE OPERATIONS
// ============================================================================

/// Create a new multi-signature wallet
pub fn create_multisig_wallet(config: &WalletConfig) -> Result<MultiSigConfig, ColdWalletError> {
    // Validate threshold
    if config.threshold < MULTISIG_THRESHOLD_MIN {
        return Err(ColdWalletError::InvalidSignature(format!(
            "Threshold must be at least {}",
            MULTISIG_THRESHOLD_MIN
        )));
    }

    if config.threshold > config.signers.len() {
        return Err(ColdWalletError::InvalidSignature(format!(
            "Threshold {} exceeds signers {}",
            config.threshold,
            config.signers.len()
        )));
    }

    if config.signers.len() > MAX_SIGNERS {
        return Err(ColdWalletError::InvalidSignature(format!(
            "Maximum {} signers allowed",
            MAX_SIGNERS
        )));
    }

    // Derive the P2SH address for the m-of-n redeem script. The script is built
    // from one public key per signer, in signer order.
    let mut signer_keys: Vec<Vec<u8>> = Vec::with_capacity(config.signers.len());
    for signer in &config.signers {
        let pk = signer.public_keys.first().ok_or_else(|| {
            ColdWalletError::InvalidSignature(format!(
                "signer {} has no public key",
                signer.signer_id
            ))
        })?;
        signer_keys.push(pk.public_key.clone());
    }

    let address = derive_multisig_address(config.network, &signer_keys, config.threshold)?;

    let multisig = MultiSigConfig {
        signers: config.signers.clone(),
        threshold: config.threshold,
        network: config.network,
        address,
        created_at: Utc::now().timestamp(),
    };

    Ok(multisig)
}

/// Sign a multi-signature transaction
pub fn sign_transaction(
    tx: &mut Transaction,
    signer_id: &str,
    signing_key: &SigningKey,
    verifier_key: &VerifyingKey,
) -> Result<(), ColdWalletError> {
    // Check for duplicate signature
    for sig in &tx.signatures {
        if sig.signer_id == signer_id {
            return Err(ColdWalletError::DuplicateSignature);
        }
    }

    // Create transaction hash
    let tx_request = TransactionRequest {
        network: tx.network,
        from_address: tx.from_address.clone(),
        to_address: tx.to_address.clone(),
        amount: tx.amount.clone(),
        fee: Some(tx.fee.clone()),
        nonce: None,
        data: None,
        memo: None,
    };
    let data_to_sign = hash_transaction(&tx_request);

    // Sign the transaction
    let signature = sign_data(signing_key, &data_to_sign);

    // Verify our signature
    verify_signature(verifier_key, &data_to_sign, &signature)?;

    // Record the signature together with the exact payload it covers so the
    // threshold check can verify it cryptographically later.
    tx.signatures.push(TransactionSignature {
        signer_id: signer_id.to_string(),
        signature,
        signed_payload: data_to_sign,
        signed_at: Utc::now().timestamp(),
        status: SignatureStatus::Signed,
    });

    tx.updated_at = Utc::now().timestamp();

    Ok(())
}

/// Verify multi-signature transaction
pub fn verify_multisig(
    tx: &Transaction,
    multisig: &MultiSigConfig,
) -> Result<bool, ColdWalletError> {
    let mut valid_sigs = 0;

    // The signed digest must match what the transaction currently commits to.
    let expected_payload = hash_transaction(&TransactionRequest {
        network: tx.network,
        from_address: tx.from_address.clone(),
        to_address: tx.to_address.clone(),
        amount: tx.amount.clone(),
        fee: Some(tx.fee.clone()),
        nonce: None,
        data: None,
        memo: None,
    });

    for sig in &tx.signatures {
        if sig.status != SignatureStatus::Signed {
            continue;
        }

        // The signature must cover this exact transaction, not some other one.
        if sig.signed_payload != expected_payload {
            return Err(ColdWalletError::InvalidSignature(
                "signature payload does not match the transaction".to_string(),
            ));
        }

        // Find signer's public key
        for signer in &multisig.signers {
            if signer.signer_id != sig.signer_id {
                continue;
            }

            // Verify against each active signing key the signer holds.
            let mut verified = false;
            for pk in &signer.public_keys {
                if !pk.is_active || pk.key_type != KeyType::Signing {
                    continue;
                }

                let verifier = VerifyingKey::from_bytes(
                    &match <[u8; 32]>::try_from(pk.verifier_public_key.as_slice()) {
                        Ok(bytes) => bytes,
                        Err(_) => continue,
                    },
                )
                .map_err(|e| {
                    ColdWalletError::InvalidSignature(format!("malformed verifier key: {e}"))
                })?;

                if verify_signature(&verifier, &sig.signed_payload, &sig.signature).is_ok() {
                    verified = true;
                    break;
                }
            }

            if verified {
                valid_sigs += 1;
            }
        }
    }

    Ok(valid_sigs >= multisig.threshold)
}

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

/// Validate withdrawal request
pub fn validate_withdrawal(
    request: &WithdrawalRequest,
    wallet: &WalletAddress,
    config: &WalletConfig,
) -> Result<(), ColdWalletError> {
    // Check wallet status
    if wallet.status != WalletStatus::Active {
        return Err(ColdWalletError::InvalidAddress(format!(
            "Wallet is not active: {:?}",
            wallet.status
        )));
    }

    // Parse amounts
    let request_amount: f64 = request
        .amount
        .parse()
        .map_err(|_| ColdWalletError::InvalidAddress("Invalid amount".to_string()))?;

    let wallet_balance: f64 = wallet
        .balance
        .parse()
        .map_err(|_| ColdWalletError::InvalidAddress("Invalid balance".to_string()))?;

    // Check balance
    if wallet_balance < request_amount {
        return Err(ColdWalletError::InsufficientBalance {
            available: wallet_balance,
            required: request_amount,
        });
    }

    // Check daily limit
    if let Some(ref limit) = config.daily_limit {
        let limit_amount: f64 = limit
            .parse()
            .map_err(|_| ColdWalletError::InvalidAddress("Invalid limit".to_string()))?;
        if request_amount > limit_amount {
            return Err(ColdWalletError::InvalidAddress("Exceeds daily limit".to_string()));
        }
    }

    // Check max transaction
    if let Some(ref max) = config.max_single_transaction {
        let max_amount: f64 = max
            .parse()
            .map_err(|_| ColdWalletError::InvalidAddress("Invalid max".to_string()))?;
        if request_amount > max_amount {
            return Err(ColdWalletError::InvalidAddress(
                "Exceeds max transaction".to_string(),
            ));
        }
    }

    Ok(())
}

/// Create withdrawal transaction
pub fn create_withdrawal_transaction(
    request: &WithdrawalRequest,
    wallet: &WalletAddress,
    fee: u64,
) -> Transaction {
    let tx_id = format!(
        "tx_{}_{}_{}",
        request.network as u8,
        request.user_id,
        Utc::now().timestamp_millis()
    );

    Transaction {
        tx_id,
        network: request.network,
        from_address: wallet.address.clone(),
        to_address: request.to_address.clone(),
        amount: request.amount.clone(),
        fee: fee.to_string(),
        status: TransactionStatus::Pending,
        signatures: Vec::new(),
        tx_hash: None,
        block_hash: None,
        block_number: None,
        confirmations: 0,
        created_at: request.created_at,
        updated_at: request.created_at,
    }
}

// ============================================================================
// ENCRYPTION
// ============================================================================

/// Encrypt sensitive data
pub fn encrypt_data(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, ColdWalletError> {
    if key.len() != 32 {
        return Err(ColdWalletError::EncryptionError(
            "Key must be 32 bytes".to_string(),
        ));
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| ColdWalletError::EncryptionError(e.to_string()))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| ColdWalletError::EncryptionError(e.to_string()))?;

    // Prepend nonce
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);

    Ok(result)
}

/// Decrypt sensitive data
pub fn decrypt_data(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, ColdWalletError> {
    if key.len() != 32 {
        return Err(ColdWalletError::EncryptionError(
            "Key must be 32 bytes".to_string(),
        ));
    }

    if ciphertext.len() < 12 {
        return Err(ColdWalletError::EncryptionError(
            "Ciphertext too short".to_string(),
        ));
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| ColdWalletError::EncryptionError(e.to_string()))?;

    let nonce = Nonce::from_slice(&ciphertext[..12]);
    let encrypted = &ciphertext[12..];

    cipher
        .decrypt(nonce, encrypted)
        .map_err(|e| ColdWalletError::EncryptionError(e.to_string()))
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/// Create audit log entry
pub fn create_audit_log(
    event_type: &str,
    details: &str,
    user_id: Option<&str>,
    signer_id: Option<&str>,
    tx_id: Option<&str>,
    ip_address: Option<&str>,
) -> AuditLog {
    let log_id = format!("log_{}_{}", event_type, Utc::now().timestamp_millis());

    AuditLog {
        log_id,
        event_type: event_type.to_string(),
        user_id: user_id.map(|s| s.to_string()),
        signer_id: signer_id.map(|s| s.to_string()),
        tx_id: tx_id.map(|s| s.to_string()),
        details: details.to_string(),
        ip_address: ip_address.map(|s| s.to_string()),
        created_at: Utc::now().timestamp(),
    }
}

// ============================================================================
// WALLET MANAGER
// ============================================================================

/// Cold wallet manager
pub struct ColdWalletManager {
    wallets: HashMap<String, WalletAddress>,
    transactions: HashMap<String, Transaction>,
    multisig_configs: HashMap<String, MultiSigConfig>,
    pending_withdrawals: HashMap<String, WithdrawalRequest>,
    audit_logs: Vec<AuditLog>,
}

impl ColdWalletManager {
    /// Create new wallet manager
    pub fn new() -> Self {
        ColdWalletManager {
            wallets: HashMap::new(),
            transactions: HashMap::new(),
            multisig_configs: HashMap::new(),
            pending_withdrawals: HashMap::new(),
            audit_logs: Vec::new(),
        }
    }

    /// Create new wallet address
    pub fn create_wallet(
        &mut self,
        network: Network,
        wallet_type: WalletType,
        public_keys: &[Vec<u8>],
    ) -> Result<WalletAddress, ColdWalletError> {
        // A single-signature wallet holds exactly one key. Multi-signature
        // wallets go through create_multisig_wallet so the address is the real
        // script address.
        if public_keys.len() != 1 {
            return Err(ColdWalletError::InvalidSignature(
                "single-signature wallet requires exactly one public key".to_string(),
            ));
        }
        let address = derive_address(network, &public_keys[0])?;

        let now = Utc::now().timestamp();
        let wallet = WalletAddress {
            network,
            address: address.clone(),
            wallet_type,
            balance: "0".to_string(),
            pending_balance: "0".to_string(),
            status: WalletStatus::Active,
            created_at: now,
            updated_at: now,
        };

        self.wallets.insert(address.clone(), wallet.clone());

        // Audit log
        self.audit_logs.push(create_audit_log(
            "wallet_created",
            &format!("Created {} wallet", wallet_type),
            None,
            None,
            None,
            None,
        ));

        Ok(wallet)
    }

    /// Process withdrawal request
    pub fn process_withdrawal(
        &mut self,
        request: WithdrawalRequest,
    ) -> Result<Transaction, ColdWalletError> {
        // Find wallet
        let wallet = self
            .wallets
            .get(&request.to_address)
            .ok_or_else(|| ColdWalletError::InvalidAddress("Wallet not found".to_string()))?;

        // Create config (in production, load from database)
        let config = WalletConfig {
            network: request.network,
            wallet_type: wallet.wallet_type,
            signers: Vec::new(),
            threshold: 2,
            daily_limit: None,
            max_single_transaction: None,
            require_approval_for_large: None,
            hsm_enabled: true,
            air_gapped: false,
        };

        // Validate
        validate_withdrawal(&request, wallet, &config)?;

        // Create transaction
        let tx = create_withdrawal_transaction(&request, wallet, TRANSACTION_FEE_SATS);

        let request_user_id = request.user_id.clone();
        self.transactions.insert(tx.tx_id.clone(), tx.clone());
        self.pending_withdrawals.insert(request.request_id.clone(), request);

        // Audit log
        self.audit_logs.push(create_audit_log(
            "withdrawal_requested",
            &format!("Requested {} {}", tx.amount, tx.network),
            Some(&request_user_id),
            None,
            Some(&tx.tx_id),
            None,
        ));

        Ok(tx)
    }

    /// Sign transaction
    pub fn sign_transaction(
        &mut self,
        tx_id: &str,
        signer_id: &str,
        signing_key: &SigningKey,
        verifier_key: &VerifyingKey,
    ) -> Result<Transaction, ColdWalletError> {
        let tx = self
            .transactions
            .get_mut(tx_id)
            .ok_or_else(|| ColdWalletError::TransactionNotFound(tx_id.to_string()))?;

        sign_transaction(tx, signer_id, signing_key, verifier_key)?;

        // Audit log
        self.audit_logs.push(create_audit_log(
            "transaction_signed",
            &format!("Transaction signed by {}", signer_id),
            None,
            Some(signer_id),
            Some(tx_id),
            None,
        ));

        Ok(tx.clone())
    }

    /// Get wallet by address
    pub fn get_wallet(&self, address: &str) -> Option<&WalletAddress> {
        self.wallets.get(address)
    }

    /// Get transaction by ID
    pub fn get_transaction(&self, tx_id: &str) -> Option<&Transaction> {
        self.transactions.get(tx_id)
    }

    /// Get pending withdrawals
    pub fn get_pending_withdrawals(&self) -> Vec<&WithdrawalRequest> {
        self.pending_withdrawals
            .values()
            .filter(|w| w.status == WalletStatus::Active)
            .collect()
    }

    /// Get audit logs
    pub fn get_audit_logs(&self, limit: usize) -> Vec<&AuditLog> {
        self.audit_logs.iter().take(limit).collect()
    }
}

impl Default for ColdWalletManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_and_verify() {
        let signing_key = generate_signing_key();
        let verifier_key = generate_verifier_key(&signing_key);

        let data = b"test transaction data";
        let signature = sign_data(&signing_key, data);

        assert!(verify_signature(&verifier_key, data, &signature).is_ok());
    }

    fn signing_signer(id: &str, key: &SigningKey) -> SignerInfo {
        SignerInfo {
            signer_id: id.to_string(),
            name: id.to_string(),
            public_keys: vec![PublicKeyInfo {
                key_type: KeyType::Signing,
                key_id: format!("{id}-key"),
                public_key: key.verifying_key().to_bytes().to_vec(),
                verifier_public_key: key.verifying_key().to_bytes().to_vec(),
                created_at: Utc::now().timestamp(),
                expires_at: None,
                is_active: true,
            }],
            threshold: 1,
            is_hsm: false,
            created_at: Utc::now().timestamp(),
            last_used_at: None,
        }
    }

    fn sample_transaction() -> Transaction {
        Transaction {
            tx_id: "tx-1".to_string(),
            network: Network::Bitcoin,
            from_address: "bc1qfrom".to_string(),
            to_address: "bc1qto".to_string(),
            amount: "100000".to_string(),
            fee: "1000".to_string(),
            status: TransactionStatus::Pending,
            signatures: Vec::new(),
            tx_hash: None,
            block_hash: None,
            block_number: None,
            confirmations: 0,
            created_at: Utc::now().timestamp(),
            updated_at: Utc::now().timestamp(),
        }
    }

    #[test]
    fn multisig_accepts_real_threshold_signatures() {
        let key1 = generate_signing_key();
        let key2 = generate_signing_key();
        let multisig = MultiSigConfig {
            signers: vec![
                signing_signer("signer1", &key1),
                signing_signer("signer2", &key2),
            ],
            threshold: 2,
            network: Network::Bitcoin,
            address: "bc1qmultisig".to_string(),
            created_at: Utc::now().timestamp(),
        };

        let mut tx = sample_transaction();
        sign_transaction(&mut tx, "signer1", &key1, &key1.verifying_key()).unwrap();
        assert!(!verify_multisig(&tx, &multisig).unwrap(), "one of two must not reach threshold");
        sign_transaction(&mut tx, "signer2", &key2, &key2.verifying_key()).unwrap();
        assert!(verify_multisig(&tx, &multisig).unwrap());
    }

    #[test]
    fn multisig_rejects_a_forged_signature() {
        let key1 = generate_signing_key();
        let key2 = generate_signing_key();
        let multisig = MultiSigConfig {
            signers: vec![
                signing_signer("signer1", &key1),
                signing_signer("signer2", &key2),
            ],
            threshold: 2,
            network: Network::Bitcoin,
            address: "bc1qmultisig".to_string(),
            created_at: Utc::now().timestamp(),
        };

        // A signature that carries the right payload but was produced by an
        // unrelated key must not count towards the threshold.
        let attacker = generate_signing_key();
        let mut tx = sample_transaction();
        sign_transaction(&mut tx, "signer1", &key1, &key1.verifying_key()).unwrap();
        let payload = tx.signatures[0].signed_payload.clone();
        tx.signatures.push(TransactionSignature {
            signer_id: "signer2".to_string(),
            signature: sign_data(&attacker, &payload),
            signed_payload: payload,
            signed_at: Utc::now().timestamp(),
            status: SignatureStatus::Signed,
        });

        assert!(!verify_multisig(&tx, &multisig).unwrap());
    }

    #[test]
    fn multisig_rejects_a_signature_bound_to_another_transaction() {
        let key1 = generate_signing_key();
        let key2 = generate_signing_key();
        let multisig = MultiSigConfig {
            signers: vec![
                signing_signer("signer1", &key1),
                signing_signer("signer2", &key2),
            ],
            threshold: 2,
            network: Network::Bitcoin,
            address: "bc1qmultisig".to_string(),
            created_at: Utc::now().timestamp(),
        };

        let mut tx = sample_transaction();
        sign_transaction(&mut tx, "signer1", &key1, &key1.verifying_key()).unwrap();
        sign_transaction(&mut tx, "signer2", &key2, &key2.verifying_key()).unwrap();
        assert!(verify_multisig(&tx, &multisig).unwrap());

        // Tampering with the amount must invalidate both signatures.
        tx.amount = "900000".to_string();
        assert!(verify_multisig(&tx, &multisig).is_err());
    }

    fn secp_public_key(secret: u8) -> Vec<u8> {
        let secp = secp256k1::Secp256k1::new();
        let mut bytes = [0u8; 32];
        bytes[31] = secret;
        let sk = secp256k1::SecretKey::from_slice(&bytes).unwrap();
        secp256k1::PublicKey::from_secret_key(&secp, &sk)
            .serialize()
            .to_vec()
    }

    #[test]
    fn test_multisig_wallet() {
        let key1 = secp_public_key(1);
        let key2 = secp_public_key(2);

        let config = WalletConfig {
            network: Network::Bitcoin,
            wallet_type: WalletType::Cold,
            signers: vec![
                SignerInfo {
                    signer_id: "signer1".to_string(),
                    name: "Signer 1".to_string(),
                    public_keys: vec![PublicKeyInfo {
                        key_type: KeyType::Signing,
                        key_id: "key1".to_string(),
                        public_key: key1.clone(),
                        verifier_public_key: key1.clone(),
                        created_at: Utc::now().timestamp(),
                        expires_at: None,
                        is_active: true,
                    }],
                    threshold: 1,
                    is_hsm: false,
                    created_at: Utc::now().timestamp(),
                    last_used_at: None,
                },
                SignerInfo {
                    signer_id: "signer2".to_string(),
                    name: "Signer 2".to_string(),
                    public_keys: vec![PublicKeyInfo {
                        key_type: KeyType::Signing,
                        key_id: "key2".to_string(),
                        public_key: key2.clone(),
                        verifier_public_key: key2.clone(),
                        created_at: Utc::now().timestamp(),
                        expires_at: None,
                        is_active: true,
                    }],
                    threshold: 1,
                    is_hsm: false,
                    created_at: Utc::now().timestamp(),
                    last_used_at: None,
                },
            ],
            threshold: 2,
            daily_limit: Some("1000000".to_string()),
            max_single_transaction: Some("100000".to_string()),
            require_approval_for_large: Some("50000".to_string()),
            hsm_enabled: true,
            air_gapped: true,
        };

        let multisig = create_multisig_wallet(&config).unwrap();
        // A 2-of-2 P2SH address on mainnet starts with '3'.
        assert!(multisig.address.starts_with('3'), "got {}", multisig.address);
        assert_eq!(multisig.threshold, 2);

        // The same keys must produce the same address, and a different
        // threshold a different one.
        let again = create_multisig_wallet(&config).unwrap();
        assert_eq!(multisig.address, again.address);

        // A different signer set must produce a different script address.
        let mut three_signers = config.clone();
        let key3 = secp_public_key(3);
        three_signers.signers.push(SignerInfo {
            signer_id: "signer3".to_string(),
            name: "Signer 3".to_string(),
            public_keys: vec![PublicKeyInfo {
                key_type: KeyType::Signing,
                key_id: "key3".to_string(),
                public_key: key3.clone(),
                verifier_public_key: key3,
                created_at: Utc::now().timestamp(),
                expires_at: None,
                is_active: true,
            }],
            threshold: 1,
            is_hsm: false,
            created_at: Utc::now().timestamp(),
            last_used_at: None,
        });
        let other = create_multisig_wallet(&three_signers).unwrap();
        assert_ne!(multisig.address, other.address);
    }

    #[test]
    fn p2pkh_matches_known_vector() {
        // Private key 1 on Bitcoin mainnet is the canonical P2PKH vector.
        let addr = derive_address(Network::Bitcoin, &secp_public_key(1)).unwrap();
        assert_eq!(addr, "1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH");
    }

    #[test]
    fn evm_address_matches_known_vector() {
        // Private key 1 on Ethereum, EIP-55 checksummed.
        let addr = derive_address(Network::Ethereum, &secp_public_key(1)).unwrap();
        assert_eq!(addr, "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    }

    #[test]
    fn solana_address_is_base58_of_the_key() {
        let addr = derive_address(Network::Solana, &[0u8; 32]).unwrap();
        assert_eq!(addr, "11111111111111111111111111111111");

        // A wrong-sized key must be rejected, not silently encoded.
        assert!(derive_address(Network::Solana, &[0u8; 20]).is_err());
    }

    #[test]
    fn derive_address_rejects_non_secp256k1_keys() {
        // 32 bytes that are not a valid secp256k1 public key encoding.
        assert!(derive_address(Network::Bitcoin, &[9u8; 32]).is_err());
    }

    #[test]
    fn test_encryption() {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);

        let plaintext = b"sensitive wallet data";
        let encrypted = encrypt_data(&key, plaintext).unwrap();
        let decrypted = decrypt_data(&key, &encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }
}