//! Digital signatures module
//! 
//! Provides Ed25519 and ECDSA signature functionality

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use crate::errors::{Result, SecurityError};

/// Ed25519 Signer
pub struct Ed25519Signer {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}

impl Ed25519Signer {
    /// Generate a new Ed25519 key pair
    pub fn generate() -> Result<Self> {
        let mut csprng = rand::thread_rng();
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        
        Ok(Self {
            signing_key,
            verifying_key,
        })
    }

    /// Create a signer from existing key bytes
    pub fn from_bytes(signing_key_bytes: &[u8]) -> Result<Self> {
        if signing_key_bytes.len() != 32 {
            return Err(SecurityError::InvalidKey("Key must be 32 bytes".to_string()));
        }
        
        let signing_key = SigningKey::from_bytes(
            signing_key_bytes.try_into()
                .map_err(|_| SecurityError::InvalidKey("Invalid key length".to_string()))?
        );
        let verifying_key = signing_key.verifying_key();
        
        Ok(Self {
            signing_key,
            verifying_key,
        })
    }

    /// Sign a message
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let signature = self.signing_key.sign(message);
        signature.to_bytes().to_vec()
    }

    /// Get the verifying key (public key)
    pub fn verifying_key(&self) -> Vec<u8> {
        self.verifying_key.to_bytes().to_vec()
    }
}

/// Ed25519 Verifier
pub struct Ed25519Verifier {
    verifying_key: VerifyingKey,
}

impl Ed25519Verifier {
    /// Create a verifier from public key bytes
    pub fn from_bytes(public_key_bytes: &[u8]) -> Result<Self> {
        if public_key_bytes.len() != 32 {
            return Err(SecurityError::InvalidKey("Public key must be 32 bytes".to_string()));
        }
        
        let verifying_key = VerifyingKey::from_bytes(
            public_key_bytes.try_into()
                .map_err(|_| SecurityError::InvalidKey("Invalid key length".to_string()))?
        )
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
        
        Ok(Self { verifying_key })
    }

    /// Verify a signature
    pub fn verify(&self, message: &[u8], signature: &[u8]) -> Result<bool> {
        if signature.len() != 64 {
            return Err(SecurityError::InvalidSignature("Signature must be 64 bytes".to_string()));
        }
        
        let signature_bytes: [u8; 64] = signature.try_into()
            .map_err(|_| SecurityError::InvalidSignature("Invalid signature length".to_string()))?;
        
        let signature_obj = Signature::from_bytes(&signature_bytes);
        
        Ok(self.verifying_key.verify(message, &signature_obj).is_ok())
    }
}

/// Transaction signer for blockchain operations
pub struct TransactionSigner {
    signer: Ed25519Signer,
}

impl TransactionSigner {
    pub fn new() -> Result<Self> {
        Ok(Self {
            signer: Ed25519Signer::generate()?,
        })
    }

    pub fn from_private_key(private_key: &[u8]) -> Result<Self> {
        Ok(Self {
            signer: Ed25519Signer::from_bytes(private_key)?,
        })
    }

    /// Sign a transaction
    pub fn sign_transaction(&self, transaction_data: &[u8]) -> TransactionSignature {
        let signature = self.signer.sign(transaction_data);
        let public_key = self.signer.verifying_key();
        
        TransactionSignature {
            signature,
            public_key,
            algorithm: "Ed25519".to_string(),
        }
    }
}

impl Default for TransactionSigner {
    fn default() -> Self {
        Self::new().expect("Failed to generate transaction signer")
    }
}

/// Transaction signature
#[derive(Debug, Clone)]
pub struct TransactionSignature {
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
    pub algorithm: String,
}

impl TransactionSignature {
    pub fn to_hex(&self) -> String {
        format!(
            "{}:{}:{}",
            self.algorithm,
            hex::encode(&self.public_key),
            hex::encode(&self.signature)
        )
    }

    pub fn from_hex(hex_str: &str) -> Result<Self> {
        let parts: Vec<&str> = hex_str.split(':').collect();
        if parts.len() != 3 {
            return Err(SecurityError::InvalidSignature("Invalid format".to_string()));
        }

        let algorithm = parts[0].to_string();
        let public_key = hex::decode(parts[1])
            .map_err(|e| SecurityError::EncodingError(e.to_string()))?;
        let signature = hex::decode(parts[2])
            .map_err(|e| SecurityError::EncodingError(e.to_string()))?;

        Ok(Self {
            signature,
            public_key,
            algorithm,
        })
    }
}

/// Verify a transaction signature
pub fn verify_transaction(
    transaction_data: &[u8],
    signature: &TransactionSignature,
) -> Result<bool> {
    let verifier = Ed25519Verifier::from_bytes(&signature.public_key)?;
    verifier.verify(transaction_data, &signature.signature)
}

/// Multi-signature support for cold wallet
pub struct MultiSigSigner {
    signers: Vec<Ed25519Signer>,
    threshold: usize,
}

impl MultiSigSigner {
    pub fn new(signers: Vec<Ed25519Signer>, threshold: usize) -> Self {
        Self { signers, threshold }
    }

    /// Create a multi-signature
    pub fn sign(&self, message: &[u8]) -> Vec<Vec<u8>> {
        self.signers.iter()
            .take(self.threshold)
            .map(|s| s.sign(message))
            .collect()
    }

    pub fn threshold(&self) -> usize {
        self.threshold
    }

    pub fn total_signers(&self) -> usize {
        self.signers.len()
    }
}

/// Verify multi-signature
pub fn verify_multisig(
    message: &[u8],
    signatures: &[Vec<u8>],
    public_keys: &[Vec<u8>],
    threshold: usize,
) -> Result<bool> {
    if signatures.len() < threshold {
        return Ok(false);
    }

    for i in 0..threshold {
        let verifier = Ed25519Verifier::from_bytes(&public_keys[i])?;
        if !verifier.verify(message, &signatures[i])? {
            return Ok(false);
        }
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ed25519_sign_verify() {
        let signer = Ed25519Signer::generate().unwrap();
        let message = b"Test message for TigerEx";
        
        let signature = signer.sign(message);
        assert_eq!(signature.len(), 64);
        
        let verifier = Ed25519Verifier::from_bytes(&signer.verifying_key()).unwrap();
        assert!(verifier.verify(message, &signature).unwrap());
        
        // Test with wrong message
        assert!(!verifier.verify(b"Wrong message", &signature).unwrap());
    }

    #[test]
    fn test_transaction_signature() {
        let signer = TransactionSigner::new().unwrap();
        
        let transaction = b"Transfer 100 USDT from A to B";
        let sig = signer.sign_transaction(transaction);
        
        assert!(verify_transaction(transaction, &sig).unwrap());
    }

    #[test]
    fn test_multisig() {
        let signer1 = Ed25519Signer::generate().unwrap();
        let signer2 = Ed25519Signer::generate().unwrap();
        let signer3 = Ed25519Signer::generate().unwrap();
        
        let multisig = MultiSigSigner::new(vec![signer1, signer2, signer3], 2);
        let message = b"Multi-sig transaction";
        
        let signatures = multisig.sign(message);
        assert_eq!(signatures.len(), 2);
        
        let public_keys = vec![
            multisig.signers[0].verifying_key(),
            multisig.signers[1].verifying_key(),
        ];
        
        let pub_keys_bytes: Vec<Vec<u8>> = public_keys.iter()
            .map(|k| k.to_bytes().to_vec())
            .collect();
        
        assert!(verify_multisig(message, &signatures, &pub_keys_bytes, 2).unwrap());
    }
}
