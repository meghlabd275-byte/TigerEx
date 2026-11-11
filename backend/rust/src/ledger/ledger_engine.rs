// Ledger Engine - Critical Money Path in Rust
// Double-entry bookkeeping for all account transactions.
//
// Invariants this engine enforces:
//   * A journal must balance: the signed sum of its entries is zero, so a
//     movement is always zero-sum and no value is created or destroyed.
//   * A journal is applied atomically. Every entry is checked against the
//     resulting balance first; if any entry would overdraw an account the whole
//     journal is rejected and no balance moves.
//   * A debit, credit or lock of a non-positive or non-finite amount is
//     rejected. A negative debit would otherwise credit the account.
//   * An unlock consumes no more than is locked; unlocking more would mint
//     available balance out of nothing.
//   * Entry and journal ids are random, never derived from the clock alone.

use std::collections::{HashMap, HashSet};
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
    pub amount: f64, // Positive = credit, Negative = debit
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

    pub fn credit(&mut self, amount: f64) -> Result<(), String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("credit amount must be positive and finite".to_string());
        }
        self.available += amount;
        self.total += amount;
        self.updated_at = timestamp_ms();
        Ok(())
    }

    pub fn debit(&mut self, amount: f64) -> Result<(), String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("debit amount must be positive and finite".to_string());
        }
        if self.available < amount {
            return Err("insufficient balance".to_string());
        }
        self.available -= amount;
        self.total -= amount;
        self.updated_at = timestamp_ms();
        Ok(())
    }

    pub fn lock(&mut self, amount: f64) -> Result<(), String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("lock amount must be positive and finite".to_string());
        }
        if self.available < amount {
            return Err("insufficient available balance".to_string());
        }
        self.available -= amount;
        self.locked += amount;
        self.updated_at = timestamp_ms();
        Ok(())
    }

    /// Return locked balance to available. Fails closed when the amount is not
    /// positive and finite or exceeds what is locked.
    pub fn unlock(&mut self, amount: f64) -> Result<(), String> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("unlock amount must be positive and finite".to_string());
        }
        if self.locked < amount {
            return Err("cannot unlock more than is locked".to_string());
        }
        self.locked -= amount;
        self.available += amount;
        self.updated_at = timestamp_ms();
        Ok(())
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

    /// Current available balance (0 when the account/asset is unknown).
    pub fn available_balance(&self, account_id: &str, account_type: AccountType, asset: &str) -> f64 {
        let key = balance_key(account_id, account_type, asset);
        self.balances
            .read()
            .unwrap()
            .get(&key)
            .map(|b| b.available)
            .unwrap_or(0.0)
    }

    /// Create journal entry (atomic double-entry).
    ///
    /// Validation runs against a scratch copy of the touched balances, so a
    /// journal that would overdraw any account is rejected without moving a
    /// single unit.
    pub fn create_journal(&self, journal_id: &str, entries: Vec<JournalEntryRequest>) -> Result<JournalEntry, String> {
        if journal_id.trim().is_empty() {
            return Err("journal id is required".to_string());
        }
        if entries.is_empty() {
            return Err("a journal needs at least one entry".to_string());
        }
        for req in &entries {
            if req.account_id.trim().is_empty() {
                return Err("entry account id is required".to_string());
            }
            if req.asset.trim().is_empty() {
                return Err("entry asset is required".to_string());
            }
            if !req.amount.is_finite() {
                return Err("entry amount must be finite".to_string());
            }
        }

        // The signed sum must be zero: every debit is matched by a credit.
        let total: f64 = entries.iter().map(|e| e.amount).sum();
        if total.abs() > 1e-9 {
            return Err("journal entries must balance (debits = credits)".to_string());
        }

        let now = timestamp_ms();
        let mut balances = self.balances.write().unwrap();

        // Validate the whole journal against a scratch copy.
        let mut scratch: HashMap<String, AccountBalance> = HashMap::new();
        for req in &entries {
            let key = balance_key(&req.account_id, req.account_type, &req.asset);
            let working = scratch.entry(key.clone()).or_insert_with(|| {
                balances
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| AccountBalance::new(&req.account_id, req.account_type, &req.asset))
            });
            if req.amount >= 0.0 {
                working.credit(req.amount)?;
            } else {
                working.debit(-req.amount)?;
            }
        }

        // Apply for real and record the entries.
        let mut ledger_entries = Vec::with_capacity(entries.len());
        for req in &entries {
            let key = balance_key(&req.account_id, req.account_type, &req.asset);
            let balance = balances
                .entry(key.clone())
                .or_insert_with(|| AccountBalance::new(&req.account_id, req.account_type, &req.asset));

            let balance_before = balance.available;
            if req.amount >= 0.0 {
                balance.credit(req.amount)?;
            } else {
                balance.debit(-req.amount)?;
            }

            ledger_entries.push(LedgerEntry {
                id: generate_id("led"),
                account_id: req.account_id.clone(),
                account_type: req.account_type,
                asset: req.asset.clone(),
                amount: req.amount,
                balance_before,
                balance_after: balance.available,
                entry_type: req.entry_type,
                reference_id: req.reference_id.clone(),
                description: req.description.clone(),
                timestamp: now,
                journal_id: journal_id.to_string(),
            });
        }
        drop(balances);

        // Index touched accounts.
        {
            let mut index = self.account_assets.write().unwrap();
            for entry in &ledger_entries {
                index
                    .entry(entry.account_id.clone())
                    .or_default()
                    .insert(entry.asset.clone());
            }
        }
        self.entries.write().unwrap().extend(ledger_entries.iter().cloned());

        let journal = JournalEntry {
            id: journal_id.to_string(),
            entries: ledger_entries,
            status: JournalStatus::Posted,
            created_at: now,
            settled_at: Some(now),
        };

        self.journals
            .write()
            .unwrap()
            .insert(journal_id.to_string(), journal.clone());

        Ok(journal)
    }

    /// Get balance
    pub fn get_balance(&self, account_id: &str, account_type: AccountType, asset: &str) -> Option<AccountBalance> {
        let key = balance_key(account_id, account_type, asset);
        self.balances.read().unwrap().get(&key).cloned()
    }

    /// Get all balances for account
    pub fn get_account_balances(&self, account_id: &str) -> Vec<AccountBalance> {
        let assets = self
            .account_assets
            .read()
            .unwrap()
            .get(account_id)
            .cloned()
            .unwrap_or_default();

        let mut result = Vec::new();

        for asset in assets {
            for &at in &[
                AccountType::Spot,
                AccountType::Margin,
                AccountType::Futures,
                AccountType::Earn,
                AccountType::Funding,
                AccountType::Hot,
                AccountType::Cold,
            ] {
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

        let balance = balances
            .entry(key)
            .or_insert_with(|| AccountBalance::new(account_id, account_type, asset));

        balance.lock(amount)
    }

    /// Unlock funds. Fails closed when more is unlocked than is locked.
    pub fn unlock_funds(&self, account_id: &str, account_type: AccountType, asset: &str, amount: f64) -> Result<(), String> {
        let key = balance_key(account_id, account_type, asset);
        let mut balances = self.balances.write().unwrap();

        let balance = balances.get_mut(&key).ok_or("balance not found")?;
        balance.unlock(amount)
    }

    /// Transfer between accounts (atomic, zero-sum)
    pub fn transfer(&self, from: &str, to: &str, asset: &str, amount: f64) -> Result<String, String> {
        if from == to {
            return Err("sender and receiver must differ".to_string());
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err("transfer amount must be positive and finite".to_string());
        }

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
                amount,
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
        self.entries
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.account_id == account_id && e.asset == asset)
            .cloned()
            .collect()
    }
}

impl Default for LedgerEngine {
    fn default() -> Self {
        Self::new()
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
    use rand::RngCore;
    let mut bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("{}_{}", prefix, hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Credit a balance directly, standing in for the wallet/deposit layer
    /// that credits an on-chain deposit. Journals in these tests then move
    /// that real balance around.
    fn fund(ledger: &LedgerEngine, account: &str, asset: &str, amount: f64) {
        let key = balance_key(account, AccountType::Spot, asset);
        let mut balances = ledger.balances.write().unwrap();
        let bal = balances
            .entry(key)
            .or_insert_with(|| AccountBalance::new(account, AccountType::Spot, asset));
        bal.credit(amount).unwrap();
    }

    #[test]
    fn test_transfer() {
        let ledger = LedgerEngine::new();
        fund(&ledger, "user1", "USDT", 10_000.0);

        assert!(ledger.transfer("user1", "user2", "USDT", 1_000.0).is_ok());
        assert_eq!(ledger.available_balance("user1", AccountType::Spot, "USDT"), 9_000.0);
        assert_eq!(ledger.available_balance("user2", AccountType::Spot, "USDT"), 1_000.0);
    }

    #[test]
    fn a_journal_must_balance() {
        let ledger = LedgerEngine::new();
        let err = ledger.create_journal(
            "unbalanced",
            vec![JournalEntryRequest {
                account_id: "user1".to_string(),
                account_type: AccountType::Spot,
                asset: "USDT".to_string(),
                amount: 100.0,
                entry_type: EntryType::Adjustment,
                reference_id: "x".to_string(),
                description: "mint".to_string(),
            }],
        );
        assert!(err.is_err());
        assert_eq!(ledger.available_balance("user1", AccountType::Spot, "USDT"), 0.0);
    }

    #[test]
    fn an_overdraft_rejects_the_whole_journal() {
        let ledger = LedgerEngine::new();
        fund(&ledger, "user1", "USDT", 100.0);

        let err = ledger.create_journal(
            "over",
            vec![
                JournalEntryRequest {
                    account_id: "user1".to_string(),
                    account_type: AccountType::Spot,
                    asset: "USDT".to_string(),
                    amount: -150.0,
                    entry_type: EntryType::Transfer,
                    reference_id: "x".to_string(),
                    description: "too much".to_string(),
                },
                JournalEntryRequest {
                    account_id: "user2".to_string(),
                    account_type: AccountType::Spot,
                    asset: "USDT".to_string(),
                    amount: 150.0,
                    entry_type: EntryType::Transfer,
                    reference_id: "x".to_string(),
                    description: "too much".to_string(),
                },
            ],
        );
        assert!(err.is_err());
        // Neither leg moved.
        assert_eq!(ledger.available_balance("user1", AccountType::Spot, "USDT"), 100.0);
        assert_eq!(ledger.available_balance("user2", AccountType::Spot, "USDT"), 0.0);
    }

    #[test]
    fn a_negative_debit_cannot_mint() {
        let mut b = AccountBalance::new("u", AccountType::Spot, "USDT");
        b.credit(10.0).unwrap();
        // A negative debit or a negative credit is refused outright.
        assert!(b.debit(-5.0).is_err());
        assert!(b.credit(-5.0).is_err());
        assert_eq!(b.available, 10.0);
        assert_eq!(b.total, 10.0);
    }

    #[test]
    fn lock_and_unlock_move_between_available_and_locked() {
        let ledger = LedgerEngine::new();
        fund(&ledger, "user1", "USDT", 100.0);

        ledger.lock_funds("user1", AccountType::Spot, "USDT", 60.0).unwrap();
        let bal = ledger.get_balance("user1", AccountType::Spot, "USDT").unwrap();
        assert_eq!(bal.available, 40.0);
        assert_eq!(bal.locked, 60.0);
        assert_eq!(bal.total, 100.0);

        // Unlocking more than is locked must fail closed.
        assert!(ledger.unlock_funds("user1", AccountType::Spot, "USDT", 61.0).is_err());
        ledger.unlock_funds("user1", AccountType::Spot, "USDT", 60.0).unwrap();
        let bal = ledger.get_balance("user1", AccountType::Spot, "USDT").unwrap();
        assert_eq!(bal.available, 100.0);
        assert_eq!(bal.locked, 0.0);
    }

    #[test]
    fn lock_rejects_non_positive_amounts() {
        let ledger = LedgerEngine::new();
        fund(&ledger, "user1", "USDT", 100.0);
        assert!(ledger.lock_funds("user1", AccountType::Spot, "USDT", 0.0).is_err());
        assert!(ledger.lock_funds("user1", AccountType::Spot, "USDT", -10.0).is_err());
        assert!(ledger.lock_funds("user1", AccountType::Spot, "USDT", f64::NAN).is_err());
    }

    #[test]
    fn entry_ids_are_unique() {
        let ledger = LedgerEngine::new();
        fund(&ledger, "user1", "USDT", 100.0);
        fund(&ledger, "user2", "USDT", 100.0);
        ledger.transfer("user1", "user2", "USDT", 10.0).unwrap();
        ledger.transfer("user1", "user2", "USDT", 10.0).unwrap();

        let stmt = ledger.get_statement("user1", "USDT");
        assert_eq!(stmt.len(), 2);
        assert_ne!(stmt[0].id, stmt[1].id);
        assert_ne!(stmt[0].journal_id, stmt[1].journal_id);
    }
}
