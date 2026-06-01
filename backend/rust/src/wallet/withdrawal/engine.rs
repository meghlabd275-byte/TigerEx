// Withdrawal Engine - Critical Money Path in Rust
// Handles all withdrawal requests with security

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Withdrawal status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WithdrawalStatus {
    Pending,
    Processing,
    Approved,
    Rejected,
    Completed,
    Failed,
    Cancelled,
}

/// Withdrawal request
#[derive(Debug, Clone)]
pub struct WithdrawalRequest {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub net_amount: f64,
    pub to_address: String,
    pub network: String,
    pub status: WithdrawalStatus,
    pub created_at: u64,
    pub processed_at: Option<u64>,
    pub tx_hash: Option<String>,
    pub reject_reason: Option<String>,
    pub approvals: Vec<Approval>,
    pub security_checks: SecurityCheckResult,
}

#[derive(Debug, Clone)]
pub struct Approval {
    pub approver_id: String,
    pub approved_at: u64,
    pub notes: String,
}

/// Security check result
#[derive(Debug, Clone)]
pub struct SecurityCheckResult {
    pub passed: bool,
    pub checks: Vec<SecurityCheck>,
}

#[derive(Debug, Clone)]
pub struct SecurityCheck {
    pub name: String,
    pub passed: bool,
    pub reason: Option<String>,
}

/// Withdrawal Engine
pub struct WithdrawalEngine {
    // Pending withdrawals
    pending: RwLock<HashMap<String, WithdrawalRequest>>,
    
    // Completed withdrawals
    completed: RwLock<HashMap<String, WithdrawalRequest>>,
    
    // Daily limits
    daily_limit: f64,
    daily_withdrawn: RwLock<f64>,
    last_reset: RwLock<u64>,
    
    // Per-user limits
    user_daily_limit: f64,
    user_withdrawal_limits: RwLock<HashMap<String, f64>>,
    
    // Blocked addresses
    blocked_addresses: RwLock<HashSet<String>>,
    
    // Minimum amounts by asset
    min_amounts: HashMap<String, f64>,
    // Fees by asset
    fees: HashMap<String, f64>,
}

impl WithdrawalEngine {
    pub fn new() -> Self {
        let mut fees = HashMap::new();
        fees.insert("BTC".to_string(), 0.0005);
        fees.insert("ETH".to_string(), 0.005);
        fees.insert("USDT".to_string(), 1.0);
        fees.insert("BNB".to_string(), 0.001);
        
        let mut min_amounts = HashMap::new();
        min_amounts.insert("BTC".to_string(), 0.001);
        min_amounts.insert("ETH".to_string(), 0.01);
        min_amounts.insert("USDT".to_string(), 10.0);
        
        WithdrawalEngine {
            pending: RwLock::new(HashMap::new()),
            completed: RwLock::new(HashMap::new()),
            daily_limit: 100_000_000.0, // 100M
            daily_withdrawn: RwLock::new(0.0),
            last_reset: RwLock::new(0),
            user_daily_limit: 10_000_000.0, // 10M
            user_withdrawal_limits: RwLock::new(HashMap::new()),
            blocked_addresses: RwLock::new(HashSet::new()),
            min_amounts,
            fees,
        }
    }
    
    /// Create withdrawal request
    pub fn create_withdrawal(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        to_address: &str,
        network: &str,
    ) -> Result<WithdrawalRequest, String> {
        // Validate asset
        if !self.min_amounts.contains_key(asset) {
            return Err(format!("unsupported asset: {}", asset));
        }
        
        // Validate amount
        let min = self.min_amounts.get(asset).unwrap();
        if amount < *min {
            return Err(format!("minimum withdrawal is {} {}", min, asset));
        }
        
        // Check fee
        let fee = self.fees.get(asset).copied().unwrap_or(0.0);
        let net_amount = amount - fee;
        
        if net_amount <= 0.0 {
            return Err("amount too small to cover fee".to_string());
        }
        
        // Check blocked address
        if self.is_address_blocked(to_address) {
            return Err("address blocked".to_string());
        }
        
        // Check daily limit
        self.check_daily_limit(amount)?;
        
        // Check user daily limit
        self.check_user_daily_limit(user_id, amount)?;
        
        // Create request
        let request = WithdrawalRequest {
            id: generate_id("wd"),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            fee,
            net_amount,
            to_address: to_address.to_string(),
            network: network.to_string(),
            status: WithdrawalStatus::Pending,
            created_at: timestamp_ms(),
            processed_at: None,
            tx_hash: None,
            reject_reason: None,
            approvals: Vec::new(),
            security_checks: SecurityCheckResult {
                passed: true,
                checks: Vec::new(),
            },
        };
        
        // Store
        let id = request.id.clone();
        self.pending.write().unwrap().insert(id, request.clone());
        
        Ok(request)
    }
    
    /// Process withdrawal (approve)
    pub fn approve_withdrawal(&self, withdrawal_id: &str, approver_id: &str) -> Result<WithdrawalRequest, String> {
        let mut pending = self.pending.write().unwrap();
        
        let request = pending.get_mut(withdrawal_id)
            .ok_or("withdrawal not found")?;
        
        if request.status != WithdrawalStatus::Pending {
            return Err("withdrawal not pending".to_string());
        }
        
        // Add approval
        request.approvals.push(Approval {
            approver_id: approver_id.to_string(),
            approved_at: timestamp_ms(),
            notes: "Approved".to_string(),
        });
        
        request.status = WithdrawalStatus::Approved;
        
        Ok(request.clone())
    }
    
    /// Execute withdrawal
    pub fn execute_withdrawal(&self, withdrawal_id: &str, tx_hash: &str) -> Result<WithdrawalRequest, String> {
        let mut pending = self.pending.write().unwrap();
        
        let request = pending.get_mut(withdrawal_id)
            .ok_or("withdrawal not found")?;
        
        if request.status != WithdrawalStatus::Approved {
            return Err("withdrawal not approved".to_string());
        }
        
        // Execute
        request.status = WithdrawalStatus::Completed;
        request.tx_hash = Some(tx_hash.to_string());
        request.processed_at = Some(timestamp_ms());
        
        let completed = pending.remove(withdrawal_id).unwrap();
        self.completed.write().unwrap()
            .insert(withdrawal_id.to_string(), completed.clone());
        
        // Update daily total
        *self.daily_withdrawn.write().unwrap() += completed.amount;
        
        Ok(completed)
    }
    
    /// Reject withdrawal
    pub fn reject_withdrawal(&self, withdrawal_id: &str, reason: &str) -> Result<(), String> {
        let mut pending = self.pending.write().unwrap();
        
        if let Some(request) = pending.get_mut(withdrawal_id) {
            request.status = WithdrawalStatus::Rejected;
            request.reject_reason = Some(reason.to_string());
            return Ok(());
        }
        
        Err("withdrawal not found".to_string())
    }
    
    fn check_daily_limit(&self, amount: f64) -> Result<(), String> {
        self.reset_daily_if_needed();
        
        let daily = self.daily_withdrawn.read().unwrap();
        if *daily + amount > self.daily_limit {
            return Err("daily withdrawal limit reached".to_string());
        }
        Ok(())
    }
    
    fn check_user_daily_limit(&self, user_id: &str, amount: f64) -> Result<(), String> {
        let mut user_limits = self.user_withdrawal_limits.write().unwrap();
        
        let current = user_limits.get(user_id).copied().unwrap_or(0.0);
        
        if current + amount > self.user_daily_limit {
            return Err("user daily withdrawal limit reached".to_string());
        }
        
        user_limits.insert(user_id.to_string(), current + amount);
        
        Ok(())
    }
    
    fn reset_daily_if_needed(&self) {
        let now = timestamp_ms();
        let last = *self.last_reset.read().unwrap();
        
        // Reset if more than 24 hours
        if now - last > 24 * 60 * 60 * 1000 {
            *self.daily_withdrawn.write().unwrap() = 0.0;
            *self.last_reset.write().unwrap() = now;
            self.user_withdrawal_limits.write().unwrap().clear();
        }
    }
    
    fn is_address_blocked(&self, address: &str) -> bool {
        self.blocked_addresses.read().unwrap().contains(address)
    }
    
    /// Get withdrawal
    pub fn get_withdrawal(&self, id: &str) -> Option<WithdrawalRequest> {
        if let Some(w) = self.pending.read().unwrap().get(id) {
            return Some(w.clone());
        }
        if let Some(w) = self.completed.read().unwrap().get(id) {
            return Some(w.clone());
        }
        None
    }
}

use std::collections::HashSet;

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    format!("{}_{}", prefix, timestamp_ms())
}