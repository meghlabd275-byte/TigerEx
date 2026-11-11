// TigerEx MPC Wallet Service
//
// Threshold ECDSA/EdDSA custody. The key-material operations below are
// deliberately unimplemented: a wallet that cannot run a real threshold signing
// protocol must refuse, never emit a fabricated share, address or signature.
// Every fallible path returns MpcError instead of a placeholder value, so a
// deployment cannot mistake a demo for working custody.

use std::collections::HashMap;

/// Error returned by an operation that requires the real MPC protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MpcError {
    WalletNotFound,
    /// The threshold signing / key-generation protocol is not wired.
    ProtocolUnavailable,
    InvalidParameters(String),
}

impl std::fmt::Display for MpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MpcError::WalletNotFound => write!(f, "wallet not found"),
            MpcError::ProtocolUnavailable => write!(f, "MPC protocol is not available"),
            MpcError::InvalidParameters(m) => write!(f, "invalid parameters: {}", m),
        }
    }
}

impl std::error::Error for MpcError {}

#[derive(Debug, Clone)]
pub struct MPCKeyShare {
    pub id: String,
    pub user_id: String,
    pub share_index: u32,
    /// The share ciphertext, produced by the real protocol and encrypted to the
    /// share holder's key. Never fabricated here.
    pub encrypted_share: Vec<u8>,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct MPCWallet {
    pub id: String,
    pub user_id: String,
    pub address: String,
    pub threshold: u32,
    pub total_shares: u32,
}

pub struct MPCService {
    wallets: HashMap<String, MPCWallet>,
    key_shares: HashMap<String, Vec<MPCKeyShare>>,
}

impl Default for MPCService {
    fn default() -> Self {
        Self::new()
    }
}

impl MPCService {
    pub fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            key_shares: HashMap::new(),
        }
    }

    /// Register a wallet whose address was derived by the real key-generation
    /// ceremony. Rejects an empty address and an impossible threshold.
    pub fn register_wallet(
        &mut self,
        user_id: &str,
        address: &str,
        threshold: u32,
        total_shares: u32,
    ) -> Result<String, MpcError> {
        if address.trim().is_empty() {
            return Err(MpcError::InvalidParameters(
                "address must come from the real key-generation ceremony".into(),
            ));
        }
        if threshold == 0 || total_shares == 0 || threshold > total_shares {
            return Err(MpcError::InvalidParameters(
                "threshold must satisfy 1 <= threshold <= total_shares".into(),
            ));
        }
        let wallet_id = format!("MPC_{}", self.wallets.len());
        self.wallets.insert(
            wallet_id.clone(),
            MPCWallet {
                id: wallet_id.clone(),
                user_id: user_id.to_string(),
                address: address.to_string(),
                threshold,
                total_shares,
            },
        );
        Ok(wallet_id)
    }

    /// Generate threshold key shares.
    ///
    /// Fails closed: this requires the real distributed key-generation protocol
    /// (each share produced by its holder, never in the clear). Until that is
    /// wired, no share is produced rather than a fabricated one.
    pub fn generate_key_shares(&mut self, wallet_id: &str) -> Result<Vec<MPCKeyShare>, MpcError> {
        if !self.wallets.contains_key(wallet_id) {
            return Err(MpcError::WalletNotFound);
        }
        Err(MpcError::ProtocolUnavailable)
    }

    /// Sign a transaction with the threshold signature.
    ///
    /// Fails closed: no signature is emitted unless the real protocol produced
    /// one.
    pub fn sign_transaction(
        &mut self,
        wallet_id: &str,
        to: &str,
        amount: u64,
    ) -> Result<Vec<u8>, MpcError> {
        let _ = self.wallets.get(wallet_id).ok_or(MpcError::WalletNotFound)?;
        if to.trim().is_empty() || amount == 0 {
            return Err(MpcError::InvalidParameters(
                "destination must be non-empty and amount non-zero".into(),
            ));
        }
        Err(MpcError::ProtocolUnavailable)
    }

    pub fn get_wallet(&self, wallet_id: &str) -> Option<&MPCWallet> {
        self.wallets.get(wallet_id)
    }

    pub fn get_shares(&self, wallet_id: &str) -> Option<&Vec<MPCKeyShare>> {
        self.key_shares.get(wallet_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_address_is_rejected() {
        let mut svc = MPCService::new();
        assert!(svc.register_wallet("u1", "", 2, 3).is_err());
    }

    #[test]
    fn impossible_threshold_is_rejected() {
        let mut svc = MPCService::new();
        assert!(svc.register_wallet("u1", "0xabc", 4, 3).is_err());
        assert!(svc.register_wallet("u1", "0xabc", 0, 3).is_err());
    }

    #[test]
    fn share_generation_fails_closed_without_the_protocol() {
        let mut svc = MPCService::new();
        let id = svc.register_wallet("u1", "0xabc", 2, 3).unwrap();
        assert!(matches!(svc.generate_key_shares(&id), Err(MpcError::ProtocolUnavailable)));
    }

    #[test]
    fn signing_fails_closed_and_never_fabricates() {
        let mut svc = MPCService::new();
        let id = svc.register_wallet("u1", "0xabc", 2, 3).unwrap();
        assert!(matches!(
            svc.sign_transaction(&id, "0xdest", 1_000_000),
            Err(MpcError::ProtocolUnavailable)
        ));
        assert!(matches!(
            svc.sign_transaction("missing", "0xdest", 1),
            Err(MpcError::WalletNotFound)
        ));
    }
}

fn main() {
    let mut svc = MPCService::new();
    let id = svc.register_wallet("u1", "0xabc", 2, 3).expect("register");
    println!("registered {}", id);
    match svc.sign_transaction(&id, "0xdest", 1_000_000) {
        Ok(_) => println!("signed"),
        Err(e) => println!("refused: {}", e),
    }
}
