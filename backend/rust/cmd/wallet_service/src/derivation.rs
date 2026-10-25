//! Deterministic HD key derivation for every chain the service custodies.
//!
//! Two independent derivation schemes are implemented, both from the BIP39 seed:
//!
//! * secp256k1 chains (Ethereum and every EVM chain, TRON) use BIP32 `m/44'/coin'/0'/0/index`
//!   with **compressed** public keys for the non-hardened levels, then the chain-specific
//!   address encoding (keccak256 for EVM, base58check with the 0x41 version byte for TRON).
//! * ed25519 chains use the chain's own scheme: SLIP-0010 for Solana
//!   (`m/44'/501'/0'/0'`, all levels hardened) and TON's HMAC-SHA512/PBKDF2 key derivation.
//!
//! Every function here is pure and deterministic. The addresses are checked in
//! `tests::derivation_vectors` against vectors produced by `eth_account`, `tonsdk` and
//! independent Python BIP32/SLIP-0010 implementations.

use bip32::{DerivationPath, XPrv};
use base58::{FromBase58, ToBase58};
use hmac::{Hmac, Mac};
use ripemd::Ripemd160;
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use sha2::{Digest, Sha256, Sha512};
use slip10::{derive_key_from_path, BIP32Path, Curve};

use crate::WalletError;

/// TON wallet v4r2 contract code cell hash, taken from the on-chain contract.
/// Address derivation only needs the hash and depth of the code cell, not the code itself.
const TON_V4R2_CODE_HASH: [u8; 32] = [
    0xfe, 0xb5, 0xff, 0x68, 0x20, 0xe2, 0xff, 0x0d, 0x94, 0x83, 0xe7, 0xe0, 0xd6, 0x2c, 0x81, 0x7d,
    0x84, 0x67, 0x89, 0xfb, 0x4a, 0xe5, 0x80, 0xc8, 0x78, 0x86, 0x6d, 0x95, 0x9d, 0xab, 0xd5, 0xc0,
];
const TON_V4R2_CODE_DEPTH: u16 = 7;
/// Default subwallet id for wallet v4r2 (0x29a9a317).
const TON_WALLET_ID_DEFAULT: u32 = 0x29a9_a317;

/// A derived key pair for one chain.
pub struct DerivedKey {
    /// Chain address in the canonical string form for that chain.
    pub address: String,
    /// Compressed public key hex (secp256k1) or ed25519 public key hex.
    pub public_key_hex: String,
    /// Raw 32-byte private key. Callers must zeroize after use.
    pub private_key: [u8; 32],
}

fn derive_err(msg: impl Into<String>) -> WalletError {
    WalletError::SigningError(msg.into())
}

/// Derives a secp256k1 child key at `path` (BIP32) from the BIP39 `seed`.
pub fn derive_secp256k1(seed: &[u8], path: &str) -> Result<([u8; 32], PublicKey), WalletError> {
    let derivation_path: DerivationPath = path
        .parse()
        .map_err(|e| derive_err(format!("invalid derivation path {path}: {e}")))?;
    let xprv = XPrv::derive_from_path(seed, &derivation_path)
        .map_err(|e| derive_err(format!("BIP32 derivation failed for {path}: {e}")))?;
    let secret_bytes: [u8; 32] = xprv.private_key().to_bytes().into();
    let secret =
        SecretKey::from_slice(&secret_bytes).map_err(|e| derive_err(format!("invalid key: {e}")))?;
    let public = PublicKey::from_secret_key(&Secp256k1::new(), &secret);
    Ok((secret_bytes, public))
}

/// Derives an ed25519 key using SLIP-0010 (used by Solana).
pub fn derive_ed25519_slip10(seed: &[u8], path: &str) -> Result<([u8; 32], [u8; 32]), WalletError> {
    let bip32_path: BIP32Path = path
        .parse()
        .map_err(|e| derive_err(format!("invalid SLIP-0010 path {path}: {e}")))?;
    let key = derive_key_from_path(seed, Curve::Ed25519, &bip32_path)
        .map_err(|e| derive_err(format!("SLIP-0010 derivation failed for {path}: {e}")))?;
    let public = key.public_key();
    let mut public_bytes = [0u8; 32];
    public_bytes.copy_from_slice(&public[1..33]);
    Ok((key.key, public_bytes))
}

/// EVM address: keccak256 of the uncompressed public key (minus the 0x04 prefix), last 20 bytes.
/// Returned in EIP-55 checksummed form.
pub fn evm_address(seed: &[u8], path: &str) -> Result<DerivedKey, WalletError> {
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
        // Uppercase hex letters whose corresponding keccak nibble is >= 8.
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

/// Verifies an EIP-55 checksummed EVM address, accepting all-lowercase/all-uppercase input.
pub fn is_valid_evm_address(address: &str) -> bool {
    let stripped = match address.strip_prefix("0x").or_else(|| address.strip_prefix("0X")) {
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
pub fn tron_address(seed: &[u8], path: &str) -> Result<DerivedKey, WalletError> {
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

/// Solana address: base58 of the 32-byte ed25519 public key derived via SLIP-0010.
pub fn solana_address(seed: &[u8], path: &str) -> Result<DerivedKey, WalletError> {
    let (private_key, public) = derive_ed25519_slip10(seed, path)?;
    Ok(DerivedKey {
        address: public.to_base58(),
        public_key_hex: hex::encode(public),
        private_key,
    })
}

/// TON address for wallet v4r2: mnemonic -> HMAC-SHA512 -> PBKDF2 -> ed25519 -> state init hash.
pub fn ton_address(phrase: &str) -> Result<DerivedKey, WalletError> {
    let (private_key, public) = ton_key_pair(phrase)?;
    let address = ton_v4r2_address(&public);
    Ok(DerivedKey {
        address,
        public_key_hex: hex::encode(public),
        private_key,
    })
}

/// TON's native key derivation: ed25519 key pair from the mnemonic phrase.
///
/// TON does not use BIP39 seed expansion or SLIP-0010. It computes
/// `HMAC-SHA512(key = phrase, msg = "")` and then
/// `PBKDF2-HMAC-SHA512(entropy, "TON default seed", 100_000 rounds, 64 bytes)`.
/// The first 32 bytes of the result are the ed25519 seed.
pub fn ton_key_pair(phrase: &str) -> Result<([u8; 32], [u8; 32]), WalletError> {
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(phrase.as_bytes())
        .map_err(|e| derive_err(format!("TON HMAC init failed: {e}")))?;
    mac.update(b"");
    let entropy = mac.finalize().into_bytes();

    let mut derived = [0u8; 64];
    pbkdf2::pbkdf2_hmac::<Sha512>(&entropy, b"TON default seed", 100_000, &mut derived);

    let signing_key = ed25519_dalek::SigningKey::from_bytes(
        &derived[..32].try_into().expect("32-byte slice"),
    );
    let public = signing_key.verifying_key().to_bytes();
    let mut private_key = [0u8; 32];
    private_key.copy_from_slice(&derived[..32]);
    Ok((private_key, public))
}

/// Computes the wallet v4r2 address from an ed25519 public key.
///
/// The address is the hash of the contract's `StateInit` cell (workchain 0) encoded as a
/// base64 "friendly" address. `StateInit` holds two `Maybe` bits set plus references to the
/// code cell and the data cell (`seqno`, `wallet_id`, `public_key`, `plugins`).
pub fn ton_v4r2_address(public_key: &[u8; 32]) -> String {
    let mut data = Vec::with_capacity(41);
    data.extend_from_slice(&0u32.to_be_bytes()); // seqno
    data.extend_from_slice(&TON_WALLET_ID_DEFAULT.to_be_bytes()); // subwallet id
    data.extend_from_slice(public_key);
    data.push(0); // plugins: Maybe is empty
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
///
/// `d1` encodes the reference count, `d2` the bit length. The data is padded with a
/// single set bit after the last used bit, as the TVM representation requires.
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
    match base58check_decode(address) {
        Some(payload) => payload.len() == 21 && payload[0] == 0x41,
        None => false,
    }
}

/// Validates a Solana address (base58 decoding to exactly 32 bytes).
pub fn is_valid_solana_address(address: &str) -> bool {
    address
        .from_base58()
        .map(|bytes| bytes.len() == 32)
        .unwrap_or(false)
}

/// Validates a TON friendly address (base64, correct length and CRC-16/XMODEM checksum).
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

/// Derives the address for a configured chain, dispatching on the chain family.
///
/// `chain_id` is the identifier used by [`crate::BlockchainConfig`] (`eth`, `sol`, `ton`,
/// `tron`, ...); every EVM chain shares the Ethereum derivation and address encoding.
/// `phrase` is the BIP39 mnemonic, needed by TON which derives keys from the phrase itself.
pub fn derive_for_chain(
    chain_id: &str,
    seed: &[u8],
    phrase: &str,
    derivation_path: &str,
) -> Result<DerivedKey, WalletError> {
    match chain_id {
        "sol" => solana_address(seed, derivation_path),
        "tron" => tron_address(seed, derivation_path),
        "ton" => ton_address(phrase),
        _ => evm_address(seed, derivation_path),
    }
}

/// Validates an address against the chain's real encoding rules.
pub fn is_valid_address_for_chain(chain_id: &str, address: &str) -> bool {
    match chain_id {
        "sol" => is_valid_solana_address(address),
        "tron" => is_valid_tron_address(address),
        "ton" => is_valid_ton_address(address),
        _ => is_valid_evm_address(address),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bip39::Mnemonic;

    /// Canonical 24-word BIP39 vector.
    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon abandon \
                          abandon abandon abandon abandon abandon abandon abandon art";
    /// Standard Hardhat/Anvil test mnemonic, a second independent vector.
    const JUNK_PHRASE: &str =
        "test test test test test test test test test test test junk";

    fn seed_of(phrase: &str) -> [u8; 64] {
        Mnemonic::parse(phrase)
            .expect("valid BIP39 phrase")
            .to_seed("")
    }

    #[test]
    fn evm_matches_eth_account_reference() {
        let seed = seed_of(PHRASE);
        let key = evm_address(&seed, "m/44'/60'/0'/0/0").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "1053fae1b3ac64f178bcc21026fd06a3f4544ec2f35338b001f02d1d8efa3d5f"
        );
        assert_eq!(key.address, "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");
    }

    #[test]
    fn evm_matches_hardhat_vector() {
        let seed = seed_of(JUNK_PHRASE);
        let key = evm_address(&seed, "m/44'/60'/0'/0/0").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        );
        assert_eq!(key.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    }

    #[test]
    fn tron_matches_reference() {
        let seed = seed_of(PHRASE);
        let key = tron_address(&seed, "m/44'/195'/0'/0/0").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "8ede55b42e315eb58ad4d98cbb3be223ae197708e015d8b635a47696f920c1a3"
        );
        assert_eq!(key.address, "TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqy");
    }

    #[test]
    fn solana_matches_reference() {
        let seed = seed_of(PHRASE);
        let key = solana_address(&seed, "m/44'/501'/0'/0'").unwrap();
        assert_eq!(
            hex::encode(key.private_key),
            "7c139e1a603ca04f5f7cff194e1bb6f6d1b9098470ea90695ab628488a9f921b"
        );
        assert_eq!(key.address, "3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx");
    }

    /// TON vectors from the official `tonsdk`/`ton-crypto` test suite.
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
    fn ton_address_matches_tonsdk_for_known_public_key() {
        let public_key: [u8; 32] = hex::decode(
            "28bfb5e779a72d5990f8ac20c307a2abe8c735fcc608f37cf18b25d93a4ac6ef",
        )
        .unwrap()
        .try_into()
        .unwrap();
        assert_eq!(
            ton_v4r2_address(&public_key),
            "EQDukJBiHUD3z4BUBYwV3ZRkCJoIWVN+r95pKEmVZo5MhQM/"
        );
    }

    #[test]
    fn address_validators_accept_real_addresses() {
        assert!(is_valid_evm_address("0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb"));
        assert!(is_valid_evm_address("0xf278cf59f82edcf871d630f28ecc8056f25c1cdb"));
        assert!(is_valid_tron_address("TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqy"));
        assert!(is_valid_solana_address(
            "3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx"
        ));
        assert!(is_valid_ton_address(
            "EQDukJBiHUD3z4BUBYwV3ZRkCJoIWVN+r95pKEmVZo5MhQM/"
        ));
    }

    #[test]
    fn address_validators_reject_corrupt_input() {
        // Broken EIP-55 checksum: valid hex, wrong capitalisation.
        assert!(!is_valid_evm_address("0xF278cF59F82eDcf871d630F28EcC8056f25C1cdB"));
        assert!(!is_valid_evm_address("0x1234"));
        assert!(!is_valid_tron_address("TXpej61GoRbHVfD1zhCgvZYteYmJuYRrqZ"));
        assert!(!is_valid_solana_address("not-base58-0OIl"));
        assert!(!is_valid_ton_address(
            "EQDukJBiHUD3z4BUBYwV3ZRkCJoIWVN+r95pKEmVZo5MhQM+"
        ));
    }

    #[test]
    fn base58check_roundtrip() {
        let payload = [0x41u8; 21];
        let encoded = base58check_encode(&payload);
        assert_eq!(base58check_decode(&encoded).unwrap(), payload.to_vec());
        assert!(base58check_decode("1111").is_none());
    }
}
