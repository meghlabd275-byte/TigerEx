// TigerEx DDoS Protection
// Built with Rust for high speed with ultra-low latency

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct Request {
    pub ip: String,
    pub path: String,
    pub method: String,
    pub timestamp: u64,
    pub size: usize,
}

#[derive(Clone)]
pub struct IPPolicy {
    pub ip: String,
    pub requests: u64,
    pub blocked: bool,
    pub score: u64,
    pub first_seen: u64,
    pub last_seen: u64,
}

pub struct DDoSProtection {
    policies: Arc<RwLock<HashMap<String, IPPolicy>>>,
    stats: Arc<RwLock<ProtectionStats>>,
    config: ProtectionConfig,
}

#[derive(Clone)]
pub struct ProtectionConfig {
    pub requests_per_minute: u64,
    pub requests_per_hour: u64,
    pub block_threshold: u64,
    pub score_threshold: u64,
}

#[derive(Clone, Default)]
pub struct ProtectionStats {
    pub total_requests: u64,
    pub blocked_requests: u64,
    pub flagged_ips: u64,
    pub whitelisted: u64,
}

impl DDoSProtection {
    pub fn new(config: ProtectionConfig) -> Self {
        Self {
            policies: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(ProtectionStats::default())),
            config,
        }
    }
    
    pub fn check_request(&self, request: &Request) -> bool {
        let timestamp = current_time();
        
        // Update stats
        {
            let mut stats = self.stats.write().unwrap();
            stats.total_requests += 1;
        }
        
        // Get or create policy
        let mut should_block = false;
        
        {
            let mut policies = self.policies.write().unwrap();
            let policy = policies.entry(request.ip.clone()).or_insert(IPPolicy {
                ip: request.ip.clone(),
                requests: 0,
                blocked: false,
                score: 0,
                first_seen: timestamp,
                last_seen: timestamp,
            });
            
            policy.requests += 1;
            policy.last_seen = timestamp;
            
            // Calculate threat score
            if policy.requests > self.config.requests_per_minute {
                policy.score += 10;
            }
            
            if policy.score >= self.config.score_threshold {
                policy.blocked = true;
                should_block = true;
            }
        }
        
        if should_block {
            let mut stats = self.stats.write().unwrap();
            stats.blocked_requests += 1;
        }
        
        !should_block
    }
    
    pub fn whitelist_ip(&self, ip: &str) {
        let mut policies = self.policies.write().unwrap();
        if let Some(policy) = policies.get_mut(ip) {
            policy.blocked = false;
        }
        
        let mut stats = self.stats.write().unwrap();
        stats.whitelisted += 1;
    }
    
    pub fn block_ip(&self, ip: &str) {
        let mut policies = self.policies.write().unwrap();
        if let Some(policy) = policies.get_mut(ip) {
            policy.blocked = true;
            policy.score = 1000;
        }
    }
    
    pub fn get_stats(&self) -> ProtectionStats {
        let stats = self.stats.read().unwrap();
        stats.clone()
    }
    
    pub fn get_blocked_ips(&self) -> Vec<String> {
        let policies = self.policies.read().unwrap();
        policies.iter()
            .filter(|(_, p)| p.blocked)
            .map(|(ip, _)| ip.clone())
            .collect()
    }
}

fn current_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn main() {
    println!("TigerEx DDoS Protection (Rust)");
    
    let config = ProtectionConfig {
        requests_per_minute: 60,
        requests_per_hour: 1000,
        block_threshold: 100,
        score_threshold: 50,
    };
    
    let protection = DDoSProtection::new(config);
    
    // Simulate requests
    for i in 0..100 {
        let request = Request {
            ip: "192.168.1.1".to_string(),
            path: "/api/test".to_string(),
            method: "GET".to_string(),
            timestamp: current_time(),
            size: 1024,
        };
        
        let allowed = protection.check_request(&request);
        if !allowed {
            println!("Request {} BLOCKED", i + 1);
        }
    }
    
    let stats = protection.get_stats();
    println!("\nStats:");
    println!("  Total: {}", stats.total_requests);
    println!("  Blocked: {}", stats.blocked_requests);
    
    let blocked = protection.get_blocked_ips();
    println!("  Blocked IPs: {}", blocked.len());
}
