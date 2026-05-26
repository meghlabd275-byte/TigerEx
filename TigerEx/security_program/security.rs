//! Security Program Platform
//! Bug bounty, penetration testing, DDoS protection
//! Migration: TypeScript -> Rust (security)

use std::collections::HashMap;
use std::sync::Mutex;

/// Vulnerability severity
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VulnerabilitySeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

/// Bug bounty program
#[derive(Debug, Clone)]
pub struct Bounty {
    pub id: String,
    pub title: String,
    pub severity: VulnerabilitySeverity,
    pub reward: f64,
    pub status: String,
    pub reported_at: i64,
}

/// Vulnerabilities found
#[derive(Debug, Clone)]
pub struct Vulnerability {
    pub id: String,
    pub title: String,
    pub severity: VulnerabilitySeverity,
    pub description: String,
    pub status: String,
    pub discovered_at: i64,
}

/// Security platform
pub struct SecurityPlatform {
    bounties: Mutex<Vec<Bounty>>,
    vulnerabilities: Mutex<Vec<Vulnerability>>,
}

impl SecurityPlatform {
    pub fn new() -> Self {
        Self {
            bounties: Mutex::new(Vec::new()),
            vulnerabilities: Mutex::new(Vec::new()),
        }
    }

    /// Report vulnerability
    pub fn report_vulnerability(&self, title: &str, severity: VulnerabilitySeverity, desc: &str) -> Vulnerability {
        let vuln = Vulnerability {
            id: format!("vuln_{}", self.vulnerabilities.lock().unwrap().len()),
            title: title.to_string(),
            severity,
            description: desc.to_string(),
            status: "open".to_string(),
            discovered_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        };
        
        self.vulnerabilities.lock().unwrap().push(vuln.clone());
        
        vuln
    }

    /// Create bounty
    pub fn create_bounty(&self, title: &str, severity: VulnerabilitySeverity) -> Bounty {
        let reward = match severity {
            VulnerabilitySeverity::Critical => 10_000.0,
            VulnerabilitySeverity::High => 5_000.0,
            VulnerabilitySeverity::Medium => 1_000.0,
            VulnerabilitySeverity::Low => 250.0,
            VulnerabilitySeverity::Info => 50.0,
        };
        
        let bounty = Bounty {
            id: format!("bounty_{}", self.bounties.lock().unwrap().len()),
            title: title.to_string(),
            severity,
            reward,
            status: "open".to_string(),
            reported_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        };
        
        self.bounties.lock().unwrap().push(bounty.clone());
        
        bounty
    }

    /// Award bounty
    pub fn award_bounty(&self, bounty_id: &str) -> bool {
        let mut bounties = self.bounties.lock().unwrap();
        
        for bounty in bounties.iter_mut() {
            if bounty.id == bounty_id && bounty.status == "open" {
                bounty.status = "paid";
                return true;
            }
        }
        
        false
    }

    /// Get critical vulnerabilities
    pub fn get_critical_count(&self) -> usize {
        self.vulnerabilities.lock().unwrap()
            .iter()
            .filter(|v| v.severity == VulnerabilitySeverity::Critical && v.status != "fixed")
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_report() {
        let sec = SecurityPlatform::new();
        
        let vuln = sec.report_vulnerability("SQL Injection", VulnerabilitySeverity::Critical, "Found in login");
        
        assert_eq!(vuln.severity, VulnerabilitySeverity::Critical);
    }

    #[test]
    fn test_bounty() {
        let sec = SecurityPlatform::new();
        
        let bounty = sec.create_bounty("XSS Bug", VulnerabilitySeverity::High);
        
        assert_eq!(bounty.reward, 5_000.0);
    }
}