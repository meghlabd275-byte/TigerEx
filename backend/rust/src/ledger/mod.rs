// Ledger System - Financial Truth Layer
// Rust for ACID-compliant balance tracking

use std::collections::HashMap;
use serde::{Serialize, Deserialize};

// Transaction type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TxType {
    Deposit,
    Withdrawal,
    Trade,
    Transfer,
    Fee,
    Reward,
    Adjustment,
}

// Ledger entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub id: String,
    pub user_id: String,
    pub tx_type: TxType,
    pub symbol: String,
    pub amount: f64,
    pub balance_before: f64,
    pub balance_after: f64,
    pub reference: String, // order ID, tx hash, etc.
    pub timestamp: i64,
    pub status: String, // pending, confirmed, reverted
}

// Account balance
#[derive(Debug, Clone)]
pub struct Account {
    pub user_id: String,
    pub balances: HashMap<String, f64>, // symbol -> balance
    pub locked: HashMap<String, f64>, // symbol -> locked (pending orders)
}

impl Account {
    pub fn new(user_id: &str) -> Self {
        Account {
            user_id: user_id.to_string(),
            balances: HashMap::new(),
            locked: HashMap::new(),
        }
    }

    pub fn add_balance(&mut self, symbol: &str, amount: f64) {
        *self.balances.entry(symbol.to_string()).or_insert(0.0) += amount;
    }

    pub fn sub_balance(&mut self, symbol: &str, amount: f64) -> bool {
        let balance = self.balances.entry(symbol.to_string()).or_insert(0.0);
        if *balance >= amount {
            *balance -= amount;
            return true;
        }
        false
    }

    pub fn get_available(&self, symbol: &str) -> f64 {
        let balance = self.balances.get(symbol).unwrap_or(&0.0);
        let locked = self.locked.get(symbol).unwrap_or(&0.0);
        balance - locked
    }
}

// Ledger
pub struct Ledger {
    accounts: HashMap<String, Account>,
    entries: Vec<LedgerEntry>,
    pending: Vec<LedgerEntry>,
}

impl Ledger {
    pub fn new() -> Self {
        Ledger {
            accounts: HashMap::new(),
            entries: Vec::new(),
            pending: Vec::new(),
        }
    }

    // Get or create account
    pub fn get_account(&mut self, user_id: &str) -> &mut Account {
        self.accounts
            .entry(user_id.to_string())
            .or_insert_with(|| Account::new(user_id))
    }

    // Begin transaction (two-phase commit)
    pub fn begin_tx(&mut self, user_id: &str, symbol: &str, amount: f64, tx_type: TxType, reference: &str) -> Result<String, String> {
        let account = self.get_account(user_id);
        let balance_before = account.get_available(symbol);
        
        // Check sufficient balance for debits
        match tx_type {
            TxType::Withdrawal | TxType::Trade | TxType::Transfer | TxType::Fee => {
                if balance_before < amount {
                    return Err("insufficient balance".to_string());
                }
            }
            _ => {}
        }

        let entry = LedgerEntry {
            id: format!("tx_{}", random_id()),
            user_id: user_id.to_string(),
            tx_type,
            symbol: symbol.to_string(),
            amount,
            balance_before,
            balance_after: balance_before, // Will update on commit
            reference: reference.to_string(),
            timestamp: now_ms(),
            status: "pending".to_string(),
        };

        self.pending.push(entry.clone());
        Ok(entry.id)
    }

    // Commit transaction
    pub fn commit(&mut self, tx_id: &str) -> Result<(), String> {
        let entry_idx = self.pending.iter().position(|e| e.id == tx_id);
        
        if let Some(idx) = entry_idx {
            let entry = self.pending.remove(idx);
            let account = self.get_account(&entry.user_id);
            
            // Update balance
            match entry.tx_type {
                TxType::Deposit | TxType::Reward => {
                    account.add_balance(&entry.symbol, entry.amount);
                    entry.balance_after = account.get_available(&entry.symbol);
                }
                TxType::Withdrawal | TxType::Trade | TxType::Transfer | TxType::Fee => {
                    let success = account.sub_balance(&entry.symbol, entry.amount);
                    if !success {
                        return Err("insufficient balance".to_string());
                    }
                    entry.balance_after = account.get_available(&entry.symbol);
                }
                TxType::Adjustment => {
                    account.add_balance(&entry.symbol, entry.amount);
                    entry.balance_after = account.get_available(&entry.symbol);
                }
                TxType::Transfer => {} // Handled above
            }
            
            entry.status = "confirmed".to_string();
            self.entries.push(entry);
            
            Ok(())
        } else {
            Err("transaction not found".to_string())
        }
    }

    // Rollback transaction
    pub fn rollback(&mut self, tx_id: &str) -> Result<(), String> {
        let entry_idx = self.pending.iter().position(|e| e.id == tx_id);
        
        if let Some(idx) = entry_idx {
            let entry = self.pending.remove(idx);
            entry.status = "reverted".to_string();
            self.entries.push(entry);
            Ok(())
        } else {
            Err("transaction not found".to_string())
        }
    }

    // Get balance
    pub fn get_balance(&self, user_id: &str, symbol: &str) -> f64 {
        self.accounts
            .get(user_id)
            .map(|a| a.balances.get(symbol).unwrap_or(&0.0))
            .unwrap_or(&0.0)
    }

    // Get entry history
    pub fn get_history(&self, user_id: &str) -> Vec<&LedgerEntry> {
        self.entries
            .iter()
            .filter(|e| e.user_id == user_id)
            .collect()
    }

    // Replay ledger (for consistency verification)
    pub fn replay(&self) -> HashMap<String, HashMap<String, f64>> {
        let mut result = HashMap::new();
        
        for entry in &self.entries {
            if entry.status == "confirmed" {
                let balances = result.entry(entry.user_id.clone()).or_insert_with(HashMap::new);
                match entry.tx_type {
                    TxType::Deposit | TxType::Reward => {
                        *balances.entry(entry.symbol.clone()).or_insert(0.0) += entry.amount;
                    }
                    _ => {
                        *balances.entry(entry.symbol.clone()).or_insert(0.0) -= entry.amount;
                    }
                }
            }
        }
        
        result
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn random_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(16)
        .map(|c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ledger() {
        let mut ledger = Ledger::new();
        
        // Deposit
        let tx_id = ledger.begin_tx("user1", "USDT", 10000.0, TxType::Deposit, "dep_001").unwrap();
        ledger.commit(&tx_id).unwrap();
        
        assert_eq!(ledger.get_balance("user1", "USDT"), 10000.0);
    }
}