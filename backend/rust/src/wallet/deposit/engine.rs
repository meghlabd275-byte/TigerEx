// Deposit Engine - Critical Money Path in Rust
// Handles all deposit requests

use std::collections::HashMap;
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
        // Validate asset
        if !self.min_deposits.contains_key(asset) {
            return Err(format!("unsupported asset: {}", asset));
        }
        
        // Validate amount
        let min = self.min_deposits.get(asset).unwrap();
        if amount < *min {
            return Err(format!("minimum deposit is {} {}", min, asset));
        }
        
        // Check blocked
        if self.is_blocked(from_address) || self.is_blocked(to_address) {
            return Err("address blocked".to_string());
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
        self.pending.write().unwrap().insert(id, deposit);
        
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
        
        if deposit.status == DepositStatus::Pending && deposit.confirmations >= deposit.required_confirmations {
            deposit.status = DepositStatus::Completed;
            deposit.completed_at = Some(timestamp_ms());
            
            let completed = pending.remove(deposit_id).unwrap();
            self.completed.write().unwrap()
                .insert(deposit_id.to_string(), completed.clone());
            
            return Ok(completed);
        }
        
        Err("deposit not ready for completion".to_string())
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

use std::collections::HashSet;

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    format!("{}_{}", prefix, timestamp_ms())
}