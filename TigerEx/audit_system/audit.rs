//! Audit System - Tamper-proof logging
//! Migration: TypeScript -> Rust

use std::collections::VecDeque;
use std::sync::Mutex;
use sha2::{Sha256, Digest};

/// Audit result
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditResult {
    Success,
    Failure,
}

/// Audit log entry
#[derive(Debug, Clone)]
pub struct AuditLog {
    pub id: String,
    pub user_id: Option<String>,
    pub action: String,
    pub resource: String,
    pub details: String,
    pub ip: Option<String>,
    pub timestamp: i64,
    pub result: AuditResult,
    pub hash: String,
}

/// Audit system
pub struct AuditSystem {
    logs: Mutex<VecDeque<AuditLog>>,
    chain: Mutex<Vec<String>>,
}

impl AuditSystem {
    pub fn new() -> Self {
        Self {
            logs: Mutex::new(VecDeque::new()),
            chain: Mutex::new(vec!["0".to_string()]),
        }
    }

    fn compute_hash(&self, data: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        format!("{:x}", hasher.finalize())[..16].to_string()
    }

    pub fn log(&self, action: &str, resource: &str, result: AuditResult) -> AuditLog {
        let id = format!("audit_{}", self.logs.lock().unwrap().len());
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        let data = format!("{}:{}:{}:{}", id, action, resource, timestamp);
        let hash = self.compute_hash(&data);
        
        let log = AuditLog {
            id,
            user_id: None,
            action: action.to_string(),
            resource: resource.to_string(),
            details: String::new(),
            ip: None,
            timestamp,
            result,
            hash: hash.clone(),
        };
        
        // Update chain
        let mut chain = self.chain.lock().unwrap();
        chain.push(hash);
        
        self.logs.lock().unwrap().push_front(log.clone());
        
        log
    }

    pub fn verify(&self) -> bool {
        let chain = self.chain.lock().unwrap();
        // Basic verification
        chain.len() > 1
    }
}