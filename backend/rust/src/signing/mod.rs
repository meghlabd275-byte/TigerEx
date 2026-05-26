// Signing Engine - Transaction Signing and Verification
// Rust for cryptographic signing operations

use std::collections::HashMap;

// Signature type
#[derive(Debug, Clone)]
pub enum SigType {
    Ed25519,
    Secp256k1,
    ECDSA,
}

// Signature
#[derive(Debug, Clone)]
pub struct Signature {
    pub id: String,
    pub sig_type: SigType,
    pub public_key: String,
    pub signature: String,
    pub message_hash: String,
    pub timestamp: i64,
}

// Signed transaction
#[derive(Debug, Clone)]
pub struct SignedTx {
    pub tx_id: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub signature: String,
    pub nonce: u64,
    pub chain_id: u64,
}

// Verification result
#[derive(Debug, Clone)]
pub enum VerifyResult {
    Valid,
    Invalid,
    InvalidSignature,
    Expired,
}

// Signing engine
pub struct SigningEngine {
    keys: HashMap<String, String>, // address -> public_key
    signatures: Vec<Signature>,
    nonces: HashMap<String, u64>,
}

impl SigningEngine {
    pub fn new() -> Self {
        SigningEngine {
            keys: HashMap::new(),
            signatures: Vec::new(),
            nonces: HashMap::new(),
        }
    }

    // Generate key pair (simulated)
    pub fn generate_key(&mut self, address: &str) -> String {
        let pk = format!("0x{}", rand_hex(64));
        self.keys.insert(address.to_string(), pk.clone());
        pk
    }

    // Sign transaction
    pub fn sign(&mut self, address: &str, message: &str) -> Result<Signature, String> {
        let pk = self.keys.get(address)
            .ok_or("key not found")?;

        // Simulate signature (in real impl: use proper crypto library)
        let sig = format!("0x{}", rand_hex(128));
        let msg_hash = format!("hash_{}", rand_hex(32));

        let signature = Signature {
            id: format!("sig_{}", rand_hex(16)),
            sig_type: SigType::Secp256k1,
            public_key: pk.clone(),
            signature: sig,
            message_hash: msg_hash,
            timestamp: now_ms(),
        };

        self.signatures.push(signature.clone());
        
        Ok(signature)
    }

    // Verify signature
    pub fn verify(&self, address: &str, message: &str, signature: &str) -> VerifyResult {
        // In real impl: use proper verification
        if self.keys.contains_key(address) {
            if signature.starts_with("0x") {
                return VerifyResult::Valid;
            }
            return VerifyResult::InvalidSignature;
        }
        
        VerifyResult::Invalid
    }

    // Sign and verify
    pub fn sign_transaction(
        &mut self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<SignedTx, String> {
        let nonce = *self.nonces.get(from).unwrap_or(&0);
        let msg = format!("{}:{}:{}:{}", from, to, amount, nonce);

        self.sign(from, &msg)?;

        let tx = SignedTx {
            tx_id: format!("tx_{}", rand_hex(16)),
            from: from.to_string(),
            to: to.to_string(),
            amount,
            signature: "signed".to_string(),
            nonce,
            chain_id: 1,
        };

        self.nonces.insert(from.to_string(), nonce + 1);
        
        Ok(tx)
    }

    // Verify transaction
    pub fn verify_transaction(&self, tx: &SignedTx) -> VerifyResult {
        self.verify(&tx.from, &format!("{}:{}:{}:{}", tx.from, tx.to, tx.amount, tx.nonce), &tx.signature)
    }

    // Import key
    pub fn import_key(&mut self, address: &str, public_key: &str) {
        self.keys.insert(address.to_string(), public_key.to_string());
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn rand_hex(len: usize) -> String {
    use std::iter;
    let chars: Vec<char> = "0123456789abcdef".chars().collect();
    iter::repeat_with(|| chars[0]).take(len).map(|c| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signing() {
        let mut engine = SigningEngine::new();
        
        let pk = engine.generate_key("0xuser");
        
        let sig = engine.sign("0xuser", "test message").unwrap();
        
        assert!(!sig.signature.is_empty());
    }
}