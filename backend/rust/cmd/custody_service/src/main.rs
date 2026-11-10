//! TigerEx Cold Wallet Security Infrastructure - Rust Implementation
//! Complete cold storage, multi-sig, HSM integration with high-level encryption

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use sha2::{Sha256, Sha512, Digest};
use sha3::Keccak256;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

// ============================================================================
// CRYPTOGRAPHIC TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub ciphertext: String,
    pub nonce: String,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub id: String,
    pub currency: String,
    pub address: String,
    pub public_key: String,
    pub address_type: String,
    pub chain: String,
    pub created_at: i64,
    pub status: String,
    pub is_cold: bool,
    pub multi_sig_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigConfig {
    pub config_id: String,
    pub threshold: i32,
    pub signers: Vec<SignerInfo>,
    pub created_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub signer_id: String,
    pub public_key: String,
    pub role: String,
    pub name: String,
    pub verified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub tx_id: String,
    pub currency: String,
    pub amount: String,
    pub from_address: String,
    pub to_address: String,
    pub fee: String,
    pub memo: Option<String>,
    pub signatures: Vec<SignatureData>,
    pub status: String,
    pub created_at: i64,
    pub approved_at: Option<i64>,
    pub executed_at: Option<i64>,
    pub tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureData {
    pub signer_id: String,
    pub signature: String,
    pub signed_at: i64,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HSMKey {
    pub key_id: String,
    pub public_key: String,
    pub key_type: String,
    pub algorithm: String,
    pub created_at: i64,
    pub status: String,
    pub rotation_policy: RotationPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationPolicy {
    pub auto_rotate: bool,
    pub rotation_days: i32,
    pub last_rotated: i64,
    pub next_rotation: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColdStorageConfig {
    pub config_id: String,
    pub hot_wallet_limit: String,
    pub cold_wallet_percentage: String,
    pub auto_top_up: bool,
    pub top_up_threshold: String,
    pub top_up_amount: String,
    pub max_daily_withdrawal: String,
    pub max_withdrawal_per_tx: String,
    pub approval_required: bool,
    pub approval_threshold: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub log_id: String,
    pub event_type: String,
    pub user_id: String,
    pub details: String,
    pub ip_address: String,
    pub timestamp: i64,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceFund {
    pub fund_id: String,
    pub total_assets: String,
    pub currency: String,
    pub coverage_amount: String,
    pub last_replenished: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalWhitelist {
    pub whitelist_id: String,
    pub user_id: String,
    pub addresses: Vec<WhitelistAddress>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhitelistAddress {
    pub address: String,
    pub currency: String,
    pub label: String,
    pub added_at: i64,
    pub is_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginAlert {
    pub alert_id: String,
    pub user_id: String,
    pub alert_type: String,
    pub message: String,
    pub timestamp: i64,
    pub acknowledged: bool,
}

// ============================================================================
// CRYPTOGRAPHIC SERVICE
// ============================================================================

pub struct CryptoService {
    master_key: [u8; 32],
}

impl CryptoService {
    pub fn new() -> Self {
        let mut master_key = [0u8; 32];
        OsRng.fill_bytes(&mut master_key);
        Self { master_key }
    }
    
    pub fn from_seed(seed: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(seed);
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&hasher.finalize());
        Self { master_key }
    }
    
    /// AES-256-GCM Encryption
    pub fn encrypt(&self, plaintext: &str) -> Result<EncryptedData, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption error: {}", e))?;
        
        Ok(EncryptedData {
            ciphertext: base64_encode(&ciphertext),
            nonce: base64_encode(&nonce_bytes),
            version: 1,
        })
    }
    
    /// AES-256-GCM Decryption
    pub fn decrypt(&self, data: &EncryptedData) -> Result<String, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        
        let ciphertext = base64_decode(&data.ciphertext)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        
        let nonce_bytes = base64_decode(&data.nonce)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        
        if nonce_bytes.len() != 12 {
            return Err("Invalid nonce length".to_string());
        }
        
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| format!("Decryption error: {}", e))?;
        
        String::from_utf8(plaintext)
            .map_err(|e| format!("UTF-8 error: {}", e))
    }
    
    /// Generate an ED25519 signing key pair.
    ///
    /// Returns (private key, public key), both base64 encoded.
    pub fn generate_keypair(&self) -> (String, String) {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let signing_key = SigningKey::from_bytes(&secret);
        let verifying_key = signing_key.verifying_key();
        
        (base64_encode(&signing_key.to_bytes()),
         base64_encode(&verifying_key.to_bytes()))
    }
    
    /// Sign Data
    pub fn sign(&self, data: &str, private_key: &str) -> Result<String, String> {
        let key_bytes = base64_decode(private_key)
            .map_err(|e| format!("Key decode error: {}", e))?;
        
        if key_bytes.len() != 32 {
            return Err("Invalid key length".to_string());
        }
        
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);
        
        let signing_key = SigningKey::from_bytes(&key_array);
        let signature = signing_key.sign(data.as_bytes());
        
        Ok(base64_encode(&signature.to_bytes()))
    }
    
    /// Verify Signature
    pub fn verify(&self, data: &str, signature: &str, public_key: &str) -> bool {
        let sig_bytes = match base64_decode(signature) {
            Ok(b) => b,
            Err(_) => return false,
        };
        
        let key_bytes = match base64_decode(public_key) {
            Ok(b) => b,
            Err(_) => return false,
        };
        
        if key_bytes.len() != 32 || sig_bytes.len() != 64 {
            return false;
        }
        
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);
        
        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        
        let verifying_key = match VerifyingKey::from_bytes(&key_array) {
            Ok(k) => k,
            Err(_) => return false,
        };
        
        let signature = Signature::from_bytes(&sig_array);
        
        verifying_key.verify(data.as_bytes(), &signature).is_ok()
    }
    
    /// SHA-256 Hash
    pub fn sha256(&self, data: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// SHA-512 Hash
    pub fn sha512(&self, data: &str) -> String {
        let mut hasher = Sha512::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// Keccak256 Hash
    pub fn keccak256(&self, data: &str) -> String {
        let mut hasher = Keccak256::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// Generate Secure Random
    pub fn generate_random(&self, length: usize) -> Vec<u8> {
        let mut buffer = vec![0u8; length];
        OsRng.fill_bytes(&mut buffer);
        buffer
    }
    
    /// Derive a key from a password with Argon2id (RFC 9106), the same
    /// memory-hard KDF used for password storage. It replaces the previous
    /// iterated-SHA-256 construction, which was not a real KDF and left
    /// passphrases cheap to brute-force. The salt must be at least 8 bytes.
    pub fn derive_key(&self, password: &str, salt: &[u8], iterations: u32) -> Result<String, String> {
        if salt.len() < 8 {
            return Err("salt must be at least 8 bytes".to_string());
        }
        let params = Params::new(iterations.max(8), 3, 1, None)
            .map_err(|e| format!("invalid Argon2 parameters: {e}"))?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut output = [0u8; 32];
        argon
            .hash_password_into(password.as_bytes(), salt, &mut output)
            .map_err(|e| format!("key derivation failed: {e}"))?;
        Ok(hex_encode(&output))
    }

    /// Generate a BIP39 mnemonic from OS entropy, with the standard checksum.
    /// The previous version drew words from a truncated, duplicated word list
    /// and produced a phrase that no BIP39 wallet could import.
    pub fn generate_mnemonic(&self, word_count: usize) -> Result<String, String> {
        let mnemonic = bip39::Mnemonic::generate_in(bip39::Language::English, word_count)
            .map_err(|e| format!("mnemonic generation failed: {e}"))?;
        Ok(mnemonic.to_string())
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn generate_id(prefix: &str) -> String {
    format!("{}{}{}", prefix, current_timestamp(), uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.decode(data)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

fn hex_encode(data: impl AsRef<[u8]>) -> String {
    data.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(data: &str) -> Result<Vec<u8>, String> {
    (0..data.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&data[i..i+2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Hex decode error: {}", e))
}

// ============================================================================
// SECURITY SERVICE
// ============================================================================

pub struct SecurityService {
    pub crypto: CryptoService,
    pub wallet_addresses: RwLock<HashMap<String, WalletAddress>>,
    pub multi_sigs: RwLock<HashMap<String, MultiSigConfig>>,
    pub transactions: RwLock<HashMap<String, TransactionRequest>>,
    pub hsm_keys: RwLock<HashMap<String, HSMKey>>,
    pub cold_storage: RwLock<Option<ColdStorageConfig>>,
    pub audit_logs: RwLock<Vec<AuditLog>>,
    pub whitelists: RwLock<HashMap<String, WithdrawalWhitelist>>,
    pub login_alerts: RwLock<Vec<LoginAlert>>,
    pub insurance_fund: RwLock<Option<InsuranceFund>>,
}

impl SecurityService {
    pub fn new() -> Self {
        Self {
            crypto: CryptoService::new(),
            wallet_addresses: RwLock::new(HashMap::new()),
            multi_sigs: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            hsm_keys: RwLock::new(HashMap::new()),
            cold_storage: RwLock::new(None),
            audit_logs: RwLock::new(Vec::new()),
            whitelists: RwLock::new(HashMap::new()),
            login_alerts: RwLock::new(Vec::new()),
            insurance_fund: RwLock::new(None),
        }
    }
    
    /// Register a cold wallet address.
    ///
    /// Addresses are supplied by the operator, never generated here.
    pub async fn register_wallet_address(
        &self,
        address: WalletAddress,
    ) -> Result<(), String> {
        if address.id.trim().is_empty() || address.address.trim().is_empty() {
            return Err("wallet address id and address are required".to_string());
        }
        if !address.is_cold {
            return Err("only cold wallet addresses may be registered here".to_string());
        }

        let mut addresses = self.wallet_addresses.write().await;
        if addresses.contains_key(&address.id) {
            return Err(format!("wallet address {} already exists", address.id));
        }
        addresses.insert(address.id.clone(), address);
        Ok(())
    }

    /// Register a multi-signature configuration.
    pub async fn register_multisig(&self, config: MultiSigConfig) -> Result<(), String> {
        if config.threshold == 0 {
            return Err("threshold must be at least 1".to_string());
        }
        if config.threshold as usize > config.signers.len() {
            return Err("threshold cannot exceed the number of signers".to_string());
        }
        if config.signers.is_empty() {
            return Err("at least one signer is required".to_string());
        }
        if config.signers.iter().any(|s| s.public_key.trim().is_empty()) {
            return Err("every signer must have a public key".to_string());
        }

        let mut multi_sigs = self.multi_sigs.write().await;
        if multi_sigs.contains_key(&config.config_id) {
            return Err(format!("multisig {} already exists", config.config_id));
        }
        multi_sigs.insert(config.config_id.clone(), config);
        Ok(())
    }

    /// Set the cold storage policy.
    pub async fn set_cold_storage_config(&self, config: ColdStorageConfig) -> Result<(), String> {
        if config.approval_threshold == 0 {
            return Err("approval_threshold must be at least 1".to_string());
        }
        *self.cold_storage.write().await = Some(config);
        Ok(())
    }

    /// Set the insurance fund record. The balance is reported by the treasury,
    /// not invented here.
    pub async fn set_insurance_fund(&self, fund: InsuranceFund) -> Result<(), String> {
        if fund.total_assets.trim().is_empty() {
            return Err("insurance fund total_assets is required".to_string());
        }
        *self.insurance_fund.write().await = Some(fund);
        Ok(())
    }

    // ========================================================================
    // COLD WALLET OPERATIONS
    // ========================================================================
    
    pub async fn get_cold_wallet_address(&self, currency: &str) -> Option<WalletAddress> {
        let addresses = self.wallet_addresses.read().await;
        for (_, addr) in addresses.iter() {
            if addr.currency == currency.to_uppercase() && addr.is_cold {
                return Some(addr.clone());
            }
        }
        None
    }
    
    pub async fn create_transaction(&self, currency: &str, amount: &str, to_address: &str, 
                              from_cold: bool) -> Result<TransactionRequest, String> {
        let tx_id = generate_id("TX");
        
        // Get from address
        let from_addr = self.get_cold_wallet_address(currency).await
            .ok_or_else(|| "Cold wallet not found".to_string())?;
        
        // Calculate fee
        let fee = match currency.to_uppercase().as_str() {
            "BTC" => "0.0005",
            "ETH" => "0.005",
            "USDT" | "USDC" => "1.0",
            _ => "0.0",
        };
        
        let tx = TransactionRequest {
            tx_id: tx_id.clone(),
            currency: currency.to_uppercase(),
            amount: amount.to_string(),
            from_address: from_addr.address,
            to_address: to_address.to_string(),
            fee: fee.to_string(),
            memo: None,
            signatures: Vec::new(),
            status: "pending".to_string(),
            created_at: current_timestamp(),
            approved_at: None,
            executed_at: None,
            tx_hash: None,
        };
        
        let mut transactions = self.transactions.write().await;
        transactions.insert(tx_id.clone(), tx.clone());
        
        self.log_audit("CREATE_TRANSACTION", &tx.from_address, 
                    &format!("Created {} transaction for {}", amount, currency),
                    "0.0.0.0", "success").await;
        
        Ok(tx)
    }
    
    pub async fn sign_transaction(&self, tx_id: &str, signer_id: &str, 
                              private_key: &str) -> Result<SignatureData, String> {
        let mut transactions = self.transactions.write().await;
        
        let tx = transactions.get_mut(tx_id)
            .ok_or_else(|| "Transaction not found".to_string())?;
        
        if tx.status != "pending" {
            return Err("Transaction is not pending".to_string());
        }
        
        // Create signature data
        let data_to_sign = format!("{}{}{}{}{}", tx.currency, tx.amount, 
                                tx.from_address, tx.to_address, tx_id);
        
        let signature = self.crypto.sign(&data_to_sign, private_key)?;
        
        let sig_data = SignatureData {
            signer_id: signer_id.to_string(),
            signature: signature.clone(),
            signed_at: current_timestamp(),
            public_key: "".to_string(),
        };
        
        tx.signatures.push(sig_data.clone());
        
        // Check if we have enough signatures
        let config = self.multi_sigs.read().await;
        if let Some(cfg) = config.get(&format!("multisig-{}-001", tx.currency.to_lowercase())) {
            if tx.signatures.len() >= cfg.threshold as usize {
                tx.status = "approved".to_string();
                tx.approved_at = Some(current_timestamp());
            }
        }
        
        self.log_audit("SIGN_TRANSACTION", signer_id,
                    &format!("Signed transaction {}", tx_id),
                    "0.0.0.0", "success").await;
        
        Ok(sig_data)
    }
    
    pub async fn execute_transaction(&self, tx_id: &str) -> Result<String, String> {
        let mut transactions = self.transactions.write().await;
        
        let tx = transactions.get_mut(tx_id)
            .ok_or_else(|| "Transaction not found".to_string())?;
        
        if tx.status != "approved" {
            return Err("Transaction not approved".to_string());
        }
        
        // Generate tx hash
        let tx_hash = self.crypto.keccak256(&format!("{}{}{}{}{}", tx.currency, tx.amount,
                                                   tx.from_address, tx.to_address, tx_id));
        
        tx.tx_hash = Some(tx_hash.clone());
        tx.executed_at = Some(current_timestamp());
        tx.status = "executed".to_string();
        
        self.log_audit("EXECUTE_TRANSACTION", &tx.from_address,
                    &format!("Executed transaction {} for {}", tx_id, tx.amount),
                    "0.0.0.0", "success").await;
        
        Ok(tx_hash)
    }
    
    // ========================================================================
    // WHITELIST MANAGEMENT
    // ========================================================================
    
    pub async fn add_whitelist_address(&self, user_id: &str, address: &str, 
                                   currency: &str, label: &str) -> Result<(), String> {
        let mut whitelists = self.whitelists.write().await;
        
        let entry = whitelists.entry(user_id.to_string()).or_insert_with(|| {
            WithdrawalWhitelist {
                whitelist_id: generate_id("WL"),
                user_id: user_id.to_string(),
                addresses: Vec::new(),
                created_at: current_timestamp(),
                updated_at: current_timestamp(),
            }
        });
        
        entry.addresses.push(WhitelistAddress {
            address: address.to_string(),
            currency: currency.to_uppercase(),
            label: label.to_string(),
            added_at: current_timestamp(),
            is_verified: false,
        });
        
        entry.updated_at = current_timestamp();
        
        self.log_audit("ADD_WHITELIST", user_id,
                    &format!("Added whitelist address for {}", currency),
                    "0.0.0.0", "success").await;
        
        Ok(())
    }
    
    pub async fn is_whitelisted(&self, user_id: &str, address: &str, currency: &str) -> bool {
        let whitelists = self.whitelists.read().await;
        
        if let Some(list) = whitelists.get(user_id) {
            return list.addresses.iter().any(|a| {
                a.address == address && a.currency == currency.to_uppercase()
            });
        }
        
        false
    }
    
    // ========================================================================
    // LOGIN ALERTS
    // ========================================================================
    
    pub async fn create_login_alert(&self, user_id: &str, alert_type: &str, 
                                 message: &str) -> LoginAlert {
        let alert = LoginAlert {
            alert_id: generate_id("ALERT"),
            user_id: user_id.to_string(),
            alert_type: alert_type.to_string(),
            message: message.to_string(),
            timestamp: current_timestamp(),
            acknowledged: false,
        };
        
        let mut alerts = self.login_alerts.write().await;
        alerts.push(alert.clone());
        
        alert
    }
    
    pub async fn get_login_alerts(&self, user_id: &str) -> Vec<LoginAlert> {
        let alerts = self.login_alerts.read().await;
        alerts.iter()
            .filter(|a| a.user_id == user_id && !a.acknowledged)
            .cloned()
            .collect()
    }
    
    pub async fn acknowledge_alert(&self, alert_id: &str) -> Result<(), String> {
        let mut alerts = self.login_alerts.write().await;
        
        for alert in alerts.iter_mut() {
            if alert.alert_id == alert_id {
                alert.acknowledged = true;
                return Ok(());
            }
        }
        
        Err("Alert not found".to_string())
    }
    
    // ========================================================================
    // AUDIT LOGGING
    // ========================================================================
    
    pub async fn log_audit(&self, event_type: &str, user_id: &str, 
                         details: &str, ip_address: &str, result: &str) {
        let log = AuditLog {
            log_id: generate_id("AUDIT"),
            event_type: event_type.to_string(),
            user_id: user_id.to_string(),
            details: details.to_string(),
            ip_address: ip_address.to_string(),
            timestamp: current_timestamp(),
            result: result.to_string(),
        };
        
        let mut logs = self.audit_logs.write().await;
        logs.push(log);
    }
    
    pub async fn get_audit_logs(&self, user_id: &str) -> Vec<AuditLog> {
        let logs = self.audit_logs.read().await;
        logs.iter()
            .filter(|l| l.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // HSM OPERATIONS
    // ========================================================================
    
    pub async fn generate_hsm_key(&self, key_type: &str) -> HSMKey {
        let (private_key, public_key) = self.crypto.generate_keypair();
        
        let key = HSMKey {
            key_id: generate_id("HSM"),
            public_key: public_key.clone(),
            key_type: key_type.to_string(),
            algorithm: "ED25519".to_string(),
            created_at: current_timestamp(),
            status: "active".to_string(),
            rotation_policy: RotationPolicy {
                auto_rotate: true,
                rotation_days: 90,
                last_rotated: current_timestamp(),
                next_rotation: current_timestamp() + (90 * 86400000),
            },
        };
        
        let mut keys = self.hsm_keys.write().await;
        keys.insert(key.key_id.clone(), key.clone());
        
        key
    }
    
    // ========================================================================
    // ENCRYPTION HELPERS
    // ========================================================================
    
    pub fn encrypt_data(&self, data: &str) -> Result<EncryptedData, String> {
        self.crypto.encrypt(data)
    }
    
    pub fn decrypt_data(&self, data: &EncryptedData) -> Result<String, String> {
        self.crypto.decrypt(data)
    }
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<(), String> {
    let service = SecurityService::new();

    // Cold storage policy comes from configuration, not from invented values.
    service
        .set_cold_storage_config(ColdStorageConfig {
            config_id: generate_id("COLD"),
            hot_wallet_limit: std::env::var("COLD_HOT_WALLET_LIMIT")
                .map_err(|_| "COLD_HOT_WALLET_LIMIT must be set".to_string())?,
            cold_wallet_percentage: std::env::var("COLD_WALLET_PERCENTAGE")
                .map_err(|_| "COLD_WALLET_PERCENTAGE must be set".to_string())?,
            auto_top_up: true,
            top_up_threshold: std::env::var("COLD_TOP_UP_THRESHOLD")
                .map_err(|_| "COLD_TOP_UP_THRESHOLD must be set".to_string())?,
            top_up_amount: std::env::var("COLD_TOP_UP_AMOUNT")
                .map_err(|_| "COLD_TOP_UP_AMOUNT must be set".to_string())?,
            max_daily_withdrawal: std::env::var("COLD_MAX_DAILY_WITHDRAWAL")
                .map_err(|_| "COLD_MAX_DAILY_WITHDRAWAL must be set".to_string())?,
            max_withdrawal_per_tx: std::env::var("COLD_MAX_WITHDRAWAL_PER_TX")
                .map_err(|_| "COLD_MAX_WITHDRAWAL_PER_TX must be set".to_string())?,
            approval_required: true,
            approval_threshold: std::env::var("COLD_APPROVAL_THRESHOLD")
                .map_err(|_| "COLD_APPROVAL_THRESHOLD must be set".to_string())?
                .parse()
                .map_err(|_| "COLD_APPROVAL_THRESHOLD must be a number".to_string())?,
        })
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tigerex_custody::Wallet;

    #[test]
    fn keypair_signs_and_verifies() {
        let crypto = CryptoService::new();
        let (private_key, public_key) = crypto.generate_keypair();

        let signature = crypto.sign("message", &private_key).unwrap();
        assert!(crypto.verify("message", &signature, &public_key));
        assert!(!crypto.verify("tampered", &signature, &public_key));
    }

    #[test]
    fn keypairs_are_unique() {
        let crypto = CryptoService::new();
        let (a, _) = crypto.generate_keypair();
        let (b, _) = crypto.generate_keypair();
        assert_ne!(a, b);
    }

    #[test]
    fn sign_rejects_a_bad_key() {
        let crypto = CryptoService::new();
        assert!(crypto.sign("message", "not-base64").is_err());
        assert!(crypto.sign("message", &base64_encode(&[0u8; 16])).is_err());
    }

    #[test]
    fn encryption_round_trips_and_hides_plaintext() {
        let crypto = CryptoService::new();
        let plaintext = "cold wallet secret material";

        let encrypted = crypto.encrypt(plaintext).unwrap();
        assert_ne!(encrypted.ciphertext, plaintext);
        assert_eq!(crypto.decrypt(&encrypted).unwrap(), plaintext);
    }

    #[test]
    fn encryption_uses_a_fresh_nonce() {
        let crypto = CryptoService::new();
        let first = crypto.encrypt("same input").unwrap();
        let second = crypto.encrypt("same input").unwrap();

        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn mnemonic_words_are_unique_per_call() {
        let crypto = CryptoService::new();
        let first = crypto.generate_mnemonic(12).unwrap();
        let second = crypto.generate_mnemonic(12).unwrap();

        assert_eq!(first.split_whitespace().count(), 12);
        assert_eq!(second.split_whitespace().count(), 12);
        assert_ne!(first, second);
    }

    #[test]
    fn generated_mnemonics_are_valid_bip39() {
        let crypto = CryptoService::new();
        // A BIP39 library parses the phrase only when the word list and
        // checksum are both correct, so this fails for the old fake generator.
        for count in [12usize, 24] {
            let phrase = crypto.generate_mnemonic(count).unwrap();
            assert!(bip39::Mnemonic::parse_in(bip39::Language::English, &phrase).is_ok());
            assert_eq!(phrase.split_whitespace().count(), count);
        }
    }

    #[test]
    fn invalid_mnemonic_lengths_are_rejected() {
        let crypto = CryptoService::new();
        assert!(crypto.generate_mnemonic(13).is_err());
    }

    #[test]
    fn derive_key_is_argon2id_and_salt_sensitive() {
        let crypto = CryptoService::new();
        let salt_a = [1u8; 16];
        let salt_b = [2u8; 16];

        let a = crypto.derive_key("correct horse", &salt_a, 8).unwrap();
        let b = crypto.derive_key("correct horse", &salt_a, 8).unwrap();
        let c = crypto.derive_key("correct horse", &salt_b, 8).unwrap();

        // Deterministic for the same password and salt...
        assert_eq!(a, b);
        // ...but a different salt yields a different key.
        assert_ne!(a, c);
        // A short salt is refused rather than silently accepted.
        assert!(crypto.derive_key("pw", &[0u8; 4], 8).is_err());
    }

    #[tokio::test]
    async fn withdrawals_require_kyc_and_sufficient_balance() {
        let mut wallet = Wallet::new("u1");

        wallet.deposit("BTC", 1.0);
        // No KYC yet.
        assert!(!wallet.can_withdraw("BTC", 0.5));

        wallet.kyc_level = 2;
        assert!(wallet.can_withdraw("BTC", 1.0));

        // Insufficient funds: this check used to be unreachable.
        assert!(!wallet.can_withdraw("BTC", 1.5));
        assert!(!wallet.can_withdraw("BTC", 0.0));
        assert!(!wallet.can_withdraw("BTC", -1.0));
        assert!(!wallet.can_withdraw("DOGE", 1.0));

        wallet.blocked = true;
        assert!(!wallet.can_withdraw("BTC", 0.5));
    }

    #[tokio::test]
    async fn lower_kyc_assets_need_level_one() {
        let mut wallet = Wallet::new("u1");
        wallet.deposit("DOGE", 100.0);

        assert!(!wallet.can_withdraw("DOGE", 10.0));
        wallet.kyc_level = 1;
        assert!(wallet.can_withdraw("DOGE", 10.0));
    }

    #[tokio::test]
    async fn no_wallets_are_seeded_on_startup() {
        let service = SecurityService::new();
        assert!(service.get_cold_wallet_address("BTC").await.is_none());
        assert!(service.insurance_fund.read().await.is_none());
        assert!(service.cold_storage.read().await.is_none());
    }

    #[tokio::test]
    async fn wallet_registration_validates_input() {
        let service = SecurityService::new();

        let mut address = WalletAddress {
            id: "btc-cold-1".to_string(),
            currency: "BTC".to_string(),
            address: "bc1qreal".to_string(),
            public_key: "pub".to_string(),
            address_type: "native".to_string(),
            chain: "bitcoin".to_string(),
            created_at: current_timestamp(),
            status: "active".to_string(),
            is_cold: true,
            multi_sig_id: None,
        };

        service.register_wallet_address(address.clone()).await.unwrap();
        // Duplicate id.
        assert!(service.register_wallet_address(address.clone()).await.is_err());

        address.id = "btc-hot-1".to_string();
        address.is_cold = false;
        assert!(service.register_wallet_address(address).await.is_err());

        assert!(service.get_cold_wallet_address("BTC").await.is_some());
    }

    #[tokio::test]
    async fn multisig_threshold_is_enforced() {
        let service = SecurityService::new();

        let signers = vec![SignerInfo {
            signer_id: "s1".to_string(),
            public_key: "pk1".to_string(),
            role: "primary".to_string(),
            name: "Primary".to_string(),
            verified_at: current_timestamp(),
        }];

        let mut config = MultiSigConfig {
            config_id: "ms-1".to_string(),
            threshold: 0,
            signers: signers.clone(),
            created_at: current_timestamp(),
            status: "active".to_string(),
        };
        assert!(service.register_multisig(config.clone()).await.is_err());

        config.threshold = 2;
        assert!(service.register_multisig(config.clone()).await.is_err());

        config.threshold = 1;
        service.register_multisig(config.clone()).await.unwrap();
        assert!(service.register_multisig(config).await.is_err());
    }

    #[tokio::test]
    async fn cold_storage_config_requires_a_threshold() {
        let service = SecurityService::new();

        let config = ColdStorageConfig {
            config_id: "cold-1".to_string(),
            hot_wallet_limit: "100".to_string(),
            cold_wallet_percentage: "95".to_string(),
            auto_top_up: false,
            top_up_threshold: "50".to_string(),
            top_up_amount: "50".to_string(),
            max_daily_withdrawal: "1000".to_string(),
            max_withdrawal_per_tx: "100".to_string(),
            approval_required: true,
            approval_threshold: 0,
        };
        assert!(service.set_cold_storage_config(config).await.is_err());
    }
}
