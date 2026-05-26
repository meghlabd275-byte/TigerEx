//! Fiat Gateway - Rust Implementation
//! On/off ramps, bank transfers

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatTransaction {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub direction: Direction,
    pub status: TxStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Deposit,
    Withdrawal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TxStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

pub struct FiatGateway {
    txs: HashMap<String, FiatTransaction>,
}

impl FiatGateway {
    pub fn new() -> Self {
        Self { txs: HashMap::new() }
    }
    pub fn deposit(&mut self, uid: &str, amount: f64, curr: &str) -> String {
        let id = format!("FIAT_{}", self.txs.len());
        self.txs.insert(id.clone(), FiatTransaction {
            id: id.clone(),
            user_id: uid.to_string(),
            amount,
            currency: curr.to_string(),
            direction: Direction::Deposit,
            status: TxStatus::Pending,
        });
        id
    }
    pub fn withdraw(&mut self, uid: &str, amount: f64, curr: &str) -> String {
        let id = format!("FIAT_{}", self.txs.len());
        self.txs.insert(id.clone(), FiatTransaction {
            id: id.clone(),
            user_id: uid.to_string(),
            amount,
            currency: curr.to_string(),
            direction: Direction::Withdrawal,
            status: TxStatus::Pending,
        });
        id
    }
    pub fn update_status(&mut self, txid: &str, st: TxStatus) {
        if let Some(t) = self.txs.get_mut(txid) {
            t.status = st;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_fiat() {
        let mut g = FiatGateway::new();
        let id = g.deposit("user1", 1000.0, "USD");
        assert!(!id.is_empty());
    }
}
