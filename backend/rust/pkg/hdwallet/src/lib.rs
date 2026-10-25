//! Deterministic HD key derivation and address encoding for TigerEx custody.
//!
//! Two independent schemes are implemented, both rooted in a BIP39 seed:
//!
//! * secp256k1 chains (Ethereum and every EVM chain, TRON) use BIP32
//!   `m/44'/coin'/0'/0/index`, then the chain's own address encoding
//!   (keccak256 with EIP-55 checksums for EVM, base58check with the 0x41
//!   version byte for TRON).
//! * ed25519 chains use the chain's own scheme: SLIP-0010 for Solana
//!   (`m/44'/501'/0'/0'`) and TON's HMAC-SHA512/PBKDF2 derivation with the
//!   wallet v4r2 state-init address hash.
//!
//! Every function is pure and deterministic. Address vectors are checked in the
//! tests against `eth_account`, `tonsdk` and independent BIP32/SLIP-0010
//! implementations.

use base58::{FromBase58, ToBase58};
use bip32::{DerivationPath, XPrv};
use hmac::{Hmac, Mac};
use ripemd::Ripemd160;
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use sha2::{Digest, Sha256, Sha512};
use slip10::{derive_key_from_path, BIP32Path, Curve};

/// Errors produced during derivation, decoding or validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HdError {
    InvalidSeedPhrase(String),
    InvalidDerivationPath(String),
    DerivationFailed(String),
    InvalidAddress(String),
    InvalidPublicKey(String),
}

impl std::fmt::Display for HdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HdError::InvalidSeedPhrase(m) => write!(f, "invalid seed phrase: {m}"),
            HdError::InvalidDerivationPath(m) => write!(f, "invalid derivation path: {m}"),
            HdError::DerivationFailed(m) => write!(f, "derivation failed: {m}"),
            HdError::InvalidAddress(m) => write!(f, "invalid address: {m}"),
            HdError::InvalidPublicKey(m) => write!(f, "invalid public key: {m}"),
        }
    }
}

impl std::error::Error for HdError {}

/// Chain families with distinct key derivation or address encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainFamily {
    /// Ethereum and every EVM-compatible chain: secp256k1 + keccak256 + EIP-55.
    Evm,
    /// TRON: secp256k1 + sha256/ripemd160 + base58check (0x41 version byte).
    Tron,
    /// Solana: ed25519 via SLIP-0010, base58 of the 32-byte public key.
    Solana,
    /// TON: ed25519 via HMAC-SHA512 + PBKDF2, wallet v4r2 friendly address.
    Ton,
}

impl ChainFamily {
    /// Maps a chain identifier to its family. Unknown identifiers are treated as
    /// EVM because that is the default for new EVM-compatible networks.
    pub fn from_chain_id(chain_id: &str) -> Self {
        match chain_id.to_ascii_lowercase().as_str() {
            "tron" | "trx" => ChainFamily::Tron,
            "sol" | "solana" => ChainFamily::Solana,
            "ton" => ChainFamily::Ton,
            _ => ChainFamily::Evm,
        }
    }

    /// The BIP44 coin type for this family.
    pub fn coin_type(&self) -> u32 {
        match self {
            ChainFamily::Evm => 60,
            ChainFamily::Tron => 195,
            ChainFamily::Solana => 501,
            // TON does not use BIP44; this value is informational only.
            ChainFamily::Ton => 607,
        }
    }
}

/// A derived key pair for one chain.
pub struct DerivedKey {
    /// Chain address in the canonical string form for that chain.
    pub address: String,
    /// Compressed public key hex (secp256k1) or ed25519 public key hex.
    pub public_key_hex: String,
    /// Raw 32-byte private key. Callers must zeroize after use.
    pub private_key: [u8; 32],
}

/// TON wallet v4r2 contract code cell hash, taken from the on-chain contract.
/// Address derivation needs only the hash and depth of the code cell.
const TON_V4R2_CODE_HASH: [u8; 32] = [
    0xfe, 0xb5, 0xff, 0x68, 0x20, 0xe2, 0xff, 0x0d, 0x94, 0x83, 0xe7, 0xe0, 0xd6, 0x2c, 0x81, 0x7d,
    0x84, 0x67, 0x89, 0xfb, 0x4a, 0xe5, 0x80, 0xc8, 0x78, 0x86, 0x6d, 0x95, 0x9d, 0xab, 0xd5, 0xc0,
];
const TON_V4R2_CODE_DEPTH: u16 = 7;
/// Default subwallet id for wallet v4r2 (0x29a9a317).
const TON_WALLET_ID_DEFAULT: u32 = 0x29a9_a317;

/// Validates a BIP39 mnemonic: known words, allowed length, correct checksum.
pub fn validate_mnemonic(phrase: &str) -> bool {
    bip39::Mnemonic::parse_in(bip39::Language::English, phrase).is_ok()
}

/// Generates a fresh 24-word English BIP39 mnemonic from OS entropy.
pub fn generate_mnemonic() -> Result<String, HdError> {
    bip39::Mnemonic::generate_in(bip39::Language::English, 24)
        .map(|m| m.to_string())
        .map_err(|e| HdError::InvalidSeedPhrase(e.to_string()))
}

/// Expands a validated BIP39 mnemonic into its 64-byte seed.
pub fn mnemonic_to_seed(phrase: &str) -> Result<[u8; 64], HdError> {
    let mnemonic = bip39::Mnemonic::parse_in(bip39::Language::English, phrase)
        .map_err(|e| HdError::InvalidSeedPhrase(e.to_string()))?;
    Ok(mnemonic.to_seed(""))
}

/// Derives a secp256k1 child key at `path` (BIP32) from the BIP39 `seed`.
pub fn derive_secp256k1(seed: &[u8], path: &str) -> Result<([u8; 32], PublicKey), HdError> {
    let derivation_path: DerivationPath = path
        .parse()
        .map_err(|e| HdError::InvalidDerivationPath(format!("{path}: {e}")))?;
    let xprv = XPrv::derive_from_path(seed, &derivation_path)
        .map_err(|e| HdError::DerivationFailed(format!("{path}: {e}")))?;
    let secret_bytes: [u8; 32] = xprv.private_key().to_bytes().into();
    let secret =
        SecretKey::from_slice(&secret_bytes).map_err(|e| HdError::InvalidPublicKey(e.to_string()))?;
    let public = PublicKey::from_secret_key(&Secp256k1::new(), &secret);
    Ok((secret_bytes, public))
}

/// Derives an ed25519 key using SLIP-0010 (used by Solana).
pub fn derive_ed25519_slip10(seed: &[u8], path: &str) -> Result<([u8; 32], [u8; 32]), HdError> {
    let bip32_path: BIP32Path = path
        .parse()
        .map_err(|e| HdError::InvalidDerivationPath(format!("{path}: {e}")))?;
    let key = derive_key_from_path(seed, Curve::Ed25519, &bip32_path)
        .map_err(|e| HdError::DerivationFailed(format!("{path}: {e}")))?;
    let public = key.public_key();
    let mut public_bytes = [0u8; 32];
    public_bytes.copy_from_slice(&public[1..33]);
    Ok((key.key, public_bytes))
}

/// EVM address: keccak256 of the uncompressed public key minus the 0x04 prefix,
/// last 20 bytes, rendered with the EIP-55 mixed-case checksum.
pub fn evm_address(seed: &[u8], path: &str) -> Result<DerivedKey, HdError> {
    let (private_key, public) = derive_secp256k1(seed, path)?;
    let uncompressed = public.serialize_uncompressed();
    let hash = keccak_hash::keccak(&uncompressed[1..]);
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash.as_bytes()[12..32]);
    Ok(DerivedKey {
        address: to_checksum_address(&address),
        public_key_hex: hex::encode(public.serialize()),
        private_key,
    })
}

/// Applies the EIP-55 mixed-case checksum to a 20-byte address.
pub fn to_checksum_address(address: &[u8; 20]) -> String {
    let lower = hex::encode(address);
    let hash = keccak_hash::keccak(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, ch) in lower.chars().enumerate() {
        let nibble = if i % 2 == 0 {
            hash.as_bytes()[i / 2] >> 4
        } else {
            hash.as_bytes()[i / 2] & 0x0f
        };
        if ch.is_ascii_alphabetic() && nibble >= 8 {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Verifies an EIP-55 checksummed EVM address, accepting all-lower/all-upper input.
pub fn is_valid_evm_address(address: &str) -> bool {
    let stripped = match address
        .strip_prefix("0x")
        .or_else(|| address.strip_prefix("0X"))
    {
        Some(s) => s,
        None => return false,
    };
    if stripped.len() != 40 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    let is_lower = stripped.chars().all(|c| !c.is_ascii_uppercase());
    let is_upper = stripped.chars().all(|c| !c.is_ascii_lowercase());
    if is_lower || is_upper {
        return true;
    }
    let mut bytes = [0u8; 20];
    if hex::decode_to_slice(stripped, &mut bytes).is_err() {
        return false;
    }
    to_checksum_address(&bytes) == address
}

/// TRON address: base58check(0x41 || ripemd160(sha256(uncompressed pubkey))).
pub fn tron_address(seed: &[u8], path: &str) -> Result<DerivedKey, HdError> {
    let (private_key, public) = derive_secp256k1(seed, path)?;
    let uncompressed = public.serialize_uncompressed();
    let sha = Sha256::digest(&uncompressed[1..]);
    let hash160 = Ripemd160::digest(sha);
    let mut payload = Vec::with_capacity(21);
    payload.push(0x41);
    payload.extend_from_slice(&hash160);
    Ok(DerivedKey {
        address: base58check_encode(&payload),
        public_key_hex: hex::encode(public.serialize()),
        private_key,
    })
}

/// Solana address: base58 of the 32-byte ed25519 public key.
pub fn solana_address(seed: &[u8], path: &str) -> Result<DerivedKey, HdError> {
    let (private_key, public) = derive_ed25519_slip10(seed, path)?;
    Ok(DerivedKey {
        address: public.to_base58(),
        public_key_hex: hex::encode(public),
        private_key,
    })
}

/// TON address for wallet v4r2 from the mnemonic phrase.
pub fn ton_address(phrase: &str) -> Result<DerivedKey, HdError> {
    let (private_key, public) = ton_key_pair(phrase)?;
    Ok(DerivedKey {
        address: ton_v4r2_address(&public),
        public_key_hex: hex::encode(public),
        private_key,
    })
}

/// TON key derivation: `HMAC-SHA512(key = phrase, msg = "")`, then
/// `PBKDF2-HMAC-SHA512(entropy, "TON default seed", 100_000, 64)`. The first 32
/// bytes are the ed25519 seed. TON uses neither BIP39 seed expansion nor SLIP-0010.
pub fn ton_key_pair(phrase: &str) -> Result<([u8; 32], [u8; 32]), HdError> {
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(phrase.as_bytes())
        .map_err(|e| HdError::DerivationFailed(format!("TON HMAC: {e}")))?;
    mac.update(b"");
    let entropy = mac.finalize().into_bytes();

    let mut derived = [0u8; 64];
    pbkdf2::pbkdf2_hmac::<Sha512>(&entropy, b"TON default seed", 100_000, &mut derived);

    let signing_key =
        ed25519_dalek::SigningKey::from_bytes(&derived[..32].try_into().expect("32 bytes"));
    let public = signing_key.verifying_key().to_bytes();
    let mut private_key = [0u8; 32];
    private_key.copy_from_slice(&derived[..32]);
    Ok((private_key, public))
}

/// Computes the wallet v4r2 address from an ed25519 public key.
pub fn ton_v4r2_address(public_key: &[u8; 32]) -> String {
    let mut data = Vec::with_capacity(41);
    data.extend_from_slice(&0u32.to_be_bytes());
    data.extend_from_slice(&TON_WALLET_ID_DEFAULT.to_be_bytes());
    data.extend_from_slice(public_key);
    data.push(0);
    let data_hash = ton_cell_hash(&data, 321, &[]);

    // split_depth(0) tick_tock(0) code:Maybe(1) data:Maybe(1) library:Maybe(0)
    let state_init = [0b0011_0000u8];
    let state_init_hash = ton_cell_hash(
        &state_init,
        5,
        &[
            (TON_V4R2_CODE_HASH, TON_V4R2_CODE_DEPTH),
            (data_hash, 0),
        ],
    );

    ton_friendly_address(0, &state_init_hash)
}

/// Hash of a TON cell: `sha256(d1 || d2 || data || ref_depths || ref_hashes)`.
pub fn ton_cell_hash(data: &[u8], bit_len: usize, refs: &[([u8; 32], u16)]) -> [u8; 32] {
    let byte_len = bit_len.div_ceil(8);
    let mut buffer = Vec::with_capacity(2 + byte_len + refs.len() * 34);
    buffer.push(refs.len() as u8);
    buffer.push((bit_len / 8 + byte_len) as u8);
    let mut bytes = data[..byte_len].to_vec();
    let remainder = bit_len % 8;
    if remainder != 0 {
        bytes[byte_len - 1] |= 1 << (8 - remainder - 1);
    }
    buffer.extend_from_slice(&bytes);
    for (_, depth) in refs {
        buffer.extend_from_slice(&depth.to_be_bytes());
    }
    for (hash, _) in refs {
        buffer.extend_from_slice(hash);
    }
    Sha256::digest(&buffer).into()
}

/// Encodes a workchain/hash pair as a base64 friendly address with a CRC-16/XMODEM checksum.
pub fn ton_friendly_address(workchain: i8, hash: &[u8; 32]) -> String {
    let mut buffer = Vec::with_capacity(36);
    buffer.push(0x11); // mainnet, bounceable
    buffer.push(workchain as u8);
    buffer.extend_from_slice(hash);
    let checksum = crc16_xmodem(&buffer);
    buffer.extend_from_slice(&checksum.to_be_bytes());
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer)
}

/// CRC-16/XMODEM, the checksum TON uses for friendly addresses.
pub fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for byte in data {
        crc ^= (*byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// base58check = base58(payload || sha256(sha256(payload))[..4]).
pub fn base58check_encode(payload: &[u8]) -> String {
    let checksum = Sha256::digest(Sha256::digest(payload));
    let mut buffer = payload.to_vec();
    buffer.extend_from_slice(&checksum[..4]);
    buffer.to_base58()
}

/// Validates a base58check string and returns the payload without the checksum.
pub fn base58check_decode(input: &str) -> Option<Vec<u8>> {
    let decoded = input.from_base58().ok()?;
    if decoded.len() < 5 {
        return None;
    }
    let (payload, checksum) = decoded.split_at(decoded.len() - 4);
    let expected = Sha256::digest(Sha256::digest(payload));
    if expected[..4] != checksum[..] {
        return None;
    }
    Some(payload.to_vec())
}

/// Validates a TRON address (base58check, 0x41 version byte, 20-byte hash).
pub fn is_valid_tron_address(address: &str) -> bool {
    matches!(base58check_decode(address), Some(payload) if payload.len() == 21 && payload[0] == 0x41)
}

/// Validates a Solana address (base58 decoding to exactly 32 bytes).
pub fn is_valid_solana_address(address: &str) -> bool {
    address.from_base58().map(|b| b.len() == 32).unwrap_or(false)
}

/// Validates a TON friendly address (base64, 36 bytes, correct CRC-16/XMODEM).
pub fn is_valid_ton_address(address: &str) -> bool {
    let decoded = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, address) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    if decoded.len() != 36 {
        return false;
    }
    let expected = u16::from_be_bytes([decoded[34], decoded[35]]);
    crc16_xmodem(&decoded[..34]) == expected
}

/// Derives the address for a chain family. TON ignores the BIP44 path.
pub fn derive_for_family(
    family: ChainFamily,
    seed: &[u8],
    phrase: &str,
    derivation_path: &str,
) -> Result<DerivedKey, HdError> {
    match family {
        ChainFamily::Evm => evm_address(seed, derivation_path),
        ChainFamily::Tron => tron_address(seed, derivation_path),
        ChainFamily::Solana => solana_address(seed, derivation_path),
        ChainFamily::Ton => ton_address(phrase),
    }
}

/// Validates an address against the chain's real encoding rules.
pub fn is_valid_address_for_family(family: ChainFamily, address: &str) -> bool {
    match family {
        ChainFamily::Evm => is_valid_evm_address(address),
        ChainFamily::Tron => is_valid_tron_address(address),
        ChainFamily::Solana => is_valid_solana_address(address),
        ChainFamily::Ton => is_valid_ton_address(address),
    }
}

/// The standard BIP44 path for a chain family at account 0, index 0.
pub fn default_derivation_path(family: ChainFamily) -> String {
    match family {
        ChainFamily::Solana => "m/44'/501'/0'/0'".to_string(),
        ChainFamily::Ton => "m/44'/607'/0'/0'".to_string(),
        _ => format!("m/44'/{}'/0'/0/0", family.coin_type()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon art";
    const JUNK_PHRASE: &str = "test test test test test test test test test test test junk";

    #[test]
    fn evm_matches_eth_account_reference() {
        let seed = mnemonic_to_seed(PHRASE).unwrap();
        let key = evm_address(&seed, "m/44'/60'/0'/0/0").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "1053fae1b3ac64f178bcc21026fd06a3f4544ec2f35338b001f02d1d8efa3d5f"
        );
        assert_eq!(key.address, "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");
    }

    #[test]
    fn evm_matches_hardhat_vector() {
        let seed = mnemonic_to_seed(JUNK_PHRASE).unwrap();
        let key = evm_address(&seed, "m/44'/60'/0'/0/0").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        );
        assert_eq!(key.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    }

    #[test]
    fn tron_matches_reference() {
        let seed = mnemonic_to_seed(PHRASE).unwrap();
        let key = tron_address(&seed, "m/44'/195'/0'/0/0").unwrap();
        assert_eq!(key.address, "TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqy");
    }

    #[test]
    fn solana_matches_reference() {
        let seed = mnemonic_to_seed(PHRASE).unwrap();
        let key = solana_address(&seed, "m/44'/501'/0'/0'").unwrap();
        assert_eq!(key.address, "3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx");
    }

    #[test]
    fn ton_matches_tonsdk_reference() {
        let phrase = "dose ice enrich trigger test dove century still betray gas diet dune use \
                      other base gym mad law immense village world example praise game";
        let key = ton_address(phrase).unwrap();
        assert_eq!(
            key.public_key_hex,
            "c04ad1885c127fe863abb00752fa844e6439bb04f264d70de7cea580b32637ab"
        );
        assert_eq!(
            key.address,
            "EQDwzJzZsH2rII9Sv4krAGIhIn12pEhCj4LYcKa8jdXTd1WV"
        );
    }

    #[test]
    fn generated_mnemonics_are_valid_and_unique() {
        let first = generate_mnemonic().unwrap();
        let second = generate_mnemonic().unwrap();
        assert!(validate_mnemonic(&first));
        assert!(validate_mnemonic(&second));
        assert_ne!(first, second);
        assert_eq!(first.split_whitespace().count(), 24);
    }

    #[test]
    fn invalid_mnemonic_is_rejected() {
        // Correct word count but a broken checksum.
        let broken = "abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon";
        assert!(!validate_mnemonic(broken));
        assert!(mnemonic_to_seed(broken).is_err());
    }

    #[test]
    fn family_dispatch_and_validation() {
        let seed = mnemonic_to_seed(PHRASE).unwrap();
        let evm = derive_for_family(ChainFamily::Evm, &seed, PHRASE, "m/44'/60'/0'/0/0").unwrap();
        assert!(is_valid_address_for_family(ChainFamily::Evm, &evm.address));

        let tron =
            derive_for_family(ChainFamily::Tron, &seed, PHRASE, "m/44'/195'/0'/0/0").unwrap();
        assert!(is_valid_address_for_family(ChainFamily::Tron, &tron.address));

        let sol =
            derive_for_family(ChainFamily::Solana, &seed, PHRASE, "m/44'/501'/0'/0'").unwrap();
        assert!(is_valid_address_for_family(ChainFamily::Solana, &sol.address));

        assert_eq!(ChainFamily::from_chain_id("tron"), ChainFamily::Tron);
        assert_eq!(ChainFamily::from_chain_id("sol"), ChainFamily::Solana);
        assert_eq!(ChainFamily::from_chain_id("ton"), ChainFamily::Ton);
        assert_eq!(ChainFamily::from_chain_id("base"), ChainFamily::Evm);
    }

    #[test]
    fn validators_reject_corrupt_input() {
        assert!(!is_valid_evm_address(
            "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdB"
        ));
        assert!(!is_valid_evm_address("0x1234"));
        assert!(!is_valid_tron_address("TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqZ"));
        assert!(!is_valid_solana_address("not-base58-0OIl"));
        assert!(!is_valid_ton_address(
            "EQDukJBiHUD3z4BUBYwV3ZRkCJoIWVN+r95pKEmVZo5MhQM+"
        ));
    }

    #[test]
    fn default_paths_use_correct_coin_types() {
        assert_eq!(default_derivation_path(ChainFamily::Evm), "m/44'/60'/0'/0/0");
        assert_eq!(
            default_derivation_path(ChainFamily::Tron),
            "m/44'/195'/0'/0/0"
        );
        assert_eq!(
            default_derivation_path(ChainFamily::Solana),
            "m/44'/501'/0'/0'"
        );
    }
}
