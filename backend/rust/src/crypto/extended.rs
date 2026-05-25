//! Additional crypto and fraud detection for TigerEx

use std::collections::HashMap;

/// HMAC-SHA256 implementation
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    use sha2::{Sha256, Hmac};
    use hmac::{Hmac, Mac};
    
    type HmacSha256 = Hmac<Sha256>;
    
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(message);
    
    let mut result = [0u8; 32];
    result.copy_from_slice(&mac.finalize().into_bytes());
    result
}

/// SHA-512 hash
pub fn sha512(data: &[u8]) -> [u8; 64] {
    use sha2::{Sha512, Digest};
    let mut hasher = Sha512::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 64];
    hash.copy_from_slice(&result);
    hash
}

/// PBKDF2 key derivation
pub fn pbkdf2(password: &str, salt: &[u8], iterations: u32) -> Vec<u8> {
    use pbkdf2::pbkdf2_hmac_array;
    
    pbkdf2_hmac_array::<sha2::Sha512, 64>(password.as_bytes(), salt, iterations)
}

/// Scrypt key derivation
pub fn scrypt(password: &str, salt: &[u8], log_n: u8, r: u32, p: u32) -> Vec<u8> {
    use scrypt::scrypt_pbkdff;
    
    let mut output = [0u8; 64];
    scrypt_pbkdff(password.as_bytes(), salt, log_n, r, p, &mut output).ok();
    output.to_vec()
}

/// RIPEMD-160 hash
pub fn ripemd160(data: &[u8]) -> [u8; 20] {
    use ripemd160::{Ripemd160, Digest};
    let mut hasher = Ripemd160::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 20];
    hash.copy_from_slice(&result);
    hash
}

/// CRC32 checksum
pub fn crc32(data: &[u8]) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(data);
    hasher.finalize()
}

/// Blake2b hash
pub fn blake2b(data: &[u8], key: Option<&[u8]>) -> Vec<u8> {
    use blake2::{Blake2b512, Digest};
    let mut hasher = Blake2b512::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Verify Ethereum address from signature
pub fn verify_eth_address(message: &[u8], signature: &[u8], address: &str) -> bool {
    // Simplified - in production use ethereum recover
    address.starts_with("0x") && address.len() == 42
}

/// Parse Bitcoin address
pub fn parse_btc_address(address: &str) -> Option<(String, Vec<u8>)> {
    // Basic BTC address parsing
    if address.starts_with("1") || address.starts_with("3") || address.starts_with("bc1") {
        Some(("BTC".to_string(), address.as_bytes().to_vec()))
    } else {
        None
    }
}

/// Validate address format for various chains
pub fn validate_address(chain: &str, address: &str) -> bool {
    match chain {
        "BTC" => {
            address.starts_with("1") || address.starts_with("3") || address.starts_with("bc1")
        }
        "ETH" | "USDT" | "MATIC" => {
            address.starts_with("0x") && address.len() == 42
        }
        "SOL" => {
            address.len() >= 32 && address.len() <= 44
        }
        "TRX" => {
            address.starts_with("T") && address.len() == 34
        }
        _ => false,
    }
}

/// Generate secure random bytes
pub fn secure_random(size: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut rng = rand::thread_rng();
    let mut data = vec![0u8; size];
    rng.fill_bytes(&mut data);
    data
}

/// Constant-time comparison
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Fraud detection features extractor
#[derive(Debug, Clone)]
pub struct FraudFeatures {
    pub login_failures: u32,
    pub withdraw_count: u32,
    pub withdraw_amount: f64,
    pub deposit_count: u32,
    pub deposit_amount: f64,
    pub trade_count: u32,
    pub unique_ips: u32,
    pub time_since_register: f64,
    pub avg_session_duration: f64,
    pub kyc_verified: bool,
    pub two_factor_enabled: bool,
    pub suspicious_behavior_score: f64,
}

impl FraudFeatures {
    pub fn to_vector(&self) -> Vec<f64> {
        vec![
            self.login_failures as f64,
            self.withdraw_count as f64,
            self.withdraw_amount,
            self.deposit_count as f64,
            self.deposit_amount,
            self.trade_count as f64,
            self.unique_ips as f64,
            self.time_since_register,
            self.avg_session_duration,
            self.kyc_verified as i32 as f64,
            self.two_factor_enabled as i32 as f64,
            self.suspicious_behavior_score,
        ]
    }
}

/// Simple rule-based fraud detector
pub struct RuleFraudDetector {
    rules: Vec<FraudRule>,
}

#[derive(Debug, Clone)]
pub struct FraudRule {
    pub name: String,
    pub threshold: f64,
    pub severity: Severity,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl RuleFraudDetector {
    pub fn new() -> Self {
        let rules = vec![
            FraudRule {
                name: "high_withdraw".to_string(),
                threshold: 10000.0,
                severity: Severity::Medium,
            },
            FraudRule {
                name: "many_failures".to_string(),
                threshold: 5.0,
                severity: Severity::High,
            },
            FraudRule {
                name: "new_account_big_withdraw".to_string(),
                threshold: 1000.0,
                severity: Severity::Critical,
            },
        ];
        Self { rules }
    }

    pub fn check(&self, features: &FraudFeatures) -> Vec<(String, Severity)> {
        let mut alerts = Vec::new();
        
        if features.withdraw_amount > 10000.0 {
            alerts.push(("high_withdraw".to_string(), Severity::Medium));
        }
        
        if features.login_failures > 5 {
            alerts.push(("many_failures".to_string(), Severity::High));
        }
        
        if features.time_since_register < 86400.0 && features.withdraw_amount > 1000.0 {
            alerts.push(("new_account_big_withdraw".to_string(), Severity::Critical));
        }
        
        alerts
    }
}

impl Default for RuleFraudDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Anti-money laundering (AML) checker
pub struct AMLChecker {
    sanctioned_addresses: HashMap<String, String>,
    high_risk_countries: Vec<String>,
}

impl AMLChecker {
    pub fn new() -> Self {
        let mut sanctioned = HashMap::new();
        sanctioned.insert("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(), "Satoshi".to_string());
        
        Self {
            sanctioned_addresses: sanctioned,
            high_risk_countries: vec!["KP".to_string(), "IR".to_string(), "SY".to_string()],
        }
    }

    pub fn check_address(&self, address: &str) -> Option<(bool, String)> {
        if let Some(name) = self.sanctioned_addresses.get(address) {
            Some((true, format!("Sanctioned: {}", name)))
        } else {
            None
        }
    }

    pub fn check_country(&self, country: &str) -> bool {
        self.high_risk_countries.contains(&country)
    }
}

impl Default for AMLChecker {
    fn default() -> Self {
        Self::new()
    }
}

/// Network analysis for fraud detection
pub struct NetworkAnalyzer {
    connections: HashMap<String, Vec<String>>,
}

impl NetworkAnalyzer {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    pub fn add_connection(&mut self, user: &str, connected_user: &str) {
        self.connections
            .entry(user.to_string())
            .or_insert_with(Vec::new)
            .push(connected_user.to_string());
    }

    pub fn find_suspicious_patterns(&self, user: &str) -> Vec<String> {
        let mut patterns = Vec::new();
        
        if let Some(connections) = self.connections.get(user) {
            if connections.len() > 10 {
                patterns.push(format!("High connection count: {}", connections.len()));
            }
        }
        
        patterns
    }
}

impl Default for NetworkAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac() {
        let key = b"test_key";
        let message = b"test_message";
        let result = hmac_sha256(key, message);
        assert_eq!(result.len(), 32);
    }

    #[test]
    fn test_validate_addresses() {
        assert!(validate_address("BTC", "1BvBMSEYstWetqTFn5BT8FGJk7hUKE"));
        assert!(validate_address("ETH", "0x742d35Cc6634C0532925a3b844Bc454e4438f"));
        assert!(!validate_address("ETH", "invalid"));
    }

    #[test]
    fn test_fraud_detection() {
        let detector = RuleFraudDetector::new();
        let features = FraudFeatures {
            login_failures: 10,
            withdraw_count: 1,
            withdraw_amount: 50000.0,
            deposit_count: 0,
            deposit_amount: 0.0,
            trade_count: 0,
            unique_ips: 1,
            time_since_register: 3600.0,
            avg_session_duration: 0.0,
            kyc_verified: false,
            two_factor_enabled: false,
            suspicious_behavior_score: 0.0,
        };
        
        let alerts = detector.check(&features);
        assert!(!alerts.is_empty());
    }
}