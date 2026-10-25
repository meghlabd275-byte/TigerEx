//! TigerEx Web3 Wallet
//!
//! Non-custodial, multi-chain wallet. Keys are derived with the shared
//! `tigerex-hdwallet` crate (real BIP32/SLIP-0010/TON derivation), balances come
//! from live JSON-RPC calls, and EVM transactions are signed with real
//! secp256k1/keccak256/RLP encoding.
//!
//! Nothing here invents data. When a dependency (RPC endpoint, seed) is not
//! configured the call fails with a typed error instead of returning a
//! plausible-looking constant.

use std::collections::HashMap;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::debug;

use tigerex_hdwallet::{self as hd, ChainFamily, DerivedKey, HdError};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum Web3WalletError {
    #[error("invalid address: {0}")]
    InvalidAddress(String),

    #[error("insufficient balance: {0}")]
    InsufficientBalance(String),

    #[error("transaction failed: {0}")]
    TransactionFailed(String),

    #[error("signature error: {0}")]
    SignatureError(String),

    #[error("chain not supported: {0}")]
    ChainNotSupported(String),

    #[error("network error: {0}")]
    NetworkError(String),

    #[error("rpc error: {0}")]
    RpcError(String),

    #[error("wallet locked: {0}")]
    WalletLocked(String),

    #[error("wallet has no seed material; unlock it first")]
    NoSeedMaterial,

    #[error("derivation error: {0}")]
    Derivation(String),
}

impl From<HdError> for Web3WalletError {
    fn from(error: HdError) -> Self {
        Web3WalletError::Derivation(error.to_string())
    }
}

// ============================================================================
// SUPPORTED CHAINS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Chain {
    Ethereum,
    BSC,
    Polygon,
    Avalanche,
    Arbitrum,
    Optimism,
    Base,
    Linea,
    #[allow(non_camel_case_types)]
    zkSync,
    Tron,
    Solana,
    Ton,
}

impl Chain {
    pub fn chain_id(&self) -> u64 {
        match self {
            Chain::Ethereum => 1,
            Chain::BSC => 56,
            Chain::Polygon => 137,
            Chain::Avalanche => 43114,
            Chain::Arbitrum => 42161,
            Chain::Optimism => 10,
            Chain::Base => 8453,
            Chain::Linea => 59144,
            Chain::zkSync => 324,
            // Non-EVM chains have no EVM chain id; 0 marks that clearly.
            Chain::Tron | Chain::Solana | Chain::Ton => 0,
        }
    }

    /// The chain family that governs key derivation and address encoding.
    pub fn family(&self) -> ChainFamily {
        match self {
            Chain::Tron => ChainFamily::Tron,
            Chain::Solana => ChainFamily::Solana,
            Chain::Ton => ChainFamily::Ton,
            _ => ChainFamily::Evm,
        }
    }

    pub fn is_evm(&self) -> bool {
        self.family() == ChainFamily::Evm
    }

    /// The BIP44 account path used for this chain.
    pub fn derivation_path(&self) -> String {
        match self {
            Chain::Tron => "m/44'/195'/0'/0/0".to_string(),
            Chain::Solana => "m/44'/501'/0'/0'".to_string(),
            Chain::Ton => "m/44'/607'/0'/0'".to_string(),
            _ => "m/44'/60'/0'/0/0".to_string(),
        }
    }

    pub fn symbol(&self) -> &'static str {
        match self {
            Chain::Ethereum => "ETH",
            Chain::BSC => "BNB",
            Chain::Polygon => "MATIC",
            Chain::Avalanche => "AVAX",
            Chain::Arbitrum => "ETH",
            Chain::Optimism => "ETH",
            Chain::Base => "ETH",
            Chain::Linea => "ETH",
            Chain::zkSync => "ETH",
            Chain::Tron => "TRX",
            Chain::Solana => "SOL",
            Chain::Ton => "TON",
        }
    }
}

// ============================================================================
// WALLET TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub chain: Chain,
    pub address: String,
    pub ens: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBalance {
    pub chain: Chain,
    pub token_address: String,
    pub symbol: String,
    pub decimals: u8,
    /// Base-unit balance as a decimal string (never a float, to avoid rounding).
    pub balance: String,
    pub balance_usd: Option<f64>,
    pub price: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub r: String,
    pub s: String,
    pub v: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage {
    pub message: String,
    pub signature: String,
    pub signer: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub chain: Chain,
    pub to: String,
    pub value: Option<String>,
    pub data: Option<String>,
    pub gas_limit: Option<u64>,
    pub gas_price: Option<u64>,
    pub nonce: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionResponse {
    pub chain: Chain,
    pub hash: String,
    pub nonce: u64,
    pub from: String,
    pub to: String,
    pub value: String,
    pub input: String,
    pub gas_limit: u64,
    pub gas_price: u64,
    pub status: TransactionStatus,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletState {
    pub id: String,
    pub addresses: Vec<WalletAddress>,
    pub created_at: u64,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WalletEvent {
    AddressDerived { chain: Chain, address: String },
    TransactionSigned { chain: Chain, hash: String },
    Locked,
    Unlocked,
}

// ============================================================================
// WALLET
// ============================================================================

/// A non-custodial wallet whose keys are derived on demand from a BIP39 seed.
///
/// The seed is held only while the wallet is unlocked and is zeroized on lock.
/// Derived private keys are never stored; each signing call re-derives the key
/// from the seed and zeroizes it immediately afterwards.
pub struct Web3Wallet {
    wallet_id: String,
    seed: RwLock<Option<hd::ZeroizingSeed>>,
    phrase: RwLock<Option<String>>,
    addresses: RwLock<HashMap<Chain, String>>,
    rpc_overrides: RwLock<HashMap<Chain, String>>,
    event_tx: broadcast::Sender<WalletEvent>,
}

impl Web3Wallet {
    /// Creates a locked wallet. Call [`Web3Wallet::unlock`] with a mnemonic
    /// before deriving addresses or signing.
    pub fn new(wallet_id: String) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            wallet_id,
            seed: RwLock::new(None),
            phrase: RwLock::new(None),
            addresses: RwLock::new(HashMap::new()),
            rpc_overrides: RwLock::new(HashMap::new()),
            event_tx,
        }
    }

    /// Creates a wallet from a real BIP39 mnemonic, generating one if absent.
    ///
    /// Returns the wallet and the mnemonic. The caller is responsible for
    /// presenting the mnemonic to the user once and never persisting it in clear.
    pub fn create(wallet_id: String) -> Result<(Self, String), Web3WalletError> {
        let phrase = hd::generate_mnemonic()?;
        let wallet = Self::new(wallet_id);
        wallet.unlock(&phrase)?;
        Ok((wallet, phrase))
    }

    /// Unlocks the wallet with a mnemonic, validating its checksum first.
    pub fn unlock(&self, phrase: &str) -> Result<(), Web3WalletError> {
        if !hd::validate_mnemonic(phrase) {
            return Err(Web3WalletError::Derivation(
                "mnemonic failed BIP39 checksum validation".to_string(),
            ));
        }
        let seed = hd::mnemonic_to_seed(phrase)?;
        *self.seed.write().unwrap() = Some(hd::ZeroizingSeed::new(seed));
        *self.phrase.write().unwrap() = Some(phrase.to_string());
        let _ = self.event_tx.send(WalletEvent::Unlocked);
        Ok(())
    }

    /// Locks the wallet, zeroizing the seed and phrase.
    pub fn lock(&self) {
        if let Some(mut seed) = self.seed.write().unwrap().take() {
            seed.zeroize();
        }
        if let Some(phrase) = self.phrase.write().unwrap().take() {
            drop(zeroize::Zeroizing::new(phrase));
        }
        let _ = self.event_tx.send(WalletEvent::Locked);
    }

    pub fn is_locked(&self) -> bool {
        self.seed.read().unwrap().is_none()
    }

    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// Sets an RPC endpoint override for a chain (otherwise the default is used).
    pub fn set_rpc_url(&self, chain: Chain, url: String) {
        self.rpc_overrides.write().unwrap().insert(chain, url);
    }

    /// Derives and caches the address for a chain.
    pub fn derive_address(&self, chain: Chain) -> Result<String, Web3WalletError> {
        let key = self.derive_key(chain)?;
        self.addresses
            .write()
            .unwrap()
            .insert(chain, key.address.clone());
        let _ = self.event_tx.send(WalletEvent::AddressDerived {
            chain,
            address: key.address.clone(),
        });
        Ok(key.address)
    }

    /// Derives the key material for a chain, zeroizing the private key afterwards.
    fn derive_key(&self, chain: Chain) -> Result<DerivedKey, Web3WalletError> {
        let guard = self.seed.read().unwrap();
        let seed = guard.as_ref().ok_or(Web3WalletError::NoSeedMaterial)?;
        let phrase = self.phrase.read().unwrap();
        let phrase = phrase.as_deref().unwrap_or_default();

        let key = hd::derive_for_family(
            chain.family(),
            seed.as_bytes(),
            phrase,
            &chain.derivation_path(),
        )?;
        debug!(chain = ?chain, "derived address");
        Ok(key)
    }

    /// Returns the cached address, deriving it on first use.
    pub fn get_address(&self, chain: Chain) -> Result<String, Web3WalletError> {
        if let Some(address) = self.addresses.read().unwrap().get(&chain) {
            return Ok(address.clone());
        }
        self.derive_address(chain)
    }

    pub fn get_all_addresses(&self) -> Vec<WalletAddress> {
        self.addresses
            .read()
            .unwrap()
            .iter()
            .map(|(chain, address)| WalletAddress {
                chain: *chain,
                address: address.clone(),
                ens: None,
            })
            .collect()
    }

    /// Validates an address against the chain's real encoding rules.
    pub fn validate_address(&self, chain: Chain, address: &str) -> bool {
        hd::is_valid_address_for_family(chain.family(), address)
    }

    fn rpc_url(&self, chain: Chain) -> Result<String, Web3WalletError> {
        if let Some(url) = self.rpc_overrides.read().unwrap().get(&chain) {
            return Ok(url.clone());
        }
        default_rpc_url(chain).map(|url| url.to_string()).ok_or_else(|| {
            Web3WalletError::ChainNotSupported(format!(
                "{chain:?} has no default RPC endpoint; configure one with set_rpc_url"
            ))
        })
    }

    // ------------------------------------------------------------------
    // BALANCES
    // ------------------------------------------------------------------

    /// Reads the native-token balance from the chain's JSON-RPC endpoint.
    pub async fn get_native_balance(
        &self,
        chain: Chain,
    ) -> Result<TokenBalance, Web3WalletError> {
        if !chain.is_evm() {
            return Err(Web3WalletError::ChainNotSupported(format!(
                "native balance for {chain:?} requires a chain-specific client"
            )));
        }
        let address = self.get_address(chain)?;
        let rpc = self.rpc_url(chain)?;
        let client = rpc_client()?;

        let hex_balance: String = rpc_call(
            &client,
            &rpc,
            "eth_getBalance",
            serde_json::json!([address, "latest"]),
        )
        .await?;

        Ok(TokenBalance {
            chain,
            token_address: String::new(),
            symbol: chain.symbol().to_string(),
            decimals: 18,
            balance: hex_to_decimal(&hex_balance)?,
            balance_usd: None,
            price: None,
        })
    }

    /// Reads an ERC-20 balance via `eth_call` to `balanceOf(address)`.
    pub async fn get_token_balance(
        &self,
        chain: Chain,
        token_address: &str,
        decimals: u8,
        symbol: &str,
    ) -> Result<TokenBalance, Web3WalletError> {
        if !chain.is_evm() {
            return Err(Web3WalletError::ChainNotSupported(format!(
                "{chain:?} is not EVM; use the chain-specific client"
            )));
        }
        if !hd::is_valid_evm_address(token_address) {
            return Err(Web3WalletError::InvalidAddress(token_address.to_string()));
        }

        let holder = self.get_address(chain)?;
        let rpc = self.rpc_url(chain)?;

        // balanceOf(address) selector is 0x70a08231.
        let holder_bytes = hex::decode(holder.trim_start_matches("0x"))
            .map_err(|e| Web3WalletError::InvalidAddress(e.to_string()))?;
        let mut data = String::from("0x70a08231");
        data.push_str(&"0".repeat(24));
        data.push_str(&hex::encode(holder_bytes));

        let client = rpc_client()?;
        let hex_balance: String = rpc_call(
            &client,
            &rpc,
            "eth_call",
            serde_json::json!([{ "to": token_address, "data": data }, "latest"]),
        )
        .await?;

        Ok(TokenBalance {
            chain,
            token_address: token_address.to_string(),
            symbol: symbol.to_string(),
            decimals,
            balance: hex_to_decimal(&hex_balance)?,
            balance_usd: None,
            price: None,
        })
    }

    // ------------------------------------------------------------------
    // SIGNING
    // ------------------------------------------------------------------

    /// Signs an EIP-191 personal message with the chain's derived key.
    pub fn sign_message(
        &self,
        chain: Chain,
        message: &str,
    ) -> Result<SignedMessage, Web3WalletError> {
        if !chain.is_evm() {
            return Err(Web3WalletError::ChainNotSupported(
                "message signing is implemented for EVM chains".to_string(),
            ));
        }
        let key = self.derive_key(chain)?;
        let signer = key.address.clone();
        let mut private = key.private_key;

        let signature = sign_eip191(&private, message)?;
        private.fill(0);

        Ok(SignedMessage {
            message: message.to_string(),
            signature,
            signer,
            timestamp: now_secs(),
        })
    }

    /// Builds, signs (EIP-1559) and broadcasts a native-value transaction.
    pub async fn send_transaction(
        &self,
        request: TransactionRequest,
    ) -> Result<TransactionResponse, Web3WalletError> {
        if !request.chain.is_evm() {
            return Err(Web3WalletError::ChainNotSupported(
                "transaction signing is implemented for EVM chains".to_string(),
            ));
        }
        if !hd::is_valid_evm_address(&request.to) {
            return Err(Web3WalletError::InvalidAddress(request.to.clone()));
        }

        let key = self.derive_key(request.chain)?;
        let from = key.address.clone();
        let mut private = key.private_key;

        let rpc = self.rpc_url(request.chain)?;
        let client = rpc_client()?;

        let nonce = match request.nonce {
            Some(nonce) => nonce,
            None => fetch_nonce(&client, &rpc, &from).await?,
        };
        let chain_id = request.chain.chain_id();

        let value = match &request.value {
            Some(v) => decimal_to_hex_quantity(v)?,
            None => "0x0".to_string(),
        };
        let data = request.data.clone().unwrap_or_else(|| "0x".to_string());
        let data_bytes = hex::decode(data.trim_start_matches("0x"))
            .map_err(|e| Web3WalletError::TransactionFailed(format!("invalid calldata: {e}")))?;

        let (max_priority_fee, max_fee) = match request.gas_price {
            Some(priority) => (priority, priority.saturating_mul(2)),
            None => fetch_fees(&client, &rpc).await?,
        };

        let gas_limit = match request.gas_limit {
            Some(limit) => limit,
            None => estimate_gas(&client, &rpc, &from, &request.to, &value, &data).await?,
        };

        let signed = sign_eip1559(
            &mut private,
            chain_id,
            nonce,
            max_priority_fee,
            max_fee,
            gas_limit,
            &request.to,
            &value,
            &data_bytes,
        )?;
        private.fill(0);

        let raw = format!("0x{}", hex::encode(&signed.raw));
        let hash = send_raw_transaction(&client, &rpc, &raw).await?;

        Ok(TransactionResponse {
            chain: request.chain,
            hash,
            nonce,
            from,
            to: request.to,
            value,
            input: data,
            gas_limit,
            gas_price: max_fee,
            status: TransactionStatus::Pending,
            timestamp: now_secs(),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WalletEvent> {
        self.event_tx.subscribe()
    }
}

// ============================================================================
// EVM SIGNING HELPERS
// ============================================================================

/// A signed EIP-1559 transaction and its hash.
pub struct SignedTransaction {
    pub raw: Vec<u8>,
    pub hash: String,
}

/// Signs an EIP-191 personal message (`"\x19Ethereum Signed Message:\n" + len + msg`).
fn sign_eip191(private_key: &[u8; 32], message: &str) -> Result<String, Web3WalletError> {
    let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
    prefixed.extend_from_slice(message.as_bytes());
    let digest = keccak_hash::keccak(&prefixed);

    let secp = secp256k1::Secp256k1::new();
    let secret = secp256k1::SecretKey::from_slice(private_key)
        .map_err(|e| Web3WalletError::SignatureError(e.to_string()))?;
    let msg = secp256k1::Message::from_digest_slice(digest.as_bytes())
        .map_err(|e| Web3WalletError::SignatureError(e.to_string()))?;
    let signature = secp.sign_ecdsa_recoverable(&msg, &secret);
    let (recovery_id, compact) = signature.serialize_compact();
    let mut bytes = Vec::with_capacity(65);
    bytes.extend_from_slice(&compact[..]);
    bytes.push(27 + recovery_id.to_i32() as u8);
    Ok(format!("0x{}", hex::encode(bytes)))
}

/// Signs an EIP-1559 (type 0x02) transaction and returns the raw bytes + hash.
#[allow(clippy::too_many_arguments)]
fn sign_eip1559(
    private_key: &mut [u8; 32],
    chain_id: u64,
    nonce: u64,
    max_priority_fee: u64,
    max_fee: u64,
    gas_limit: u64,
    to: &str,
    value_hex: &str,
    data: &[u8],
) -> Result<SignedTransaction, Web3WalletError> {
    let to_bytes = hex::decode(to.trim_start_matches("0x"))
        .map_err(|e| Web3WalletError::InvalidAddress(e.to_string()))?;
    let value = u128::from_str_radix(value_hex.trim_start_matches("0x"), 16)
        .map_err(|e| Web3WalletError::TransactionFailed(format!("invalid value: {e}")))?;

    let mut stream = rlp::RlpStream::new_list(9);
    stream.append(&chain_id);
    stream.append(&nonce);
    stream.append(&max_priority_fee);
    stream.append(&max_fee);
    stream.append(&gas_limit);
    stream.append(&to_bytes.as_slice());
    stream.append(&value);
    stream.append(&data);
    stream.begin_list(0); // access list
    let unsigned = stream.out();

    let mut signing_payload = vec![0x02u8];
    signing_payload.extend_from_slice(&unsigned);
    let digest = keccak_hash::keccak(&signing_payload);

    let secp = secp256k1::Secp256k1::new();
    let secret = secp256k1::SecretKey::from_slice(private_key)
        .map_err(|e| Web3WalletError::SignatureError(e.to_string()))?;
    let msg = secp256k1::Message::from_digest_slice(digest.as_bytes())
        .map_err(|e| Web3WalletError::SignatureError(e.to_string()))?;
    let signature = secp.sign_ecdsa_recoverable(&msg, &secret);
    let (recovery_id, compact) = signature.serialize_compact();

    let r = &compact[..32];
    let s = &compact[32..];
    let y_parity = recovery_id.to_i32() as u64;

    let mut signed = rlp::RlpStream::new_list(12);
    signed.append(&chain_id);
    signed.append(&nonce);
    signed.append(&max_priority_fee);
    signed.append(&max_fee);
    signed.append(&gas_limit);
    signed.append(&to_bytes.as_slice());
    signed.append(&value);
    signed.append(&data);
    signed.begin_list(0);
    signed.append(&y_parity);
    signed.append(&r);
    signed.append(&s);
    let body = signed.out();

    let mut raw = vec![0x02u8];
    raw.extend_from_slice(&body);
    let hash = format!("0x{}", hex::encode(keccak_hash::keccak(&raw)));

    Ok(SignedTransaction { raw, hash })
}

// ============================================================================
// RPC HELPERS
// ============================================================================

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcErrorObject>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorObject {
    code: i64,
    message: String,
}

fn rpc_error(error: &Option<RpcErrorObject>) -> String {
    match error {
        Some(e) => format!("rpc error {}: {}", e.code, e.message),
        None => "rpc returned no result".to_string(),
    }
}

fn rpc_client() -> Result<reqwest::Client, Web3WalletError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| Web3WalletError::NetworkError(e.to_string()))
}

async fn rpc_call<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<T, Web3WalletError> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let response: RpcResponse<T> = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| Web3WalletError::NetworkError(e.to_string()))?
        .json()
        .await
        .map_err(|e| Web3WalletError::RpcError(e.to_string()))?;
    response
        .result
        .ok_or_else(|| Web3WalletError::RpcError(rpc_error(&response.error)))
}

async fn fetch_nonce(
    client: &reqwest::Client,
    url: &str,
    address: &str,
) -> Result<u64, Web3WalletError> {
    let hex: String = rpc_call(
        client,
        url,
        "eth_getTransactionCount",
        serde_json::json!([address, "pending"]),
    )
    .await?;
    hex_to_u64(&hex)
}

async fn fetch_fees(client: &reqwest::Client, url: &str) -> Result<(u64, u64), Web3WalletError> {
    let priority: String = rpc_call(
        client,
        url,
        "eth_maxPriorityFeePerGas",
        serde_json::json!([]),
    )
    .await?;
    let priority = hex_to_u64(&priority)?;
    let latest: serde_json::Value = rpc_call(
        client,
        url,
        "eth_getBlockByNumber",
        serde_json::json!(["latest", false]),
    )
    .await?;
    let base_fee = latest
        .get("baseFeePerGas")
        .and_then(|v| v.as_str())
        .map(hex_to_u64)
        .transpose()?
        .ok_or_else(|| Web3WalletError::RpcError("block missing baseFeePerGas".to_string()))?;
    let max_fee = base_fee.saturating_mul(2).saturating_add(priority);
    Ok((priority, max_fee))
}

async fn estimate_gas(
    client: &reqwest::Client,
    url: &str,
    from: &str,
    to: &str,
    value: &str,
    data: &str,
) -> Result<u64, Web3WalletError> {
    let hex: String = rpc_call(
        client,
        url,
        "eth_estimateGas",
        serde_json::json!([{ "from": from, "to": to, "value": value, "data": data }]),
    )
    .await?;
    hex_to_u64(&hex)
}

async fn send_raw_transaction(
    client: &reqwest::Client,
    url: &str,
    raw: &str,
) -> Result<String, Web3WalletError> {
    rpc_call(
        client,
        url,
        "eth_sendRawTransaction",
        serde_json::json!([raw]),
    )
    .await
}

fn hex_to_u64(value: &str) -> Result<u64, Web3WalletError> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16)
        .map_err(|e| Web3WalletError::RpcError(format!("invalid hex quantity {value}: {e}")))
}

/// Converts a hex quantity to a decimal string, preserving full precision.
fn hex_to_decimal(value: &str) -> Result<String, Web3WalletError> {
    let trimmed = value.trim_start_matches("0x");
    if trimmed.is_empty() {
        return Ok("0".to_string());
    }
    // Accumulate in base 10 by processing one hex digit at a time, so arbitrarily
    // large balances do not overflow any fixed-width integer.
    let mut digits: Vec<u8> = vec![0];
    for ch in trimmed.chars() {
        let nibble = ch
            .to_digit(16)
            .ok_or_else(|| Web3WalletError::RpcError(format!("invalid hex {value}")))?;
        let mut carry = nibble as u32;
        for digit in digits.iter_mut() {
            let current = (*digit as u32) * 16 + carry;
            *digit = (current % 10) as u8;
            carry = current / 10;
        }
        while carry > 0 {
            digits.push((carry % 10) as u8);
            carry /= 10;
        }
    }
    let mut out: String = digits.iter().rev().map(|d| (b'0' + d) as char).collect();
    while out.len() > 1 && out.starts_with('0') {
        out.remove(0);
    }
    Ok(out)
}

/// Converts a decimal string amount into a hex quantity for RPC.
fn decimal_to_hex_quantity(value: &str) -> Result<String, Web3WalletError> {
    let amount: u128 = value
        .parse()
        .map_err(|e| Web3WalletError::TransactionFailed(format!("invalid amount {value}: {e}")))?;
    Ok(format!("0x{amount:x}"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Default public RPC endpoints per chain. Override with [`Web3Wallet::set_rpc_url`]
/// for production deployments; these are used only when no override is set.
pub fn default_rpc_url(chain: Chain) -> Option<&'static str> {
    match chain {
        Chain::Ethereum => Some("https://ethereum-rpc.publicnode.com"),
        Chain::BSC => Some("https://bsc-rpc.publicnode.com"),
        Chain::Polygon => Some("https://polygon-bor-rpc.publicnode.com"),
        Chain::Avalanche => Some("https://avalanche-c-chain-rpc.publicnode.com"),
        Chain::Arbitrum => Some("https://arbitrum-one-rpc.publicnode.com"),
        Chain::Optimism => Some("https://optimism-rpc.publicnode.com"),
        Chain::Base => Some("https://base-rpc.publicnode.com"),
        Chain::Linea => Some("https://linea-rpc.publicnode.com"),
        Chain::zkSync => Some("https://zksync-era-rpc.publicnode.com"),
        Chain::Tron | Chain::Solana | Chain::Ton => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon art";

    fn wallet() -> Web3Wallet {
        let w = Web3Wallet::new("test".to_string());
        w.unlock(PHRASE).unwrap();
        w
    }

    #[test]
    fn derives_real_evm_address() {
        let w = wallet();
        let address = w.derive_address(Chain::Ethereum).unwrap();
        assert_eq!(address, "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");
        assert!(w.validate_address(Chain::Ethereum, &address));
    }

    #[test]
    fn derives_real_tron_and_solana_addresses() {
        let w = wallet();
        assert_eq!(
            w.derive_address(Chain::Tron).unwrap(),
            "TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqy"
        );
        assert_eq!(
            w.derive_address(Chain::Solana).unwrap(),
            "3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx"
        );
    }

    #[test]
    fn locked_wallet_cannot_derive() {
        let w = Web3Wallet::new("locked".to_string());
        assert!(w.is_locked());
        assert!(matches!(
            w.derive_address(Chain::Ethereum),
            Err(Web3WalletError::NoSeedMaterial)
        ));
    }

    #[test]
    fn lock_zeroizes_and_requires_unlock() {
        let w = wallet();
        w.derive_address(Chain::Ethereum).unwrap();
        w.lock();
        assert!(w.is_locked());
        assert!(matches!(
            w.sign_message(Chain::Ethereum, "hello"),
            Err(Web3WalletError::NoSeedMaterial)
        ));
    }

    #[test]
    fn rejects_invalid_mnemonic() {
        let w = Web3Wallet::new("bad".to_string());
        let broken = "abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon";
        assert!(w.unlock(broken).is_err());
        assert!(w.is_locked());
    }

    #[test]
    fn sign_message_is_deterministic_and_recoverable() {
        let w = wallet();
        let first = w.sign_message(Chain::Ethereum, "TigerEx login").unwrap();
        let second = w.sign_message(Chain::Ethereum, "TigerEx login").unwrap();
        assert_eq!(
            first.signature, second.signature,
            "ECDSA signing must be deterministic (RFC 6979)"
        );
        assert_eq!(first.signer, "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");

        // Recover the signer from the signature and compare.
        let sig_bytes = hex::decode(first.signature.trim_start_matches("0x")).unwrap();
        assert_eq!(sig_bytes.len(), 65);
        let recovery = secp256k1::ecdsa::RecoverableSignature::from_compact(
            &sig_bytes[..64],
            secp256k1::ecdsa::RecoveryId::from_i32(sig_bytes[64] as i32 - 27).unwrap(),
        )
        .unwrap();
        let mut prefixed =
            format!("\x19Ethereum Signed Message:\n{}", "TigerEx login".len()).into_bytes();
        prefixed.extend_from_slice(b"TigerEx login");
        let digest = keccak_hash::keccak(&prefixed);
        let msg = secp256k1::Message::from_digest_slice(digest.as_bytes()).unwrap();
        let public = secp256k1::Secp256k1::new()
            .recover_ecdsa(&msg, &recovery)
            .unwrap();
        let uncompressed = public.serialize_uncompressed();
        let hash = keccak_hash::keccak(&uncompressed[1..]);
        let mut addr = [0u8; 20];
        addr.copy_from_slice(&hash.as_bytes()[12..]);
        assert_eq!(hd::to_checksum_address(&addr), first.signer);
    }

    #[test]
    fn eip1559_signing_produces_valid_signature() {
        let bytes = hex::decode("1053fae1b3ac64f178bcc21026fd06a3f4544ec2f35338b001f02d1d8efa3d5f")
            .unwrap();
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);

        let signed = sign_eip1559(
            &mut key,
            1,
            0,
            1_000_000_000,
            2_000_000_000,
            21000,
            "0x000000000000000000000000000000000000dead",
            "0x1",
            &[],
        )
        .unwrap();

        assert_eq!(
            signed.raw[0], 0x02,
            "EIP-1559 transactions start with type byte 0x02"
        );
        assert_eq!(signed.hash.len(), 66);
        assert_eq!(
            signed.hash,
            format!("0x{}", hex::encode(keccak_hash::keccak(&signed.raw)))
        );
    }

    #[test]
    fn hex_decimal_conversion_is_exact() {
        assert_eq!(hex_to_decimal("0x0").unwrap(), "0");
        assert_eq!(
            hex_to_decimal("0xde0b6b3a7640000").unwrap(),
            "1000000000000000000"
        );
        assert_eq!(
            hex_to_decimal("0xffffffffffffffffffffffffffffffff").unwrap(),
            "340282366920938463463374607431768211455"
        );
        assert_eq!(decimal_to_hex_quantity("1").unwrap(), "0x1");
        assert_eq!(decimal_to_hex_quantity("255").unwrap(), "0xff");
    }

    #[test]
    fn rejects_non_evm_signing() {
        let w = wallet();
        assert!(matches!(
            w.sign_message(Chain::Solana, "hello"),
            Err(Web3WalletError::ChainNotSupported(_))
        ));
    }

    #[test]
    fn chain_metadata_is_consistent() {
        assert_eq!(Chain::Ethereum.chain_id(), 1);
        assert_eq!(Chain::BSC.chain_id(), 56);
        assert_eq!(Chain::Tron.chain_id(), 0);
        assert!(Chain::Base.is_evm());
        assert!(!Chain::Ton.is_evm());
        assert_eq!(Chain::Tron.family(), ChainFamily::Tron);
        assert_eq!(Chain::Ton.family(), ChainFamily::Ton);
    }
}
