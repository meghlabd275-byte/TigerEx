//! Insurance Protection System
//! User protection from hacks, smart contract failures
//! Migration: TypeScript -> Rust (security-critical)

use std::collections::HashMap;
use std::sync::Mutex;

/// Insurance type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsuranceType {
    Hack,
    SmartContract,
    Stablecoin,
    Bridge,
    Custody,
}

/// Claim status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimStatus {
    Pending,
    Approved,
    Rejected,
    Paid,
}

/// Coverage level
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoverageLevel {
    Basic,
    Silver,
    Gold,
    Platinum,
}

/// Insurance policy
#[derive(Debug, Clone)]
pub struct Policy {
    pub id: String,
    pub user_id: String,
    pub insurance_type: InsuranceType,
    pub coverage_limit: f64,
    pub premium: f64,
    pub level: CoverageLevel,
}

/// Claim request
#[derive(Debug, Clone)]
pub struct Claim {
    pub id: String,
    pub policy_id: String,
    pub amount: f64,
    pub description: String,
    pub status: ClaimStatus,
    pub created_at: i64,
}

/// Insurance fund
#[derive(Debug)]
pub struct InsuranceFund {
    pub total_assets: f64,
    pub claims_paid: f64,
    pub coverage_limits: HashMap<CoverageLevel, f64>,
}

impl Default for InsuranceFund {
    fn default() -> Self {
        let mut limits = HashMap::new();
        limits.insert(CoverageLevel::Basic, 10_000.0);
        limits.insert(CoverageLevel::Silver, 50_000.0);
        limits.insert(CoverageLevel::Gold, 200_000.0);
        limits.insert(CoverageLevel::Platinum, 1_000_000.0);
        
        Self {
            total_assets: 100_000_000.0,
            claims_paid: 0.0,
            coverage_limits: limits,
        }
    }
}

/// Insurance system
pub struct InsuranceSystem {
    policies: Mutex<Vec<Policy>>,
    claims: Mutex<Vec<Claim>>,
    fund: Mutex<InsuranceFund>,
}

impl InsuranceSystem {
    pub fn new() -> Self {
        Self {
            policies: Mutex::new(Vec::new()),
            claims: Mutex::new(Vec::new()),
            fund: Mutex::new(InsuranceFund::default()),
        }
    }

    /// Create policy
    pub fn create_policy(&self, user_id: &str, ins_type: InsuranceType, level: CoverageLevel) -> Policy {
        let fund = self.fund.lock().unwrap();
        let coverage = *fund.coverage_limits.get(&level).unwrap_or(&100_000.0);
        let premium = coverage * 0.001; // 0.1%
        
        let policy = Policy {
            id: format!("policy_{}", self.policies.lock().unwrap().len()),
            user_id: user_id.to_string(),
            insurance_type: ins_type,
            coverage_limit: coverage,
            premium,
            level,
        };
        
        self.policies.lock().unwrap().push(policy.clone());
        
        policy
    }

    /// File claim
    pub fn file_claim(&self, policy_id: &str, amount: f64, description: &str) -> Claim {
        let claim = Claim {
            id: format!("claim_{}", self.claims.lock().unwrap().len()),
            policy_id: policy_id.to_string(),
            amount,
            description: description.to_string(),
            status: ClaimStatus::Pending,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        };
        
        self.claims.lock().unwrap().push(claim.clone());
        
        claim
    }

    /// Approve claim
    pub fn approve_claim(&self, claim_id: &str) -> bool {
        let mut claims = self.claims.lock().unwrap();
        
        for claim in claims.iter_mut() {
            if claim.id == claim_id && claim.status == ClaimStatus::Pending {
                claim.status = ClaimStatus::Approved;
                
                // Pay from fund
                drop(claims);
                let mut fund = self.fund.lock().unwrap();
                fund.claims_paid += claim.amount;
                
                return true;
            }
        }
        
        false
    }

    /// Get fund balance
    pub fn get_fund_balance(&self) -> f64 {
        let fund = self.fund.lock().unwrap();
        fund.total_assets - fund.claims_paid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy() {
        let ins = InsuranceSystem::new();
        
        let policy = ins.create_policy("user1", InsuranceType::Hack, CoverageLevel::Gold);
        
        assert_eq!(policy.level, CoverageLevel::Gold);
    }

    #[test]
    fn test_claim() {
        let ins = InsuranceSystem::new();
        
        let policy = ins.create_policy("user1", InsuranceType::Hack, CoverageLevel::Silver);
        let claim = ins.file_claim(&policy.id, 1000.0, "Hack incident");
        
        assert_eq!(claim.status, ClaimStatus::Pending);
    }
}