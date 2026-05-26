//! TigerEx Security Auditing System
//! 
//! Comprehensive security testing, vulnerability scanning,
//! smart contract audits, penetration testing, bug bounty
//! 
//! Migration from TypeScript to Rust

/// Audit type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditType {
    SmartContract,
    PenetrationTest,
    CodeReview,
    Infrastructure,
    Compliance,
    ThirdParty,
}

impl Default for AuditType {
    fn default() -> Self {
        AuditType::CodeReview
    }
}

/// Audit severity levels
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditSeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl Default for AuditSeverity {
    fn default() -> Self {
        AuditSeverity::Info
    }
}

/// Audit status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditStatus {
    Scheduled,
    InProgress,
    Completed,
    Failed,
}

impl Default for AuditStatus {
    fn default() -> Self {
        AuditStatus::Scheduled
    }
}

/// Vulnerability status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VulnerabilityStatus {
    Open,
    InProgress,
    Resolved,
    FalsePositive,
}

/// Vulnerability record
#[derive(Debug, Clone)]
pub struct Vulnerability {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: AuditSeverity,
    pub category: String,
    pub affected_component: String,
    pub remediation: String,
    pub cvss_score: Option<f64>,
    pub cwe_id: Option<String>,
    pub status: VulnerabilityStatus,
}

impl Vulnerability {
    pub fn new(title: String, description: String, severity: AuditSeverity) -> Self {
        Vulnerability {
            id: format!("vuln_{}", chrono::Utc::now().timestamp()),
            title,
            description,
            severity,
            category: String::new(),
            affected_component: String::new(),
            remediation: String::new(),
            cvss_score: None,
            cwe_id: None,
            status: VulnerabilityStatus::Open,
        }
    }
}

/// Audit record
#[derive(Debug, Clone)]
pub struct Audit {
    pub id: String,
    pub audit_type: AuditType,
    pub target: String,
    pub severity: AuditSeverity,
    pub status: AuditStatus,
    pub findings: Vec<Vulnerability>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub auditor: Option<String>,
}

impl Audit {
    pub fn new(audit_type: AuditType, target: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        Audit {
            id: format!("audit_{}", now),
            audit_type,
            target,
            severity: AuditSeverity::Info,
            status: AuditStatus::Scheduled,
            findings: Vec::new(),
            started_at: now,
            completed_at: None,
            auditor: None,
        }
    }
}

/// Security testing service
pub struct SecurityAuditor {
    audits: std::collections::HashMap<String, Audit>,
    vulnerabilities: std::collections::HashMap<String, Vulnerability>,
}

impl Default for SecurityAuditor {
    fn default() -> Self {
        Self::new()
    }
}

impl SecurityAuditor {
    pub fn new() -> Self {
        SecurityAuditor {
            audits: std::collections::HashMap::new(),
            vulnerabilities: std::collections::HashMap::new(),
        }
    }

    /// Schedule new audit
    pub fn schedule_audit(&mut self, audit_type: AuditType, target: String) -> String {
        let audit = Audit::new(audit_type, target);
        let id = audit.id.clone();
        self.audits.insert(id.clone(), audit);
        id
    }

    /// Start audit
    pub fn start_audit(&mut self, audit_id: &str, auditor: String) -> bool {
        if let Some(audit) = self.audits.get_mut(audit_id) {
            audit.status = AuditStatus::InProgress;
            audit.auditor = Some(auditor);
            return true;
        }
        false
    }

    /// Complete audit
    pub fn complete_audit(&mut self, audit_id: &str) -> bool {
        if let Some(audit) = self.audits.get_mut(audit_id) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            
            audit.status = AuditStatus::Completed;
            audit.completed_at = Some(now);
            return true;
        }
        false
    }

    /// Add vulnerability finding
    pub fn add_finding(&mut self, audit_id: &str, vuln: Vulnerability) -> bool {
        if let Some(audit) = self.audits.get_mut(audit_id) {
            // Update audit severity if critical
            if vuln.severity == AuditSeverity::Critical {
                audit.severity = AuditSeverity::Critical;
            } else if vuln.severity == AuditSeverity::High && audit.severity == AuditSeverity::Info {
                audit.severity = AuditSeverity::High;
            }
            
            audit.findings.push(vuln.clone());
            self.vulnerabilities.insert(vuln.id.clone(), vuln);
            return true;
        }
        false
    }

    /// Get critical vulnerabilities
    pub fn get_critical_vulnerabilities(&self) -> Vec<&Vulnerability> {
        self.vulnerabilities
            .values()
            .filter(|v| v.severity == AuditSeverity::Critical)
            .collect()
    }

    /// Get audit by ID
    pub fn get_audit(&self, audit_id: &str) -> Option<&Audit> {
        self.audits.get(audit_id)
    }

    /// Calculate CVSS score
    pub fn calculate_cvss(&self, vuln: &Vulnerability) -> f64 {
        // Simplified CVSS calculation
        match vuln.severity {
            AuditSeverity::Critical => 9.0,
            AuditSeverity::High => 7.0,
            AuditSeverity::Medium => 5.0,
            AuditSeverity::Low => 3.0,
            AuditSeverity::Info => 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schedule_audit() {
        let mut auditor = SecurityAuditor::new();
        
        let audit_id = auditor.schedule_audit(AuditType::SmartContract, "contract.eth".to_string());
        
        assert!(!audit_id.is_empty());
    }

    #[test]
    fn test_add_finding() {
        let mut auditor = SecurityAuditor::new();
        
        let audit_id = auditor.schedule_audit(AuditType::PenetrationTest, "api.tigerex.com".to_string());
        auditor.start_audit(&audit_id, "security team".to_string());
        
        let vuln = Vulnerability::new(
            "SQL Injection".to_string(),
            "Possible SQL injection in user input".to_string(),
            AuditSeverity::High,
        );
        
        let result = auditor.add_finding(&audit_id, vuln);
        assert!(result);
    }
}