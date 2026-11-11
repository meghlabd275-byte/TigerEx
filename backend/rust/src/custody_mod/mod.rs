// Custody - Secure Asset Custody
// Rust for multi-signature and cold storage
//
// A vault is a threshold multisig over a fixed signer set. The rules that guard
// funds: a withdrawal only executes once `threshold` *authorized* signers have
// approved it, the vault must hold the amount at execution time, and only then
// does the balance move. Nothing here invents an address or a balance.

use std::collections::HashMap;

fn is_positive_finite(amount: f64) -> bool {
    amount.is_finite() && amount > 0.0
}

// Vault
#[derive(Debug, Clone)]
pub struct Vault {
    pub id: String,
    pub name: String,
    /// On-chain deposit address. Assigned by the HD/MPC derivation layer once
    /// the vault is funded; left empty until then rather than fabricated.
    pub address: String,
    pub balance: f64,
    pub threshold: i32,
    pub signers: Vec<String>,
}

impl Vault {
    pub fn new(id: &str, name: &str, addr: &str, threshold: i32, signers: Vec<String>) -> Self {
        Vault {
            id: id.to_string(),
            name: name.to_string(),
            address: addr.to_string(),
            balance: 0.0,
            threshold,
            signers,
        }
    }

    pub fn deposit(&mut self, amount: f64) -> Result<(), String> {
        if !is_positive_finite(amount) {
            return Err("deposit amount must be positive and finite".to_string());
        }
        self.balance += amount;
        Ok(())
    }

    pub fn withdraw(&mut self, amount: f64) -> Result<(), String> {
        if !is_positive_finite(amount) {
            return Err("withdrawal amount must be positive and finite".to_string());
        }
        if amount > self.balance {
            return Err("insufficient balance".to_string());
        }
        self.balance -= amount;
        Ok(())
    }

    pub fn is_authorized_signer(&self, signer: &str) -> bool {
        self.signers.iter().any(|s| s == signer)
    }
}

// Multi-sig transaction
#[derive(Debug, Clone)]
pub struct MultisigTx {
    pub id: String,
    pub vault_id: String,
    pub to: String,
    pub amount: f64,
    pub approvals: Vec<String>,
    pub required: i32,
    pub executed: bool,
}

impl MultisigTx {
    pub fn new(vault_id: &str, to: &str, amount: f64, required: i32) -> Self {
        MultisigTx {
            id: format!("tx_{}", now_ms()),
            vault_id: vault_id.to_string(),
            to: to.to_string(),
            amount,
            approvals: Vec::new(),
            required,
            executed: false,
        }
    }

    /// Record one approval. Returns `true` once the threshold is reached.
    /// A repeated approval from the same signer is ignored, and an already
    /// executed transaction cannot be approved again.
    pub fn approve(&mut self, signer: &str) -> bool {
        if self.executed {
            return true;
        }
        if !self.approvals.iter().any(|s| s == signer) {
            self.approvals.push(signer.to_string());
        }
        self.approvals.len() as i32 >= self.required
    }

    pub fn is_executable(&self) -> bool {
        self.executed
    }
}

// Custody manager
pub struct CustodyMgr {
    vaults: HashMap<String, Vault>,
    transactions: HashMap<String, MultisigTx>,
    counter: u64,
}

impl CustodyMgr {
    pub fn new() -> Self {
        CustodyMgr {
            vaults: HashMap::new(),
            transactions: HashMap::new(),
            counter: 0,
        }
    }

    /// Create a vault. `threshold` must be at least 1 and at most the number of
    /// distinct signers, so a vault can neither execute on zero approvals nor
    /// be created in a state where it can never reach its threshold.
    pub fn create_vault(&mut self, name: &str, threshold: i32, signers: Vec<String>) -> Result<String, String> {
        if name.trim().is_empty() {
            return Err("vault name is required".to_string());
        }
        let mut unique: Vec<String> = Vec::new();
        for s in signers {
            if s.trim().is_empty() {
                return Err("signer must not be empty".to_string());
            }
            if !unique.contains(&s) {
                unique.push(s);
            }
        }
        if unique.is_empty() {
            return Err("a vault requires at least one signer".to_string());
        }
        if threshold < 1 || threshold as usize > unique.len() {
            return Err("threshold must be between 1 and the number of signers".to_string());
        }

        self.counter += 1;
        let id = format!("vault_{}_{}", now_ms(), self.counter);

        // The deposit address comes from the custody derivation layer; this
        // manager does not invent one.
        let vault = Vault::new(&id, name, "", threshold, unique);
        self.vaults.insert(id.clone(), vault);
        Ok(id)
    }

    /// Attach the real, derived deposit address to a vault.
    pub fn set_address(&mut self, vault_id: &str, address: &str) -> Result<(), String> {
        if address.trim().is_empty() {
            return Err("address must not be empty".to_string());
        }
        let vault = self.vaults.get_mut(vault_id).ok_or("vault not found")?;
        vault.address = address.to_string();
        Ok(())
    }

    pub fn deposit(&mut self, vault_id: &str, amount: f64) -> Result<(), String> {
        let vault = self.vaults.get_mut(vault_id).ok_or("vault not found")?;
        vault.deposit(amount)
    }

    pub fn request_withdrawal(&mut self, vault_id: &str, to: &str, amount: f64) -> Result<String, String> {
        if to.trim().is_empty() {
            return Err("destination address is required".to_string());
        }
        if !is_positive_finite(amount) {
            return Err("withdrawal amount must be positive and finite".to_string());
        }
        let vault = self.vaults.get(vault_id).ok_or("vault not found")?;
        if amount > vault.balance {
            return Err("insufficient balance".to_string());
        }
        let tx = MultisigTx::new(vault_id, to, amount, vault.threshold);
        let id = tx.id.clone();
        self.transactions.insert(id.clone(), tx);
        Ok(id)
    }

    /// Approve a pending withdrawal. The signer must be one of the vault's
    /// signers. When the approval count reaches the threshold the withdrawal
    /// executes and the vault balance is debited; if the vault no longer holds
    /// the amount, execution fails closed and the transaction stays pending.
    pub fn approve_tx(&mut self, tx_id: &str, signer: &str) -> Result<bool, String> {
        let (vault_id, amount) = {
            let tx = self.transactions.get(tx_id).ok_or("transaction not found")?;
            if tx.executed {
                return Err("transaction already executed".to_string());
            }
            let vault = self.vaults.get(&tx.vault_id).ok_or("vault not found")?;
            if !vault.is_authorized_signer(signer) {
                return Err("signer is not authorized for this vault".to_string());
            }
            (tx.vault_id.clone(), tx.amount)
        };

        let reached = {
            let tx = self.transactions.get_mut(tx_id).ok_or("transaction not found")?;
            tx.approve(signer)
        };
        if !reached {
            return Ok(false);
        }

        {
            let vault = self.vaults.get_mut(&vault_id).ok_or("vault not found")?;
            vault.withdraw(amount)?;
        }
        if let Some(tx) = self.transactions.get_mut(tx_id) {
            tx.executed = true;
        }
        Ok(true)
    }

    pub fn get_balance(&self, vault_id: &str) -> f64 {
        self.vaults.get(vault_id).map(|v| v.balance).unwrap_or(0.0)
    }
}

impl Default for CustodyMgr {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signers() -> Vec<String> {
        vec!["s1".to_string(), "s2".to_string(), "s3".to_string()]
    }

    #[test]
    fn test_vault() {
        let mut vault = Vault::new("v1", "Test", "0xABC", 2, signers());
        vault.deposit(1000.0).unwrap();
        assert_eq!(vault.balance, 1000.0);
    }

    #[test]
    fn deposit_and_withdraw_reject_non_positive() {
        let mut vault = Vault::new("v1", "Test", "0xABC", 2, signers());
        assert!(vault.deposit(0.0).is_err());
        assert!(vault.deposit(-1.0).is_err());
        assert!(vault.deposit(f64::NAN).is_err());
        vault.deposit(10.0).unwrap();
        assert!(vault.withdraw(-5.0).is_err());
        assert!(vault.withdraw(11.0).is_err());
        assert_eq!(vault.balance, 10.0);
    }

    #[test]
    fn threshold_is_validated() {
        let mut m = CustodyMgr::new();
        assert!(m.create_vault("v", 0, signers()).is_err());
        assert!(m.create_vault("v", 4, signers()).is_err());
        assert!(m.create_vault("", 1, signers()).is_err());
        assert!(m.create_vault("v", 1, vec![]).is_err());
        assert!(m.create_vault("v", 2, signers()).is_ok());
    }

    #[test]
    fn create_vault_does_not_fabricate_an_address() {
        let mut m = CustodyMgr::new();
        let id = m.create_vault("v", 2, signers()).unwrap();
        assert!(m.vaults.get(&id).unwrap().address.is_empty());
        m.set_address(&id, "bc1qexampleaddress").unwrap();
        assert_eq!(m.vaults.get(&id).unwrap().address, "bc1qexampleaddress");
    }

    #[test]
    fn withdrawal_needs_authorized_signers_and_moves_funds_once() {
        let mut m = CustodyMgr::new();
        let id = m.create_vault("v", 2, signers()).unwrap();
        m.deposit(&id, 100.0).unwrap();
        let tx = m.request_withdrawal(&id, "dest", 40.0).unwrap();

        // An unknown signer cannot count toward the threshold.
        assert!(m.approve_tx(&tx, "attacker").is_err());
        assert_eq!(m.get_balance(&id), 100.0);

        assert!(!m.approve_tx(&tx, "s1").unwrap());
        assert_eq!(m.get_balance(&id), 100.0);
        assert!(!m.approve_tx(&tx, "s1").unwrap()); // duplicate ignored
        assert!(m.approve_tx(&tx, "s2").unwrap());
        assert_eq!(m.get_balance(&id), 60.0);

        // The executed transaction cannot run a second time.
        assert!(m.approve_tx(&tx, "s3").is_err());
        assert_eq!(m.get_balance(&id), 60.0);
    }

    #[test]
    fn withdrawal_beyond_balance_fails_closed() {
        let mut m = CustodyMgr::new();
        let id = m.create_vault("v", 1, signers()).unwrap();
        m.deposit(&id, 10.0).unwrap();
        assert!(m.request_withdrawal(&id, "dest", 11.0).is_err());
        let tx = m.request_withdrawal(&id, "dest", 10.0).unwrap();
        // Drain the vault so the execution-time balance check fails.
        m.vaults.get_mut(&id).unwrap().balance = 0.0;
        assert!(m.approve_tx(&tx, "s1").is_err());
        assert_eq!(m.get_balance(&id), 0.0);
    }
}
