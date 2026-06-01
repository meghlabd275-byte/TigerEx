// Settlement Engine - Critical Money Path in Rust
// Handles trade settlement, reconciliation, and fund transfers

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Settlement status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Reversed,
}

/// Transaction type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionType {
    Trade,
    Deposit,
    Withdrawal,
    Transfer,
    Fee,
    Adjustment,
    Reward,
}

/// Settlement entry
#[derive(Debug, Clone)]
pub struct SettlementEntry {
    pub id: String,
    pub account_id: String,
    pub transaction_type: TransactionType,
    pub asset: String,
    pub amount: f64,
    pub fee: f64,
    pub balance_before: f64,
    pub balance_after: f64,
    pub reference_id: String,
    pub status: SettlementStatus,
    pub created_at: u64,
    pub settled_at: Option<u64>,
    pub metadata: HashMap<String, String>,
}

impl SettlementEntry {
    pub fn new(
        account_id: &str,
        tx_type: TransactionType,
        asset: &str,
        amount: f64,
        fee: f64,
        balance_before: f64,
        reference_id: &str,
    ) -> Self {
        SettlementEntry {
            id: generate_id("stl"),
            account_id: account_id.to_string(),
            transaction_type: tx_type,
            asset: asset.to_string(),
            amount,
            fee,
            balance_before,
            balance_after: balance_before + amount - fee,
            reference_id: reference_id.to_string(),
            status: SettlementStatus::Pending,
            created_at: timestamp_ms(),
            settled_at: None,
            metadata: HashMap::new(),
        }
    }
    
    pub fn complete(&mut self) {
        self.status = SettlementStatus::Completed;
        self.settled_at = Some(timestamp_ms());
    }
    
    pub fn fail(&mut self) {
        self.status = SettlementStatus::Failed;
        self.settled_at = Some(timestamp_ms());
    }
}

/// Trade settlement (T+0 or T+1)
#[derive(Debug, Clone)]
pub struct TradeSettlement {
    pub trade_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub buyer_fee: f64,
    pub seller_fee: f64,
    pub buyer_commission: f64,
    pub seller_commission: f64,
    pub settlement_type: SettlementType,
    pub status: SettlementStatus,
}

#[derive(Debug, Clone, Copy)]
pub enum SettlementType {
    T0, // Immediate
    T1, // End of day
}

/// Settlement Engine
pub struct SettlementEngine {
    // Pending settlements
    pending: RwLock<HashMap<String, SettlementEntry>>,
    
    // Completed settlements
    completed: RwLock<HashMap<String, SettlementEntry>>,
    
    // Failed settlements
    failed: RwLock<Vec<SettlementEntry>>,
    
    // Trade settlements
    trades: RwLock<HashMap<String, TradeSettlement>>,
    
    // Settings
    settlement_type: SettlementType,
    max_settlement_amount: f64,
    min_settlement_amount: f64,
}

impl SettlementEngine {
    pub fn new() -> Self {
        SettlementEngine {
            pending: RwLock::new(HashMap::new()),
            completed: RwLock::new(HashMap::new()),
            failed: RwLock::new(Vec::new()),
            trades: RwLock::new(HashMap::new()),
            settlement_type: SettlementType::T0,
            max_settlement_amount: 1_000_000_000.0, // 1B
            min_settlement_amount: 0.01,
        }
    }
    
    /// Create settlement entry
    pub fn create_settlement(
        &self,
        account_id: &str,
        tx_type: TransactionType,
        asset: &str,
        amount: f64,
        fee: f64,
        balance_before: f64,
        reference_id: &str,
    ) -> Result<SettlementEntry, String> {
        // Validate
        if amount < self.min_settlement_amount {
            return Err(format!("amount below minimum {}", self.min_settlement_amount));
        }
        if amount > self.max_settlement_amount {
            return Err(format!("amount exceeds maximum {}", self.max_settlement_amount));
        }
        
        let entry = SettlementEntry::new(
            account_id, tx_type, asset, amount, fee, balance_before, reference_id
        );
        
        let id = entry.id.clone();
        
        // Store
        self.pending.write().unwrap().insert(id, entry.clone());
        
        Ok(entry)
    }
    
    /// Process settlement
    pub fn process_settlement(&self, settlement_id: &str) -> Result<SettlementEntry, String> {
        let mut pending = self.pending.write().unwrap();
        
        let entry = pending.get_mut(settlement_id)
            .ok_or("settlement not found")?;
        
        // Mark as processing
        entry.status = SettlementStatus::Processing;
        
        // Simulate processing...
        entry.complete();
        
        let completed = entry.clone();
        
        // Move to completed
        pending.remove(settlement_id);
        self.completed.write().unwrap()
            .insert(settlement_id.to_string(), completed.clone());
        
        Ok(completed)
    }
    
    /// Fail settlement
    pub fn fail_settlement(&self, settlement_id: &str, reason: &str) -> Result<(), String> {
        let mut pending = self.pending.write().unwrap();
        
        if let Some(entry) = pending.get_mut(settlement_id) {
            entry.status = SettlementStatus::Failed;
            entry.metadata.insert("reason".to_string(), reason.to_string());
            
            let failed = entry.clone();
            self.failed.write().unwrap().push(failed);
            pending.remove(settlement_id);
            
            return Ok(());
        }
        
        Err("settlement not found".to_string())
    }
    
    /// Settle trade
    pub fn settle_trade(&self, trade: TradeSettlement) -> Result<(SettlementEntry, SettlementEntry), String> {
        let trade_id = trade.trade_id.clone();
        
        // Buyer receives asset, pays in quote
        let buyer_settlement = SettlementEntry::new(
            &trade.buyer_id,
            TransactionType::Trade,
            &trade.symbol,
            trade.quantity,
            trade.buyer_fee,
            0.0, // balance_before would come from ledger
            &trade_id,
        );
        
        // Seller receives quote, pays asset
        let seller_settlement = SettlementEntry::new(
            &trade.seller_id,
            TransactionType::Trade,
            &trade.symbol[..4], // base asset
            -(trade.quantity as f64),
            trade.seller_fee,
            0.0,
            &trade_id,
        );
        
        // Store trade
        self.trades.write().unwrap()
            .insert(trade_id.clone(), trade);
        
        Ok((buyer_settlement, seller_settlement))
    }
    
    /// Get settlement
    pub fn get_settlement(&self, settlement_id: &str) -> Option<SettlementEntry> {
        if let Some(e) = self.pending.read().unwrap().get(settlement_id) {
            return Some(e.clone());
        }
        if let Some(e) = self.completed.read().unwrap().get(settlement_id) {
            return Some(e.clone());
        }
        None
    }
    
    /// Reconcile account
    pub fn reconcile(&self, account_id: &str) -> ReconciliationResult {
        let pending = self.pending.read().unwrap();
        let completed = self.completed.read().unwrap();
        
        let pending_count = pending.values()
            .filter(|e| e.account_id == account_id)
            .count();
        
        let completed_count = completed.values()
            .filter(|e| e.account_id == account_id)
            .count();
        
        ReconciliationResult {
            account_id: account_id.to_string(),
            pending_settlements: pending_count,
            completed_settlements: completed_count,
            status: if pending_count == 0 { ReconciliationStatus::Balanced } else { ReconciliationStatus::Unbalanced },
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReconciliationResult {
    pub account_id: String,
    pub pending_settlements: usize,
    pub completed_settlements: usize,
    pub status: ReconciliationStatus,
}

#[derive(Debug, Clone, Copy)]
pub enum ReconciliationStatus {
    Balanced,
    Unbalanced,
    Error,
}

fn timestamp_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn generate_id(prefix: &str) -> String {
    format!("{}_{}", prefix, timestamp_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_settlement() {
        let engine = SettlementEngine::new();
        
        let result = engine.create_settlement(
            "acc1",
            TransactionType::Deposit,
            "USDT",
            1000.0,
            0.0,
            5000.0,
            "ref1",
        );
        
        assert!(result.is_ok());
    }
}