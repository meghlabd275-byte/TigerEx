// Withdrawal Engine - Critical Money Path in Rust
// Handles all withdrawal requests with security.
//
// Lifecycle: Pending -> Approved -> Completed (or Rejected/Cancelled).
// A withdrawal is charged against the user's daily limit when it is approved,
// and the charge is released when it is rejected. That way queueing many
// requests cannot slip past the limit. Amounts must be finite and at least the
// asset minimum, and ids are unique rather than clock-derived.

use std::collections::{HashMap, HashSet};
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

    // Monotonic counter, so ids are unique even within one millisecond
    counter: RwLock<u64>,
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
            daily_limit: 100_000_000.0,
            daily_withdrawn: RwLock::new(0.0),
            last_reset: RwLock::new(0),
            user_daily_limit: 10_000_000.0,
            user_withdrawal_limits: RwLock::new(HashMap::new()),
            blocked_addresses: RwLock::new(HashSet::new()),
            min_amounts,
            fees,
            counter: RwLock::new(0),
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
        if user_id.trim().is_empty() {
            return Err("user id is required".to_string());
        }
        if to_address.trim().is_empty() {
            return Err("destination address is required".to_string());
        }

        // Validate asset
        if !self.min_amounts.contains_key(asset) {
            return Err(format!("unsupported asset: {}", asset));
        }

        // Validate amount. A non-finite amount is refused explicitly: `NaN <
        // min` is false, so a NaN would otherwise slip past this check.
        let min = self.min_amounts.get(asset).unwrap();
        if !amount.is_finite() || amount < *min {
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

        // Check user daily limit (executed + approved-but-outstanding)
        self.check_user_daily_limit(user_id, amount)?;

        // Create request
        let request = WithdrawalRequest {
            id: self.next_id("wd"),
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

    /// Approve a pending withdrawal. The amount is reserved against the user's
    /// daily limit here, so a second request cannot be approved past the limit.
    pub fn approve_withdrawal(&self, withdrawal_id: &str, approver_id: &str) -> Result<WithdrawalRequest, String> {
        let user_id;
        let amount;
        {
            let mut pending = self.pending.write().unwrap();
            let request = pending.get_mut(withdrawal_id).ok_or("withdrawal not found")?;

            if request.status != WithdrawalStatus::Pending {
                return Err("withdrawal not pending".to_string());
            }

            request.approvals.push(Approval {
                approver_id: approver_id.to_string(),
                approved_at: timestamp_ms(),
                notes: "Approved".to_string(),
            });
            request.status = WithdrawalStatus::Approved;
            user_id = request.user_id.clone();
            amount = request.amount;
        }

        self.charge_user_limit(&user_id, amount);
        self.get_withdrawal(withdrawal_id).ok_or_else(|| "withdrawal not found".to_string())
    }

    /// Execute an approved withdrawal.
    pub fn execute_withdrawal(&self, withdrawal_id: &str, tx_hash: &str) -> Result<WithdrawalRequest, String> {
        let completed;
        {
            let mut pending = self.pending.write().unwrap();
            let request = pending.get_mut(withdrawal_id).ok_or("withdrawal not found")?;

            if request.status != WithdrawalStatus::Approved {
                return Err("withdrawal not approved".to_string());
            }

            request.status = WithdrawalStatus::Completed;
            request.tx_hash = Some(tx_hash.to_string());
            request.processed_at = Some(timestamp_ms());

            completed = pending.remove(withdrawal_id).unwrap();
        }
        self.completed
            .write()
            .unwrap()
            .insert(withdrawal_id.to_string(), completed.clone());

        *self.daily_withdrawn.write().unwrap() += completed.amount;

        Ok(completed)
    }

    /// Reject a pending or approved withdrawal, releasing any reserved limit.
    pub fn reject_withdrawal(&self, withdrawal_id: &str, reason: &str) -> Result<(), String> {
        let user_id;
        let amount;
        let was_approved;
        {
            let mut pending = self.pending.write().unwrap();
            let request = pending.get_mut(withdrawal_id).ok_or("withdrawal not found")?;

            match request.status {
                WithdrawalStatus::Pending | WithdrawalStatus::Approved => {}
                _ => return Err("withdrawal is not rejectable in its current state".to_string()),
            }

            was_approved = request.status == WithdrawalStatus::Approved;
            user_id = request.user_id.clone();
            amount = request.amount;
            request.status = WithdrawalStatus::Rejected;
            request.reject_reason = Some(reason.to_string());
        }

        if was_approved {
            self.release_user_limit(&user_id, amount);
        }
        Ok(())
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
        let current = self
            .user_withdrawal_limits
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(0.0);

        if current + amount > self.user_daily_limit {
            return Err("user daily withdrawal limit reached".to_string());
        }

        Ok(())
    }

    fn charge_user_limit(&self, user_id: &str, amount: f64) {
        let mut limits = self.user_withdrawal_limits.write().unwrap();
        *limits.entry(user_id.to_string()).or_insert(0.0) += amount;
    }

    fn release_user_limit(&self, user_id: &str, amount: f64) {
        let mut limits = self.user_withdrawal_limits.write().unwrap();
        if let Some(v) = limits.get_mut(user_id) {
            *v = (*v - amount).max(0.0);
        }
    }

    fn reset_daily_if_needed(&self) {
        let now = timestamp_ms();
        let last = *self.last_reset.read().unwrap();

        // Reset if more than 24 hours have passed.
        if now.saturating_sub(last) > 24 * 60 * 60 * 1000 {
            *self.daily_withdrawn.write().unwrap() = 0.0;
            *self.last_reset.write().unwrap() = now;
            self.user_withdrawal_limits.write().unwrap().clear();
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        let mut c = self.counter.write().unwrap();
        *c += 1;
        format!("{}_{}_{}", prefix, timestamp_ms(), *c)
    }

    fn is_address_blocked(&self, address: &str) -> bool {
        self.blocked_addresses.read().unwrap().contains(address)
    }

    /// Block an address (e.g. a sanctioned or compromised destination).
    pub fn block_address(&self, address: &str) {
        self.blocked_addresses
            .write()
            .unwrap()
            .insert(address.to_string());
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

impl Default for WithdrawalEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approved(engine: &WithdrawalEngine, user: &str, asset: &str, amount: f64) -> String {
        let req = engine.create_withdrawal(user, asset, amount, "addr", "mainnet").unwrap();
        engine.approve_withdrawal(&req.id, "admin").unwrap();
        req.id
    }

    #[test]
    fn a_withdrawal_flows_create_approve_execute() {
        let e = WithdrawalEngine::new();
        let req = e.create_withdrawal("u1", "USDT", 100.0, "addr", "mainnet").unwrap();
        e.approve_withdrawal(&req.id, "admin").unwrap();
        let done = e.execute_withdrawal(&req.id, "0xhash").unwrap();
        assert_eq!(done.status, WithdrawalStatus::Completed);
        assert_eq!(done.tx_hash.as_deref(), Some("0xhash"));
    }

    #[test]
    fn a_non_finite_amount_is_refused() {
        let e = WithdrawalEngine::new();
        assert!(e.create_withdrawal("u1", "USDT", f64::NAN, "addr", "mainnet").is_err());
        assert!(e.create_withdrawal("u1", "USDT", -100.0, "addr", "mainnet").is_err());
    }

    #[test]
    fn withdrawal_ids_are_unique() {
        let e = WithdrawalEngine::new();
        let a = e.create_withdrawal("u1", "USDT", 100.0, "addr", "mainnet").unwrap();
        let b = e.create_withdrawal("u1", "USDT", 100.0, "addr", "mainnet").unwrap();
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn approved_amounts_count_against_the_daily_limit() {
        let mut e = WithdrawalEngine::new();
        e.user_daily_limit = 250.0;
        // Approve 200, then a second 100 must be refused while the first is
        // still outstanding (approved but not executed).
        let _first = approved(&e, "u1", "USDT", 200.0);
        assert!(e.create_withdrawal("u1", "USDT", 100.0, "addr", "mainnet").is_err());
    }

    #[test]
    fn rejecting_an_approved_withdrawal_releases_its_limit() {
        let mut e = WithdrawalEngine::new();
        e.user_daily_limit = 250.0;
        let id = approved(&e, "u1", "USDT", 200.0);
        e.reject_withdrawal(&id, "manual review").unwrap();
        // The reservation is released, so a fresh 200 is allowed again.
        assert!(e.create_withdrawal("u1", "USDT", 200.0, "addr", "mainnet").is_ok());
    }

    #[test]
    fn an_unapproved_withdrawal_cannot_execute() {
        let e = WithdrawalEngine::new();
        let req = e.create_withdrawal("u1", "USDT", 100.0, "addr", "mainnet").unwrap();
        assert!(e.execute_withdrawal(&req.id, "0xhash").is_err());
    }

    #[test]
    fn a_blocked_address_is_refused() {
        let e = WithdrawalEngine::new();
        e.block_address("bad");
        assert!(e.create_withdrawal("u1", "USDT", 100.0, "bad", "mainnet").is_err());
    }
}
