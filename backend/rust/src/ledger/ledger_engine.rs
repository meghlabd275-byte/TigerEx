// Ledger Engine - Critical Money Path in Rust
// Double-entry bookkeeping for all account transactions

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Account type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountType {
    Spot,
    Margin,
    Futures,
    Earn,
    Funding,
    Cold,
    Hot,
}

/// Ledger entry (double-entry)
#[derive(Debug, Clone)]
pub struct LedgerEntry {
    pub id: String,
    pub account_id: String,
    pub account_type: AccountType,
    pub asset: String,
    pub amount: f64,          // Positive = credit, Negative = debit
    pub balance_before: f64,
    pub balance_after: f64,
    pub entry_type: EntryType,
    pub reference_id: String,
    pub description: String,
    pub timestamp: u64,
    pub journal_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryType {
    Deposit,
    Withdrawal,
    Trade,
    Fee,
    Transfer,
    Reward,
    Penalty,
    Adjustment,
    Interest,
    Dividend,
}

/// Journal entry (groups multiple ledger entries for atomicity)
#[derive(Debug, Clone)]
pub struct JournalEntry {
    pub id: String,
    pub entries: Vec<LedgerEntry>,
    pub status: JournalStatus,
    pub created_at: u64,
    pub settled_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JournalStatus {
    Pending,
    Posted,
    Failed,
    Reversed,
}

/// Account balance
#[derive(Debug, Clone)]
pub struct AccountBalance {
    pub account_id: String,
    pub account_type: AccountType,
    pub asset: String,
    pub available: f64,
    pub locked: f64,
    pub total: f64,
    pub updated_at: u64,
}

impl AccountBalance {
    pub fn new(account_id: &str, account_type: AccountType, asset: &str) -> Self {
        AccountBalance {
            account_id: account_id.to_string(),
            account_type,
            asset: asset.to_string(),
            available: 0.0,
            locked: 0.0,
            total: 0.0,
            updated_at: timestamp_ms(),
        }
    }
    
    pub fn credit(&mut self, amount: f64) {
        self.available += amount;
        self.total += amount;
    }
    
    pub fn debit(&mut self, amount: f64) -> Result<(), String> {
        if self.available < amount {
            return Err("insufficient balance".to_string());
        }
        self.available -= amount;
        self.total -= amount;
        Ok(())
    }
    
    pub fn lock(&mut self, amount: f64) -> Result<(), String> {
        if self.available < amount {
            return Err("insufficient available balance".to_string());
        }
        self.available -= amount;
        self.locked += amount;
        Ok(())
    }
    
    pub fn unlock(&mut self, amount: f64) {
        self.locked = (self.locked - amount).max(0.0);
        self.available += amount;
    }
}

/// Ledger Engine - Double-entry bookkeeping
pub struct LedgerEngine {
    // Accounts: account_id + asset -> balance
    balances: RwLock<HashMap<String, AccountBalance>>,
    
    // Ledger entries
    entries: RwLock<Vec<LedgerEntry>>,
    
    // Journals for atomic operations
    journals: RwLock<HashMap<String, JournalEntry>>,
    
    // Account index
    account_assets: RwLock<HashMap<String, HashSet<String>>>,
}

impl LedgerEngine {
    pub fn new() -> Self {
        LedgerEngine {
            balances: RwLock::new(HashMap::new()),
            entries: RwLock::new(Vec::new()),
            journals: RwLock::new(HashMap::new()),
            account_assets: RwLock::new(HashMap::new()),
        }
    }
    
    /// Get or create balance
    fn get_balance(&self, account_id: &str, account_type: AccountType, asset: &str) -> AccountBalance {
        let key = balance_key(account_id, account_type, asset);
        
        if let Some(bal) = self.balances.read().unwrap().get(&key) {
            return bal.clone();
        }
        
        AccountBalance::new(account_id, account_type, asset)
    }
    
    /// Create journal entry (atomic double-entry)
    pub fn create_journal(&self, journal_id: &str, entries: Vec<JournalEntryRequest>) -> Result<JournalEntry, String> {
        let now = timestamp_ms();
        let mut ledger_entries = Vec::new();
        
        // Validate all entries first
        for req in &entries {
            let balance_before = self.get_balance(&req.account_id, req.account_type, &req.asset).available;
            
            let entry = LedgerEntry {
                id: generate_id("led"),
                account_id: req.account_id.clone(),
                account_type: req.account_type,
                asset: req.asset.clone(),
                amount: req.amount,
                balance_before,
                balance_after: balance_before + req.amount,
                entry_type: req.entry_type,
                reference_id: req.reference_id.clone(),
                description: req.description.clone(),
                timestamp: now,
                journal_id: journal_id.to_string(),
            };
            
            ledger_entries.push(entry);
        }
        
        // Validate total debits = total credits
        let total: f64 = ledger_entries.iter().map(|e| e.amount).sum();
        if total.abs() > 0.00000001 {
            return Err("journal entries must balance (debits = credits)".to_string());
        }
        
        // Apply all entries atomically
        for entry in &ledger_entries {
            self.apply_entry(entry)?;
        }
        
        // Store journal
        let journal = JournalEntry {
            id: journal_id.to_string(),
            entries: ledger_entries.clone(),
            status: JournalStatus::Posted,
            created_at: now,
            settled_at: Some(now),
        };
        
        self.journals.write().unwrap()
            .insert(journal_id.to_string(), journal.clone());
        
        Ok(journal)
    }
    
    /// Apply single entry
    fn apply_entry(&self, entry: &LedgerEntry) -> Result<(), String> {
        let key = balance_key(&entry.account_id, entry.account_type, &entry.asset);
        
        let mut balances = self.balances.write().unwrap();
        
        let balance = balances.entry(key.clone())
            .or_insert_with(|| AccountBalance::new(&entry.account_id, entry.account_type, &entry.asset));
        
        // Apply
        if entry.amount >= 0.0 {
            balance.credit(entry.amount);
        } else {
            balance.debit(-entry.amount)?;
        }
        
        // Index
        drop(balances);
        self.account_assets.write().unwrap()
            .entry(entry.account_id.clone())
            .or_insert_with(HashSet::new)
            .insert(entry.asset.clone());
        
        // Store entry
        self.entries.write().unwrap().push(entry.clone());
        
        Ok(())
    }
    
    /// Get balance
    pub fn get_balance(&self, account_id: &str, account_type: AccountType, asset: &str) -> Option<AccountBalance> {
        let key = balance_key(account_id, account_type, asset);
        self.balances.read().unwrap().get(&key).cloned()
    }
    
    /// Get all balances for account
    pub fn get_account_balances(&self, account_id: &str) -> Vec<AccountBalance> {
        let assets = self.account_assets.read().unwrap()
            .get(account_id)
            .cloned()
            .unwrap_or_default();
        
        let mut result = Vec::new();
        
        for asset in assets {
            for &at in &[AccountType::Spot, AccountType::Margin, AccountType::Earn, AccountType::Funding] {
                if let Some(bal) = self.get_balance(account_id, at, &asset) {
                    result.push(bal);
                }
            }
        }
        
        result
    }
    
    /// Lock funds for trading
    pub fn lock_funds(&self, account_id: &str, account_type: AccountType, asset: &str, amount: f64) -> Result<(), String> {
        let key = balance_key(account_id, account_type, asset);
        let mut balances = self.balances.write().unwrap();
        
        let balance = balances.entry(key.clone())
            .or_insert_with(|| AccountBalance::new(account_id, account_type, asset));
        
        balance.lock(amount)
    }
    
    /// Unlock funds
    pub fn unlock_funds(&self, account_id: &str, account_type: AccountType, asset: &str, amount: f64) {
        let key = balance_key(account_id, account_type, asset);
        let mut balances = self.balances.write().unwrap();
        
        if let Some(balance) = balances.get_mut(&key) {
            balance.unlock(amount);
        }
    }
    
    /// Transfer between accounts (atomic)
    pub fn transfer(&self, from: &str, to: &str, asset: &str, amount: f64) -> Result<String, String> {
        let journal_id = generate_id("journal");
        
        let entries = vec![
            JournalEntryRequest {
                account_id: from.to_string(),
                account_type: AccountType::Spot,
                asset: asset.to_string(),
                amount: -amount,
                entry_type: EntryType::Transfer,
                reference_id: journal_id.clone(),
                description: "transfer out".to_string(),
            },
            JournalEntryRequest {
                account_id: to.to_string(),
                account_type: AccountType::Spot,
                asset: asset.to_string(),
                amount: amount,
                entry_type: EntryType::Transfer,
                reference_id: journal_id.clone(),
                description: "transfer in".to_string(),
            },
        ];
        
        self.create_journal(&journal_id, entries)?;
        
        Ok(journal_id)
    }
    
    /// Get account statement
    pub fn get_statement(&self, account_id: &str, asset: &str) -> Vec<LedgerEntry> {
        self.entries.read().unwrap()
            .iter()
            .filter(|e| e.account_id == account_id && e.asset == asset)
            .cloned()
            .collect()
    }
}

/// Helper to create balance key
fn balance_key(account_id: &str, account_type: AccountType, asset: &str) -> String {
    format!("{}:{:?}:{}", account_id, account_type, asset)
}

/// Request for journal entry
pub struct JournalEntryRequest {
    pub account_id: String,
    pub account_type: AccountType,
    pub asset: String,
    pub amount: f64,
    pub entry_type: EntryType,
    pub reference_id: String,
    pub description: String,
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
    fn test_transfer() {
        let ledger = LedgerEngine::new();
        
        // Credit accounts first
        ledger.create_journal("init", vec![
            JournalEntryRequest {
                account_id: "user1".to_string(),
                account_type: AccountType::Spot,
                asset: "USDT".to_string(),
                amount: 10000.0,
                entry_type: EntryType::Deposit,
                reference_id: "init".to_string(),
                description: "initial deposit".to_string(),
            },
        ]).unwrap();
        
        // Transfer
        let result = ledger.transfer("user1", "user2", "USDT", 1000.0);
        assert!(result.is_ok());
    }
}