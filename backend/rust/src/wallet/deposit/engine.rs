// Deposit Engine - Critical Money Path in Rust
// Handles all deposit requests

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Deposit status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepositStatus {
    Pending,
    Confirmed,
    Completed,
    Failed,
    Flagged,
}

/// Deposit request
#[derive(Debug, Clone)]
pub struct Deposit {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub from_address: String,
    pub to_address: String,
    pub network: String,
    pub tx_hash: String,
    pub confirmations: u32,
    pub required_confirmations: u32,
    pub status: DepositStatus,
    pub created_at: u64,
    pub confirmed_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub flag_reason: Option<String>,
}

/// Deposit Engine
pub struct DepositEngine {
    // Pending deposits
    pending: RwLock<HashMap<String, Deposit>>,

    // Completed deposits
    completed: RwLock<HashMap<String, Deposit>>,

    // Flagged deposits (for review)
    flagged: RwLock<Vec<Deposit>>,

    // Required confirmations by asset
    confirmations_required: HashMap<String, u32>,

    // Minimum deposits by asset
    min_deposits: HashMap<String, f64>,

    // Blocked addresses
    blocked: RwLock<HashSet<String>>,

    // tx_hash index, so a replayed transaction cannot be credited twice
    seen_tx: RwLock<HashSet<String>>,
}

impl DepositEngine {
    pub fn new() -> Self {
        let mut confirmations = HashMap::new();
        confirmations.insert("BTC".to_string(), 1);   // 1 for large
        confirmations.insert("ETH".to_string(), 12);
        confirmations.insert("USDT".to_string(), 18);
        confirmations.insert("BNB".to_string(), 1);

        let mut min_deposits = HashMap::new();
        min_deposits.insert("BTC".to_string(), 0.0001);
        min_deposits.insert("ETH".to_string(), 0.001);
        min_deposits.insert("USDT".to_string(), 1.0);

        DepositEngine {
            pending: RwLock::new(HashMap::new()),
            completed: RwLock::new(HashMap::new()),
            flagged: RwLock::new(Vec::new()),
            confirmations_required: confirmations,
            min_deposits,
            blocked: RwLock::new(HashSet::new()),
            seen_tx: RwLock::new(HashSet::new()),
        }
    }

    /// Register new deposit
    pub fn register_deposit(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        from_address: &str,
        to_address: &str,
        network: &str,
        tx_hash: &str,
    ) -> Result<Deposit, String> {
        if user_id.trim().is_empty() {
            return Err("user id is required".to_string());
        }
        if tx_hash.trim().is_empty() {
            return Err("transaction hash is required".to_string());
        }

        // Validate asset
        if !self.min_deposits.contains_key(asset) {
            return Err(format!("unsupported asset: {}", asset));
        }

        // Validate amount. A non-finite amount must be refused explicitly:
        // `NaN < min` is false, so a NaN would otherwise slip through.
        let min = self.min_deposits.get(asset).unwrap();
        if !amount.is_finite() || amount < *min {
            return Err(format!("minimum deposit is {} {}", min, asset));
        }

        // Check blocked
        if self.is_blocked(from_address) || self.is_blocked(to_address) {
            return Err("address blocked".to_string());
        }

        // A given on-chain transaction is credited at most once.
        if !self.seen_tx.write().unwrap().insert(tx_hash.to_string()) {
            return Err("transaction already registered".to_string());
        }

        // Get confirmations required
        let required = self.confirmations_required.get(asset).copied().unwrap_or(6);

        let deposit = Deposit {
            id: generate_id("dep"),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            from_address: from_address.to_string(),
            to_address: to_address.to_string(),
            network: network.to_string(),
            tx_hash: tx_hash.to_string(),
            confirmations: 0,
            required_confirmations: required,
            status: DepositStatus::Pending,
            created_at: timestamp_ms(),
            confirmed_at: None,
            completed_at: None,
            flag_reason: None,
        };

        let id = deposit.id.clone();
        self.pending.write().unwrap().insert(id, deposit.clone());

        Ok(deposit)
    }

    /// Update confirmation count
    pub fn update_confirmations(&self, tx_hash: &str, confirmations: u32) -> Result<Deposit, String> {
        let mut pending = self.pending.write().unwrap();

        // Find by tx_hash
        let deposit = pending.iter_mut()
            .find(|(_, d)| d.tx_hash == tx_hash)
            .map(|(_, d)| d)
            .ok_or("deposit not found")?;

        deposit.confirmations = confirmations;

        // Check if confirmed
        if confirmations >= deposit.required_confirmations {
            deposit.status = DepositStatus::Confirmed;
            deposit.confirmed_at = Some(timestamp_ms());
        }

        Ok(deposit.clone())
    }

    /// Complete deposit (credit user)
    pub fn complete_deposit(&self, deposit_id: &str) -> Result<Deposit, String> {
        let mut pending = self.pending.write().unwrap();

        let deposit = pending.get_mut(deposit_id)
            .ok_or("deposit not found")?;

        // A deposit becomes `Confirmed` once it has enough confirmations, so
        // both Pending and Confirmed are completable; a flagged, failed or
        // already-completed deposit is not.
        match deposit.status {
            DepositStatus::Pending | DepositStatus::Confirmed => {}
            _ => return Err("deposit is not completable in its current state".to_string()),
        }

        if deposit.confirmations < deposit.required_confirmations {
            return Err("deposit not ready for completion".to_string());
        }

        deposit.status = DepositStatus::Completed;
        deposit.completed_at = Some(timestamp_ms());

        let completed = pending.remove(deposit_id).unwrap();
        self.completed.write().unwrap()
            .insert(deposit_id.to_string(), completed.clone());

        Ok(completed)
    }

    /// Flag deposit for review
    pub fn flag_deposit(&self, deposit_id: &str, reason: &str) -> Result<(), String> {
        let mut pending = self.pending.write().unwrap();

        if let Some(deposit) = pending.get_mut(deposit_id) {
            deposit.status = DepositStatus::Flagged;
            deposit.flag_reason = Some(reason.to_string());

            let flagged = pending.remove(deposit_id).unwrap();
            self.flagged.write().unwrap().push(flagged);

            return Ok(());
        }

        Err("deposit not found".to_string())
    }

    /// Get deposit
    pub fn get_deposit(&self, id: &str) -> Option<Deposit> {
        if let Some(d) = self.pending.read().unwrap().get(id) {
            return Some(d.clone());
        }
        if let Some(d) = self.completed.read().unwrap().get(id) {
            return Some(d.clone());
        }
        None
    }

    fn is_blocked(&self, address: &str) -> bool {
        self.blocked.read().unwrap().contains(address)
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("{}_{}", prefix, hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> DepositEngine {
        DepositEngine::new()
    }

    #[test]
    fn a_deposit_needs_the_required_confirmations_before_it_completes() {
        let e = engine();
        let d = e
            .register_deposit("u1", "BTC", 1.0, "from", "to", "bitcoin", "tx1")
            .unwrap();
        assert!(e.complete_deposit(&d.id).is_err());
        e.update_confirmations("tx1", 1).unwrap();
        let done = e.complete_deposit(&d.id).unwrap();
        assert_eq!(done.status, DepositStatus::Completed);
    }

    #[test]
    fn a_transaction_hash_cannot_be_credited_twice() {
        let e = engine();
        e.register_deposit("u1", "BTC", 1.0, "from", "to", "bitcoin", "txdup").unwrap();
        // Replaying the same on-chain transaction must be refused.
        assert!(e.register_deposit("u1", "BTC", 1.0, "from", "to", "bitcoin", "txdup").is_err());
    }

    #[test]
    fn non_finite_or_below_minimum_deposits_are_refused() {
        let e = engine();
        assert!(e.register_deposit("u1", "BTC", f64::NAN, "f", "t", "bitcoin", "a").is_err());
        assert!(e.register_deposit("u1", "BTC", -1.0, "f", "t", "bitcoin", "b").is_err());
        assert!(e.register_deposit("u1", "BTC", 0.0, "f", "t", "bitcoin", "c").is_err());
        assert!(e.register_deposit("", "BTC", 1.0, "f", "t", "bitcoin", "d").is_err());
    }

    #[test]
    fn deposit_ids_are_unique() {
        let e = engine();
        let a = e.register_deposit("u1", "BTC", 1.0, "f", "t", "bitcoin", "ta").unwrap();
        let b = e.register_deposit("u1", "BTC", 1.0, "f", "t", "bitcoin", "tb").unwrap();
        assert_ne!(a.id, b.id);
    }
}