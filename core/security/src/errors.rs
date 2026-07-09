//! Error types for the security module

use thiserror::Error;

#[derive(Error, Debug)]
pub enum SecurityError {
    #[error("Encryption failed: {0}")]
    EncryptionError(String),
    
    #[error("Decryption failed: {0}")]
    DecryptionError(String),
    
    #[error("Key generation failed: {0}")]
    KeyGenerationError(String),
    
    #[error("Invalid key: {0}")]
    InvalidKey(String),
    
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),
    
    #[error("Signature verification failed: {0}")]
    SignatureVerificationError(String),
    
    #[error("Hashing error: {0}")]
    HashingError(String),
    
    #[error("Invalid hash: {0}")]
    InvalidHash(String),
    
    #[error("Storage error: {0}")]
    StorageError(String),
    
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    #[error("Random number generation error: {0}")]
    RandomError(String),
    
    #[error("Encoding error: {0}")]
    EncodingError(String),
}

pub type Result<T> = std::result::Result<T, SecurityError>;

impl From<ring::error::Error> for SecurityError {
    fn from(err: ring::error::Error) -> Self {
        SecurityError::EncryptionError(err.to_string())
    }
}

impl From<base64::DecodeError> for SecurityError {
    fn from(err: base64::DecodeError) -> Self {
        SecurityError::EncodingError(err.to_string())
    }
}

impl From<hex::FromHexError> for SecurityError {
    fn from(err: hex::FromHexError) -> Self {
        SecurityError::EncodingError(err.to_string())
    }
}
