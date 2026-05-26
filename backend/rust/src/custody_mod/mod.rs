// Custody - Secure Asset Custody
// Rust for multi-signature and cold storage

use std::collections::HashMap;

// Vault
#[derive(Debug, Clone)]
pub struct Vault {
    pub id: String,
    pub name: String,
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

    pub fn deposit(&mut self, amount: f64) {
        self.balance += amount;
    }

    pub fn withdraw(&mut self, amount: f64) -> Result<(), String> {
        if amount > self.balance {
            return Err("insufficient balance".to_string());
        }
        self.balance -= amount;
        Ok(())
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

    pub fn approve(&mut self, signer: &str) {
        if !self.approvals.contains(&signer.to_string()) {
            self.approvals.push(signer.to_string());
        }

        if self.approvals.len() as i32 >= self.required {
            self.executed = true;
        }
    }

    pub fn is_executable(&self) -> bool {
        self.executed
    }
}

// Custody manager
pub struct CustodyMgr {
    vaults: HashMap<String, Vault>,
    transactions: HashMap<String, MultisigTx>,
}

impl CustodyMgr {
    pub fn new() -> Self {
        CustodyMgr {
            vaults: HashMap::new(),
            transactions: HashMap::new(),
        }
    }

    pub fn create_vault(&mut self, name: &str, threshold: i32, signers: Vec<String>) -> String {
        let id = format!("vault_{}", now_ms());
        let addr = format!("0x{}", &id[6..14]);

        let vault = Vault::new(&id, name, &addr, threshold, signers);
        self.vaults.insert(id.clone(), vault);
        id
    }

    pub fn deposit(&mut self, vault_id: &str, amount: f64) -> Result<(), String> {
        if let Some(vault) = self.vaults.get_mut(vault_id) {
            vault.deposit(amount);
            Ok(())
        } else {
            Err("vault not found".to_string())
        }
    }

    pub fn request_withdrawal(&mut self, vault_id: &str, to: &str, amount: f64) -> Result<String, String> {
        if let Some(vault) = self.vaults.get(vault_id) {
            let tx = MultisigTx::new(vault_id, to, amount, vault.threshold);
            let id = tx.id.clone();
            self.transactions.insert(id.clone(), tx);
            Ok(id)
        } else {
            Err("vault not found".to_string())
        }
    }

    pub fn approve_tx(&mut self, tx_id: &str, signer: &str) -> Result<bool, String> {
        if let Some(tx) = self.transactions.get_mut(tx_id) {
            tx.approve(signer);
            Ok(tx.is_executable())
        } else {
            Err("transaction not found".to_string())
        }
    }

    pub fn get_balance(&self, vault_id: &str) -> f64 {
        self.vaults.get(vault_id).map(|v| v.balance).unwrap_or(0.0)
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

    #[test]
    fn test_vault() {
        let mut vault = Vault::new("v1", "Test", "0xABC", 2, vec!["s1".to_string(), "s2".to_string()]);
        
        vault.deposit(1000.0);
        
        assert_eq!(vault.balance, 1000.0);
    }
}