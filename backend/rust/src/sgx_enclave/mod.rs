// SGX Enclave Simulation - Secure Execution Environment
// Migrated from TypeScript to Rust for hardware-level security

/*
Note: This is a simulation of SGX (Software Guard Extensions) functionality.
Real SGX requires Intel CPU with SGX support and special SDK.
*/

use std::collections::HashMap;

// Enclave type
#[derive(Debug, Clone)]
pub enum EnclaveType {
    General,
    Trading,
    Wallet,
    Settlement,
}

// Enclave state
#[derive(Debug, Clone)]
pub enum EnclaveState {
    Init,
    Running,
    Trusted,
    Terminated,
}

// Enclave instance
#[derive(Debug, Clone)]
pub struct Enclave {
    pub enclave_id: String,
    pub enclave_type: EnclaveType,
    pub state: EnclaveState,
    pub measurements: Vec<u8>,
    pub created_at: i64,
}

// Attestation report
#[derive(Debug, Clone)]
pub struct AttestationReport {
    pub enclave_id: String,
    pub quote: Vec<u8>,
    pub measurements: Vec<u8>,
    pub timestamp: i64,
}

// Enclave manager
pub struct EnclaveManager {
    enclaves: HashMap<String, Enclave>,
    attested: HashMap<String, AttestationReport>,
}

impl EnclaveManager {
    pub fn new() -> Self {
        EnclaveManager {
            enclaves: HashMap::new(),
            attested: HashMap::new(),
        }
    }

    pub fn create_enclave(&mut self, enclave_type: EnclaveType) -> String {
        let enclave_id = format!("enclave_{}", random_id());
        
        let enclave = Enclave {
            enclave_id: enclave_id.clone(),
            enclave_type,
            state: EnclaveState::Init,
            measurements: vec![0u8; 32],
            created_at: now_ms(),
        };
        
        self.enclaves.insert(enclave_id.clone(), enclave);
        enclave_id
    }

    pub fn start(&mut self, enclave_id: &str) -> Result<(), String> {
        if let Some(enclave) = self.enclaves.get_mut(enclave_id) {
            enclave.state = EnclaveState::Running;
            return Ok(());
        }
        Err("enclave not found".to_string())
    }

    pub fn attest(&mut self, enclave_id: &str) -> Result<AttestationReport, String> {
        if let Some(enclave) = self.enclaves.get(enclave_id) {
            if let EnclaveState::Running = enclave.state {
                let report = AttestationReport {
                    enclave_id: enclave_id.to_string(),
                    quote: vec![0u8; 432],
                    measurements: enclave.measurements.clone(),
                    timestamp: now_ms(),
                };
                
                self.attested.insert(enclave_id.to_string(), report);
                
                if let Some(e) = self.enclaves.get_mut(enclave_id) {
                    e.state = EnclaveState::Trusted;
                }
                
                return Ok(report);
            }
        }
        Err("attestation failed".to_string())
    }

    pub fn terminate(&mut self, enclave_id: &str) -> Result<(), String> {
        if let Some(enclave) = self.enclaves.get_mut(enclave_id) {
            enclave.state = EnclaveState::Terminated;
            return Ok(());
        }
        Err("enclave not found".to_string())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn random_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(16)
        .map(|c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enclave() {
        let mut mgr = EnclaveManager::new();
        let id = mgr.create_enclave(EnclaveType::Trading);
        mgr.start(&id).unwrap();
        let _report = mgr.attest(&id).unwrap();
        assert_eq!(mgr.enclaves.get(&id).unwrap().state, EnclaveState::Trusted);
    }
}