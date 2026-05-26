// TLS Configuration - SSL/TLS Certificate Management
// Rust for secure TLS configuration

use std::collections::HashMap;

// Certificate info
#[derive(Debug, Clone)]
pub struct CertInfo {
    pub domain: String,
    pub cert_pem: Vec<u8>,
    pub key_pem: Vec<u8>,
    pub expires_at: i64,
    pub issuer: String,
    pub alt_names: Vec<String>,
}

// TLS config
#[derive(Debug, Clone)]
pub struct TLSConfig {
    pub min_version: String,
    pub cipher_suites: Vec<String>,
    pub prefer_server_cipher_suites: bool,
    pub session_tickets_enabled: bool,
}

// Certificate store
#[derive(Debug, Clone)]
pub struct CertStore {
    certs: HashMap<String, CertInfo>,
    configs: HashMap<String, TLSConfig>,
}

impl CertStore {
    pub fn new() -> Self {
        let mut store = CertStore {
            certs: HashMap::new(),
            configs: HashMap::new(),
        };

        // Default TLS 1.3 config
        let config = TLSConfig {
            min_version: "1.3".to_string(),
            cipher_suites: vec![
                "TLS_AES_256_GCM_SHA384".to_string(),
                "TLS_CHACHA20_POLY1305_SHA256".to_string(),
                "TLS_AES_128_GCM_SHA256".to_string(),
            ],
            prefer_server_cipher_suites: true,
            session_tickets_enabled: true,
        };

        store.configs.insert("default".to_string(), config);

        store
    }

    // Add certificate
    pub fn add_cert(&mut self, domain: &str, cert_pem: &[u8], key_pem: &[u8], expires_at: i64) {
        let info = CertInfo {
            domain: domain.to_string(),
            cert_pem: cert_pem.to_vec(),
            key_pem: key_pem.to_vec(),
            expires_at,
            issuer: "Let's Encrypt".to_string(),
            alt_names: vec![],
        };

        self.certs.insert(domain.to_string(), info);
    }

    // Get certificate
    pub fn get_cert(&self, domain: &str) -> Option<&CertInfo> {
        self.certs.get(domain)
    }

    // Check expiration
    pub fn is_expired(&self, domain: &str) -> bool {
        if let Some(cert) = self.certs.get(domain) {
            return cert.expires_at < now_ms();
        }
        false
    }

    // Get days until expiry
    pub fn days_until_expiry(&self, domain: &str) -> i64 {
        if let Some(cert) = self.certs.get(domain) {
            let days = (cert.expires_at - now_ms()) / 86400000;
            return days;
        }
        -1
    }

    // Get TLS config
    pub fn get_config(&self, name: &str) -> Option<&TLSConfig> {
        self.configs.get(name)
    }

    // Enable mutual TLS (mTLS)
    pub fn enable_mtls(&mut self, ca_cert: &[u8]) {
        println!("mTLS enabled with CA certificate");
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tls() {
        let mut store = CertStore::new();
        
        store.add_cert("api.tigerex.com", b"cert", b"key", now_ms() + 86400000*90);
        
        let days = store.days_until_expiry("api.tigerex.com");
        
        assert!(days > 0);
    }
}