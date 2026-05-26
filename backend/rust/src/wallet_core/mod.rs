// Wallet Core - Secure Wallet Infrastructure
// Rust for memory-safe wallet operations

use std::collections::HashMap;

// Wallet type
#[derive(Debug, Clone)]
pub enum WalletType {
    Hot,
    Warm,
    Cold,
    Vault,
}

// Wallet
#[derive(Debug, Clone)]
pub struct Wallet {
    pub id: String,
    pub user_id: String,
    pub wallet_type: WalletType,
    pub addresses: HashMap<String, String>, // symbol -> address
    pub status: String, // active, frozen, disabled
    pub created_at: i64,
}

// Balance
#[derive(Debug, Clone)]
pub struct Balance {
    pub symbol: String,
    pub available: f64,
    pub locked: f64,
    pub total: f64,
}

// Withdrawal
#[derive(Debug, Clone)]
pub struct Withdrawal {
    pub id: String,
    pub wallet_id: String,
    pub symbol: String,
    pub amount: f64,
    pub to_address: String,
    pub fee: f64,
    pub status: String, // pending, processing, completed, failed
}

// Internal transfer
#[derive(Debug, Clone)]
pub struct Transfer {
    pub id: String,
    pub from_wallet: String,
    pub to_wallet: String,
    pub symbol: String,
    pub amount: f64,
    pub completed: bool,
}

// Wallet manager
pub struct WalletManager {
    wallets: HashMap<String, Wallet>,
    balances: HashMap<String, HashMap<String, Balance>>,
    withdrawals: HashMap<String, Vec<Withdrawal>>,
    transfers: Vec<Transfer>,
}

impl WalletManager {
    pub fn new() -> Self {
        WalletManager {
            wallets: HashMap::new(),
            balances: HashMap::new(),
            withdrawals: HashMap::new(),
            transfers: Vec::new(),
        }
    }

    // Create wallet
    pub fn create_wallet(&mut self, user_id: &str, wallet_type: WalletType) -> String {
        let id = format!("wallet_{}", rand_id());
        
        let wallet = Wallet {
            id: id.clone(),
            user_id: user_id.to_string(),
            wallet_type,
            addresses: HashMap::new(),
            status: "active".to_string(),
            created_at: now_ms(),
        };

        self.wallets.insert(id.clone(), wallet);
        self.balances.insert(id.clone(), HashMap::new());
        
        id
    }

    // Add address
    pub fn add_address(&mut self, wallet_id: &str, symbol: &str, address: &str) -> Result<(), String> {
        if let Some(wallet) = self.wallets.get_mut(wallet_id) {
            if wallet.status != "active" {
                return Err("wallet not active".to_string());
            }
            wallet.addresses.insert(symbol.to_string(), address.to_string());
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Credit balance
    pub fn credit(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance {
                symbol: symbol.to_string(),
                available: 0.0,
                locked: 0.0,
                total: 0.0,
            });
            balance.available += amount;
            balance.total += amount;
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Debit balance
    pub fn debit(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            if let Some(balance) = balances.get(symbol) {
                if balance.available < amount {
                    return Err("insufficient balance".to_string());
                }
            }
            
            let balance = balances.entry(symbol.to_string()).or_insert(Balance {
                symbol: symbol.to_string(),
                available: 0.0,
                locked: 0.0,
                total: 0.0,
            });
            balance.available -= amount;
            balance.total -= amount;
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Lock funds
    pub fn lock(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance {
                symbol: symbol.to_string(),
                available: 0.0,
                locked: 0.0,
                total: 0.0,
            });
            
            if balance.available < amount {
                return Err("insufficient available".to_string());
            }
            
            balance.available -= amount;
            balance.locked += amount;
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Unlock funds
    pub fn unlock(&mut self, wallet_id: &str, symbol: &str, amount: f64) -> Result<(), String> {
        if let Some(balances) = self.balances.get_mut(wallet_id) {
            let balance = balances.entry(symbol.to_string()).or_insert(Balance {
                symbol: symbol.to_string(),
                available: 0.0,
                locked: 0.0,
                total: 0.0,
            });
            
            balance.locked = (balance.locked - amount).max(0.0);
            balance.available += amount;
            return Ok(());
        }
        Err("wallet not found".to_string())
    }

    // Get balance
    pub fn get_balance(&self, wallet_id: &str, symbol: &str) -> Option<&Balance> {
        self.balances.get(wallet_id).and_then(|b| b.get(symbol))
    }

    // Internal transfer
    pub fn internal_transfer(&mut self, from: &str, to: &str, symbol: &str, amount: f64) -> Result<String, String> {
        self.debit(from, symbol, amount)?;
        self.credit(to, symbol, amount)?;

        let id = format!("transfer_{}", rand_id());
        
        let transfer = Transfer {
            id: id.clone(),
            from_wallet: from.to_string(),
            to_wallet: to.to_string(),
            symbol: symbol.to_string(),
            amount,
            completed: true,
        };

        self.transfers.push(transfer);
        
        Ok(id)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn rand_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    iter::repeat_with(|| chars[0]).take(16).map(|c| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet() {
        let mut mgr = WalletManager::new();
        
        let wid = mgr.create_wallet("user1", WalletType::Hot);
        mgr.credit(&wid, "USDT", 1000.0).unwrap();
        
        let bal = mgr.get_balance(&wid, "USDT").unwrap();
        
        assert_eq!(bal.total, 1000.0);
    }
}