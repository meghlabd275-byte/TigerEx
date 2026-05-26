//! Custody Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustodianAccount {
    pub user_id: String,
    pub assets: HashMap<String, f64>,
    pub insured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColdWallet {
    pub address: String,
    pub balance: f64,
    pub online: bool,
}

pub struct CustodyService {
    accounts: HashMap<String, CustodianAccount>,
    cold_wallets: HashMap<String, ColdWallet>,
}

impl CustodyService {
    pub fn new() -> Self {
        Self { accounts: HashMap::new(), cold_wallets: HashMap::new() }
    }
    pub fn create_account(&mut self, uid: &str) -> String {
        let acc = CustodianAccount { user_id: uid.to_string(), assets: HashMap::new(), insured: true };
        self.accounts.insert(uid.to_string(), acc);
        uid.to_string()
    }
    pub fn deposit(&mut self, uid: &str, asset: &str, amount: f64) -> Result<(), String> {
        let acc = self.accounts.get_mut(uid).ok_or("Account not found")?;
        *acc.assets.entry(asset.to_string()).or_insert(0.0) += amount;
        Ok(())
    }
    pub fn withdraw(&mut self, uid: &str, asset: &str, amount: f64) -> Result<(), String> {
        let acc = self.accounts.get_mut(uid).ok_or("Account not found")?;
        let bal = acc.assets.get_mut(asset).ok_or("Asset not found")?;
        if *bal < amount { return Err("Insufficient balance".into()); }
        *bal -= amount;
        Ok(())
    }
    pub fn add_cold_wallet(&mut self, addr: &str) {
        self.cold_wallets.insert(addr.to_string(), ColdWallet { address: addr.to_string(), balance: 0.0, online: false });
    }
    pub fn get_balance(&self, uid: &str, asset: &str) -> f64 {
        self.accounts.get(uid).and_then(|a| a.assets.get(asset)).copied().unwrap_or(0.0)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_custody() { let mut s = CustodyService::new(); s.create_account("user1"); assert!(s.deposit("user1", "BTC", 1.0).is_ok()); } }
