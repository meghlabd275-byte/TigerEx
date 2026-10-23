//! TigerEx Fiat Payment Gateway - Complete Rust Implementation
//! Supports SWIFT, SEPA, Card Payments, Apple Pay, Google Pay, and more

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};

// ============================================================================
// PAYMENT TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatAccount {
    pub account_id: String,
    pub user_id: String,
    pub currency: String,
    pub account_number: String,
    pub routing_number: Option<String>,
    pub iban: Option<String>,
    pub swift_code: Option<String>,
    pub bank_name: Option<String>,
    pub status: AccountStatus,
    pub verified_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum AccountStatus {
    Pending,
    Active,
    Suspended,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositRequest {
    pub deposit_id: String,
    pub user_id: String,
    pub currency: String,
    pub amount: f64,
    pub payment_method: PaymentMethod,
    pub status: TransactionStatus,
    pub created_at: i64,
    pub processed_at: Option<i64>,
    pub reference: String,
    pub proof_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub withdrawal_id: String,
    pub user_id: String,
    pub currency: String,
    pub amount: f64,
    pub fee: f64,
    pub net_amount: f64,
    pub payment_method: PaymentMethod,
    pub status: TransactionStatus,
    pub created_at: i64,
    pub processed_at: Option<i64>,
    pub reference: String,
    pub bank_reference: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum PaymentMethod {
    BankTransfer,
    Swift,
    Sepa,
    FasterPayments,
    Pix,
    Card,
    ApplePay,
    GooglePay,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub card_id: String,
    pub user_id: String,
    pub last_four: String,
    pub card_type: CardType,
    pub expiry_month: i32,
    pub expiry_year: i32,
    pub is_default: bool,
    pub status: CardStatus,
    pub created_at: i64,
    /// AES-256-GCM ciphertext of the card number.
    pub encrypted_number: String,
    /// AES-256-GCM ciphertext of the CVV.
    pub encrypted_cvv: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CardType {
    Visa,
    Mastercard,
    Amex,
    Discover,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CardStatus {
    Active,
    Expired,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentProvider {
    pub provider_id: String,
    pub name: String,
    pub provider_type: ProviderType,
    pub supported_currencies: Vec<String>,
    pub supported_methods: Vec<PaymentMethod>,
    pub fee_structure: FeeStructure,
    pub status: ProviderStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ProviderType {
    Simplex,
    MoonPay,
    Transak,
    Adyen,
    Stripe,
    Plaid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeStructure {
    pub deposit_fee_percent: f64,
    pub deposit_fixed_fee: f64,
    pub withdrawal_fee_percent: f64,
    pub withdrawal_fixed_fee: f64,
    pub min_deposit: f64,
    pub max_deposit: f64,
    pub min_withdrawal: f64,
    pub max_withdrawal: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ProviderStatus {
    Active,
    Maintenance,
    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeRate {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub timestamp: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatTransaction {
    pub transaction_id: String,
    pub user_id: String,
    pub transaction_type: TransactionType,
    pub currency: String,
    pub amount: f64,
    pub fee: f64,
    pub net_amount: f64,
    pub status: TransactionStatus,
    pub payment_method: PaymentMethod,
    pub provider: Option<String>,
    pub reference: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
}

// ============================================================================
// FIAT GATEWAY SERVICE
// ============================================================================

pub struct FiatGateway {
    pub accounts: RwLock<HashMap<String, FiatAccount>>,
    pub deposits: RwLock<HashMap<String, DepositRequest>>,
    pub withdrawals: RwLock<HashMap<String, WithdrawalRequest>>,
    pub cards: RwLock<HashMap<String, Card>>,
    pub providers: RwLock<Vec<PaymentProvider>>,
    pub exchange_rates: RwLock<HashMap<String, ExchangeRate>>,
    pub transactions: RwLock<HashMap<String, FiatTransaction>>,
    pub crypto: CryptoService,
}

impl FiatGateway {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            accounts: RwLock::new(HashMap::new()),
            deposits: RwLock::new(HashMap::new()),
            withdrawals: RwLock::new(HashMap::new()),
            cards: RwLock::new(HashMap::new()),
            providers: RwLock::new(Vec::new()),
            exchange_rates: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            crypto: CryptoService::from_env()?,
        })
    }
    
    pub async fn initialize(&self) {
        // Initialize payment providers
        let mut providers = self.providers.write().await;
        
        providers.push(PaymentProvider {
            provider_id: "simplex".to_string(),
            name: "Simplex".to_string(),
            provider_type: ProviderType::Simplex,
            supported_currencies: vec!["USD".to_string(), "EUR".to_string(), "GBP".to_string()],
            supported_methods: vec![PaymentMethod::Card, PaymentMethod::ApplePay, PaymentMethod::GooglePay],
            fee_structure: FeeStructure {
                deposit_fee_percent: 3.5,
                deposit_fixed_fee: 0.30,
                withdrawal_fee_percent: 0.0,
                withdrawal_fixed_fee: 0.0,
                min_deposit: 50.0,
                max_deposit: 20000.0,
                min_withdrawal: 0.0,
                max_withdrawal: 0.0,
            },
            status: ProviderStatus::Active,
        });
        
        providers.push(PaymentProvider {
            provider_id: "moonpay".to_string(),
            name: "MoonPay".to_string(),
            provider_type: ProviderType::MoonPay,
            supported_currencies: vec!["USD".to_string(), "EUR".to_string(), "GBP".to_string(), "JPY".to_string()],
            supported_methods: vec![PaymentMethod::Card, PaymentMethod::ApplePay, PaymentMethod::GooglePay],
            fee_structure: FeeStructure {
                deposit_fee_percent: 4.5,
                deposit_fixed_fee: 0.50,
                withdrawal_fee_percent: 0.0,
                withdrawal_fixed_fee: 0.0,
                min_deposit: 30.0,
                max_deposit: 25000.0,
                min_withdrawal: 0.0,
                max_withdrawal: 0.0,
            },
            status: ProviderStatus::Active,
        });
        
        providers.push(PaymentProvider {
            provider_id: "transak".to_string(),
            name: "Transak".to_string(),
            provider_type: ProviderType::Transak,
            supported_currencies: vec!["USD".to_string(), "EUR".to_string(), "GBP".to_string(), "AUD".to_string()],
            supported_methods: vec![PaymentMethod::Card, PaymentMethod::BankTransfer],
            fee_structure: FeeStructure {
                deposit_fee_percent: 3.0,
                deposit_fixed_fee: 0.25,
                withdrawal_fee_percent: 0.0,
                withdrawal_fixed_fee: 0.0,
                min_deposit: 20.0,
                max_deposit: 15000.0,
                min_withdrawal: 0.0,
                max_withdrawal: 0.0,
            },
            status: ProviderStatus::Active,
        });
        
        providers.push(PaymentProvider {
            provider_id: "adyen".to_string(),
            name: "Adyen".to_string(),
            provider_type: ProviderType::Adyen,
            supported_currencies: vec!["USD".to_string(), "EUR".to_string(), "GBP".to_string(), "AUD".to_string(), "JPY".to_string()],
            supported_methods: vec![PaymentMethod::Card, PaymentMethod::ApplePay, PaymentMethod::GooglePay, PaymentMethod::BankTransfer, PaymentMethod::Sepa],
            fee_structure: FeeStructure {
                deposit_fee_percent: 2.5,
                deposit_fixed_fee: 0.20,
                withdrawal_fee_percent: 1.0,
                withdrawal_fixed_fee: 2.0,
                min_deposit: 10.0,
                max_deposit: 100000.0,
                min_withdrawal: 10.0,
                max_withdrawal: 100000.0,
            },
            status: ProviderStatus::Active,
        });
        
        drop(providers);
        
        // Initialize exchange rates
        let mut rates = self.exchange_rates.write().await;
        rates.insert("USD-USDT".to_string(), ExchangeRate { from_currency: "USD".to_string(), to_currency: "USDT".to_string(), rate: 1.0, timestamp: current_timestamp(), source: "tigerex".to_string() });
        rates.insert("EUR-USDT".to_string(), ExchangeRate { from_currency: "EUR".to_string(), to_currency: "USDT".to_string(), rate: 1.08, timestamp: current_timestamp(), source: "tigerex".to_string() });
        rates.insert("GBP-USDT".to_string(), ExchangeRate { from_currency: "GBP".to_string(), to_currency: "USDT".to_string(), rate: 1.27, timestamp: current_timestamp(), source: "tigerex".to_string() });
        rates.insert("JPY-USDT".to_string(), ExchangeRate { from_currency: "JPY".to_string(), to_currency: "USDT".to_string(), rate: 0.0067, timestamp: current_timestamp(), source: "tigerex".to_string() });
        rates.insert("AUD-USDT".to_string(), ExchangeRate { from_currency: "AUD".to_string(), to_currency: "USDT".to_string(), rate: 0.66, timestamp: current_timestamp(), source: "tigerex".to_string() });
    }
    
    // ========================================================================
    // ACCOUNT MANAGEMENT
    // ========================================================================
    
    pub async fn add_bank_account(&self, user_id: &str, currency: &str, account_number: &str, 
                                 iban: Option<&str>, swift_code: Option<&str>, bank_name: Option<&str>) 
                                 -> Result<FiatAccount, String> {
        let account = FiatAccount {
            account_id: generate_id("FA"),
            user_id: user_id.to_string(),
            currency: currency.to_string(),
            account_number: self.crypto.encrypt_string(account_number)?,
            routing_number: None,
            iban: iban.map(|s| self.crypto.encrypt_string(s)).transpose()?,
            swift_code: swift_code.map(|s| s.to_string()),
            bank_name: bank_name.map(|s| s.to_string()),
            status: AccountStatus::Pending,
            verified_at: None,
            created_at: current_timestamp(),
        };
        
        let mut accounts = self.accounts.write().await;
        accounts.insert(account.account_id.clone(), account.clone());
        
        Ok(account)
    }
    
    pub async fn verify_account(&self, account_id: &str) -> Result<FiatAccount, String> {
        let mut accounts = self.accounts.write().await;
        let account = accounts.get_mut(account_id).ok_or("Account not found")?;
        
        account.status = AccountStatus::Active;
        account.verified_at = Some(current_timestamp());
        
        Ok(account.clone())
    }
    
    pub async fn get_accounts(&self, user_id: &str) -> Vec<FiatAccount> {
        let accounts = self.accounts.read().await;
        accounts.values()
            .filter(|a| a.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // DEPOSIT OPERATIONS
    // ========================================================================
    
    pub async fn create_deposit(&self, user_id: &str, currency: &str, amount: f64, 
                               method: PaymentMethod, provider_id: &str) -> Result<DepositRequest, String> {
        // Validate provider
        let providers = self.providers.read().await;
        let provider = providers.iter()
            .find(|p| p.provider_id == provider_id && p.status == ProviderStatus::Active)
            .ok_or("Provider not available")?;
        
        // Check limits
        let fee = provider.fee_structure.deposit_fixed_fee + 
                  (amount * provider.fee_structure.deposit_fee_percent / 100.0);
        
        if amount < provider.fee_structure.min_deposit {
            return Err(format!("Minimum deposit is {}", provider.fee_structure.min_deposit));
        }
        
        if amount > provider.fee_structure.max_deposit {
            return Err(format!("Maximum deposit is {}", provider.fee_structure.max_deposit));
        }
        
        let deposit = DepositRequest {
            deposit_id: generate_id("DEP"),
            user_id: user_id.to_string(),
            currency: currency.to_string(),
            amount,
            payment_method: method,
            status: TransactionStatus::Pending,
            created_at: current_timestamp(),
            processed_at: None,
            reference: generate_reference(),
            proof_url: None,
        };
        
        // Store deposit
        let mut deposits = self.deposits.write().await;
        deposits.insert(deposit.deposit_id.clone(), deposit.clone());
        
        // Create transaction record
        let transaction = FiatTransaction {
            transaction_id: deposit.deposit_id.clone(),
            user_id: user_id.to_string(),
            transaction_type: TransactionType::Deposit,
            currency: currency.to_string(),
            amount,
            fee,
            net_amount: amount - fee,
            status: TransactionStatus::Pending,
            payment_method: method,
            provider: Some(provider_id.to_string()),
            reference: deposit.reference.clone(),
            created_at: current_timestamp(),
            completed_at: None,
        };
        
        let mut transactions = self.transactions.write().await;
        transactions.insert(transaction.transaction_id.clone(), transaction);
        
        Ok(deposit)
    }
    
    pub async fn process_deposit(&self, deposit_id: &str) -> Result<DepositRequest, String> {
        let mut deposits = self.deposits.write().await;
        let deposit = deposits.get_mut(deposit_id).ok_or("Deposit not found")?;
        
        if deposit.status != TransactionStatus::Pending {
            return Err("Deposit is not pending".to_string());
        }
        
        deposit.status = TransactionStatus::Completed;
        deposit.processed_at = Some(current_timestamp());
        
        Ok(deposit.clone())
    }
    
    pub async fn get_deposits(&self, user_id: &str) -> Vec<DepositRequest> {
        let deposits = self.deposits.read().await;
        deposits.values()
            .filter(|d| d.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // WITHDRAWAL OPERATIONS
    // ========================================================================
    
    pub async fn create_withdrawal(&self, user_id: &str, currency: &str, amount: f64,
                                   account_id: &str, method: PaymentMethod) -> Result<WithdrawalRequest, String> {
        // Verify account
        let accounts = self.accounts.read().await;
        let account = accounts.get(account_id).ok_or("Account not found")?;
        
        if account.status != AccountStatus::Active {
            return Err("Account is not active".to_string());
        }
        
        // Calculate fee (using default provider for now)
        let fee = match method {
            PaymentMethod::Sepa => 1.0,
            PaymentMethod::Swift => 25.0,
            PaymentMethod::FasterPayments => 0.50,
            PaymentMethod::Pix => 0.30,
            _ => 2.0,
        };
        
        let net_amount = amount - fee;
        
        if net_amount <= 0.0 {
            return Err("Amount too small after fees".to_string());
        }
        
        let withdrawal = WithdrawalRequest {
            withdrawal_id: generate_id("WTH"),
            user_id: user_id.to_string(),
            currency: currency.to_string(),
            amount,
            fee,
            net_amount,
            payment_method: method,
            status: TransactionStatus::Pending,
            created_at: current_timestamp(),
            processed_at: None,
            reference: generate_reference(),
            bank_reference: None,
        };
        
        // Store withdrawal
        let mut withdrawals = self.withdrawals.write().await;
        withdrawals.insert(withdrawal.withdrawal_id.clone(), withdrawal.clone());
        
        // Create transaction record
        let transaction = FiatTransaction {
            transaction_id: withdrawal.withdrawal_id.clone(),
            user_id: user_id.to_string(),
            transaction_type: TransactionType::Withdrawal,
            currency: currency.to_string(),
            amount,
            fee,
            net_amount,
            status: TransactionStatus::Pending,
            payment_method: method,
            provider: None,
            reference: withdrawal.reference.clone(),
            created_at: current_timestamp(),
            completed_at: None,
        };
        
        let mut transactions = self.transactions.write().await;
        transactions.insert(transaction.transaction_id.clone(), transaction);
        
        Ok(withdrawal)
    }
    
    pub async fn process_withdrawal(&self, withdrawal_id: &str, bank_reference: &str) -> Result<WithdrawalRequest, String> {
        let mut withdrawals = self.withdrawals.write().await;
        let withdrawal = withdrawals.get_mut(withdrawal_id).ok_or("Withdrawal not found")?;
        
        if withdrawal.status != TransactionStatus::Pending {
            return Err("Withdrawal is not pending".to_string());
        }
        
        withdrawal.status = TransactionStatus::Completed;
        withdrawal.processed_at = Some(current_timestamp());
        withdrawal.bank_reference = Some(bank_reference.to_string());
        
        Ok(withdrawal.clone())
    }
    
    pub async fn get_withdrawals(&self, user_id: &str) -> Vec<WithdrawalRequest> {
        let withdrawals = self.withdrawals.read().await;
        withdrawals.values()
            .filter(|w| w.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // CARD MANAGEMENT
    // ========================================================================
    
    pub async fn add_card(&self, user_id: &str, card_number: &str, expiry_month: i32, 
                         expiry_year: i32, cvv: &str) -> Result<Card, String> {
        // Validate card
        if !validate_card_number(card_number) {
            return Err("Invalid card number".to_string());
        }
        
        let last_four = &card_number[card_number.len()-4..];
        let card_type = detect_card_type(card_number);
        
        // Encrypt sensitive data
        let encrypted_number = self.crypto.encrypt_string(card_number)?;
        let encrypted_cvv = self.crypto.encrypt_string(cvv)?;
        
        // Check if this is the first card
        let cards = self.cards.read().await;
        let is_first = !cards.values().any(|c| c.user_id == user_id);
        
        let card = Card {
            card_id: generate_id("CRD"),
            user_id: user_id.to_string(),
            last_four: last_four.to_string(),
            card_type,
            expiry_month,
            expiry_year,
            is_default: is_first,
            status: CardStatus::Active,
            created_at: current_timestamp(),
            encrypted_number,
            encrypted_cvv,
        };
        
        drop(cards);
        
        let mut cards = self.cards.write().await;
        cards.insert(card.card_id.clone(), card.clone());
        
        Ok(card)
    }
    
    pub async fn remove_card(&self, card_id: &str) -> Result<(), String> {
        let mut cards = self.cards.write().await;
        cards.remove(card_id).ok_or("Card not found")?;
        Ok(())
    }
    
    pub async fn set_default_card(&self, user_id: &str, card_id: &str) -> Result<(), String> {
        let mut cards = self.cards.write().await;

        // Validate ownership before clearing the existing default, otherwise a
        // bad card_id would leave the caller with no default card.
        let owned = cards
            .get(card_id)
            .map(|card| card.user_id == user_id)
            .unwrap_or(false);
        if !owned {
            return Err("Card not found".to_string());
        }

        for card in cards.values_mut() {
            if card.user_id == user_id {
                card.is_default = false;
            }
        }

        if let Some(card) = cards.get_mut(card_id) {
            card.is_default = true;
        }

        Ok(())
    }
    
    pub async fn get_cards(&self, user_id: &str) -> Vec<Card> {
        let cards = self.cards.read().await;
        cards.values()
            .filter(|c| c.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // EXCHANGE RATES
    // ========================================================================
    
    pub async fn get_exchange_rate(&self, from: &str, to: &str) -> Result<ExchangeRate, String> {
        let rates = self.exchange_rates.read().await;
        let key = format!("{}-{}", from, to);
        
        if let Some(rate) = rates.get(&key) {
            return Ok(rate.clone());
        }
        
        // Try inverse
        let inverse_key = format!("{}-{}", to, from);
        if let Some(inverse) = rates.get(&inverse_key) {
            return Ok(ExchangeRate {
                from_currency: from.to_string(),
                to_currency: to.to_string(),
                rate: 1.0 / inverse.rate,
                timestamp: current_timestamp(),
                source: inverse.source.clone(),
            });
        }
        
        Err("Exchange rate not found".to_string())
    }
    
    pub async fn convert_fiat(&self, from: &str, to: &str, amount: f64) -> Result<f64, String> {
        let rate = self.get_exchange_rate(from, to).await?;
        Ok(amount * rate.rate)
    }
    
    // ========================================================================
    // PROVIDERS
    // ========================================================================
    
    pub async fn get_providers(&self) -> Vec<PaymentProvider> {
        let providers = self.providers.read().await;
        providers.iter()
            .filter(|p| p.status == ProviderStatus::Active)
            .cloned()
            .collect()
    }
    
    pub async fn get_provider(&self, provider_id: &str) -> Option<PaymentProvider> {
        let providers = self.providers.read().await;
        providers.iter()
            .find(|p| p.provider_id == provider_id)
            .cloned()
    }
    
    // ========================================================================
    // TRANSACTIONS
    // ========================================================================
    
    pub async fn get_transactions(&self, user_id: &str) -> Vec<FiatTransaction> {
        let transactions = self.transactions.read().await;
        transactions.values()
            .filter(|t| t.user_id == user_id)
            .cloned()
            .collect()
    }
}

// ============================================================================
// CRYPTO SERVICE
// ============================================================================

pub struct CryptoService {
    key: [u8; 32],
}

impl CryptoService {
    /// Derive the AES-256 key from `FIAT_RAILS_ENCRYPTION_KEY`.
    ///
    /// A random per-process key would make every stored account number and
    /// card ciphertext undecryptable after a restart, so the key must come
    /// from configuration and there is no fallback.
    pub fn from_env() -> Result<Self, String> {
        let material = std::env::var("FIAT_RAILS_ENCRYPTION_KEY")
            .map_err(|_| "FIAT_RAILS_ENCRYPTION_KEY must be set".to_string())?;
        Self::from_key_material(&material)
    }

    /// Derive the key from supplied material, so callers can be tested without
    /// mutating process-wide environment state.
    pub fn from_key_material(material: &str) -> Result<Self, String> {
        if material.len() < 32 {
            return Err("encryption key must be at least 32 bytes".to_string());
        }

        let digest = Sha256::digest(material.as_bytes());
        let mut key = [0u8; 32];
        key.copy_from_slice(&digest);
        Ok(Self { key })
    }
    
    pub fn encrypt_string(&self, plaintext: &str) -> Result<String, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption error: {}", e))?;
        
        let combined = [&nonce_bytes[..], &ciphertext[..]].concat();
        Ok(base64_encode(&combined))
    }

    pub fn decrypt_string(&self, encoded: &str) -> Result<String, String> {
        let combined = base64_decode(encoded)?;
        if combined.len() < 12 {
            return Err("ciphertext is too short".to_string());
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|e| format!("Decryption error: {}", e))?;

        String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
    }
}

// ============================================================================
// UTILITIES
// ============================================================================

fn current_timestamp() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

/// Unique id for a gateway record.
///
/// Millisecond timestamps alone collide when two records are created in the
/// same millisecond, which silently overwrote stored cards, deposits and
/// withdrawals. Combine nanosecond time with a process-wide counter.
fn generate_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", prefix, nanos, sequence)
}

fn generate_reference() -> String {
    let chars: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".chars().collect();
    let mut result = String::new();
    for _ in 0..16 {
        let idx = rand::random::<usize>() % chars.len();
        result.push(chars[idx]);
    }
    result
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Base64 error: {}", e))
}

fn validate_card_number(number: &str) -> bool {
    let digits: Vec<u32> = number.chars()
        .filter(|c| c.is_ascii_digit())
        .filter_map(|c| c.to_digit(10))
        .collect();
    
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }
    
    // Luhn algorithm
    let mut sum = 0;
    let mut double = false;
    
    for &digit in digits.iter().rev() {
        let mut d = digit;
        if double {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    
    sum % 10 == 0
}

fn detect_card_type(number: &str) -> CardType {
    if number.starts_with('4') {
        CardType::Visa
    } else if number.starts_with("51") || number.starts_with("52") || 
             number.starts_with("53") || number.starts_with("54") || number.starts_with("55") {
        CardType::Mastercard
    } else if number.starts_with("34") || number.starts_with("37") {
        CardType::Amex
    } else if number.starts_with("6011") || number.starts_with("65") {
        CardType::Discover
    } else {
        CardType::Visa // Default
    }
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<(), String> {
    let gateway = Arc::new(FiatGateway::from_env()?);
    gateway.initialize().await;

    tracing::info!("TigerEx Fiat Payment Gateway ready");
    let providers = gateway.get_providers().await;
    tracing::info!("{} payment providers active", providers.len());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KEY: &str = "test-encryption-key-material-32-bytes-min";

    fn gateway() -> FiatGateway {
        std::env::set_var("FIAT_RAILS_ENCRYPTION_KEY", TEST_KEY);
        FiatGateway::from_env().expect("key must be accepted")
    }

    fn crypto() -> CryptoService {
        std::env::set_var("FIAT_RAILS_ENCRYPTION_KEY", TEST_KEY);
        CryptoService::from_env().unwrap()
    }

    #[test]
    fn encryption_key_material_is_validated() {
        // Exercises key derivation directly so the test does not race other
        // tests over the process environment.
        assert!(CryptoService::from_key_material("too-short").is_err());
        assert!(CryptoService::from_key_material(TEST_KEY).is_ok());
    }

    #[test]
    fn luhn_validation_accepts_and_rejects() {
        assert!(validate_card_number("4532015112830366"));
        assert!(validate_card_number("5555555555554444"));
        assert!(!validate_card_number("4532015112830367"));
        assert!(!validate_card_number("123"));
    }

    #[test]
    fn card_type_detection() {
        assert_eq!(detect_card_type("4532015112830366"), CardType::Visa);
        assert_eq!(detect_card_type("5555555555554444"), CardType::Mastercard);
        assert_eq!(detect_card_type("378282246310005"), CardType::Amex);
        assert_eq!(detect_card_type("6011111111111117"), CardType::Discover);
    }

    #[test]
    fn aes_round_trip() {
        let crypto = crypto();
        let plaintext = "GB82WEST12345698765432";
        let encrypted = crypto.encrypt_string(plaintext).unwrap();
        assert_ne!(encrypted, plaintext);
        assert_eq!(crypto.decrypt_string(&encrypted).unwrap(), plaintext);
    }

    #[tokio::test]
    async fn deposit_charges_provider_fee() {
        let gateway = gateway();
        gateway.initialize().await;

        let deposit = gateway
            .create_deposit("u1", "USD", 5_000.0, PaymentMethod::Swift, "adyen")
            .await
            .unwrap();
        assert_eq!(deposit.status, TransactionStatus::Pending);

        // Adyen: 2.5% + $0.20 -> 125.20
        let transactions = gateway.get_transactions("u1").await;
        let tx = transactions
            .iter()
            .find(|t| t.transaction_id == deposit.deposit_id)
            .unwrap();
        assert!((tx.fee - 125.20).abs() < 1e-6);
        assert!((tx.net_amount - (5_000.0 - 125.20)).abs() < 1e-6);

        let processed = gateway.process_deposit(&deposit.deposit_id).await.unwrap();
        assert_eq!(processed.status, TransactionStatus::Completed);

        // A completed deposit cannot be processed twice.
        assert!(gateway.process_deposit(&deposit.deposit_id).await.is_err());
    }

    #[tokio::test]
    async fn deposit_enforces_provider_limits() {
        let gateway = gateway();
        gateway.initialize().await;

        assert!(gateway
            .create_deposit("u1", "USD", 1.0, PaymentMethod::Swift, "adyen")
            .await
            .is_err());
        assert!(gateway
            .create_deposit("u1", "USD", 1_000_000.0, PaymentMethod::Swift, "adyen")
            .await
            .is_err());
        assert!(gateway
            .create_deposit("u1", "USD", 100.0, PaymentMethod::Swift, "unknown")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn withdrawal_requires_an_active_account() {
        let gateway = gateway();
        gateway.initialize().await;

        let account = gateway
            .add_bank_account("u1", "USD", "123456789", None, None, None)
            .await
            .unwrap();

        // Pending accounts cannot withdraw.
        assert!(gateway
            .create_withdrawal("u1", "USD", 1_000.0, &account.account_id, PaymentMethod::Sepa)
            .await
            .is_err());

        gateway.verify_account(&account.account_id).await.unwrap();
        let withdrawal = gateway
            .create_withdrawal("u1", "USD", 1_000.0, &account.account_id, PaymentMethod::Sepa)
            .await
            .unwrap();
        assert!((withdrawal.fee - 1.0).abs() < 1e-9);
        assert!((withdrawal.net_amount - 999.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn stored_account_numbers_are_encrypted() {
        let gateway = gateway();
        let account = gateway
            .add_bank_account("u1", "USD", "123456789", None, None, None)
            .await
            .unwrap();

        assert_ne!(account.account_number, "123456789");
        assert_eq!(
            gateway.crypto.decrypt_string(&account.account_number).unwrap(),
            "123456789"
        );
    }

    #[tokio::test]
    async fn cards_keep_encrypted_pan_and_cvv() {
        let gateway = gateway();
        gateway.initialize().await;

        let card = gateway
            .add_card("u1", "4532015112830366", 12, 2028, "123")
            .await
            .unwrap();

        assert_eq!(card.last_four, "0366");
        assert_ne!(card.encrypted_number, "4532015112830366");
        assert_eq!(
            gateway.crypto.decrypt_string(&card.encrypted_number).unwrap(),
            "4532015112830366"
        );
        assert_eq!(gateway.crypto.decrypt_string(&card.encrypted_cvv).unwrap(), "123");

        // Invalid card numbers are rejected.
        assert!(gateway
            .add_card("u1", "4532015112830367", 12, 2028, "123")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn first_card_becomes_default() {
        let gateway = gateway();
        gateway.initialize().await;

        let first = gateway
            .add_card("u1", "4532015112830366", 12, 2028, "123")
            .await
            .unwrap();
        let second = gateway
            .add_card("u1", "5555555555554444", 1, 2029, "456")
            .await
            .unwrap();

        assert!(first.is_default);
        assert!(!second.is_default);

        gateway.set_default_card("u1", &second.card_id).await.unwrap();
        assert!(gateway.set_default_card("u1", "missing").await.is_err());
        let cards = gateway.get_cards("u1").await;
        assert!(cards.iter().find(|c| c.card_id == second.card_id).unwrap().is_default);
        assert!(!cards.iter().find(|c| c.card_id == first.card_id).unwrap().is_default);
    }

    #[tokio::test]
    async fn conversion_uses_stored_rate() {
        let gateway = gateway();
        gateway.initialize().await;

        let converted = gateway.convert_fiat("EUR", "USDT", 1_000.0).await.unwrap();
        assert!((converted - 1_080.0).abs() < 1e-6);
        assert!(gateway.convert_fiat("XXX", "USDT", 1.0).await.is_err());
    }
}
