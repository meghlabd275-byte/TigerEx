//! Treasury management.
//!
//! The previous implementation accepted any amount: `receive(-x)` debited the
//! treasury and `disburse` on an unknown asset silently returned false with no
//! reason. Balances could also go negative because only the disbursing path was
//! guarded.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum TreasuryError {
    InvalidAmount(f64),
    InsufficientBalance { asset: String, requested: f64, available: f64 },
}

impl std::fmt::Display for TreasuryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TreasuryError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            TreasuryError::InsufficientBalance { asset, requested, available } => write!(
                f,
                "requested {requested} {asset} exceeds available {available}"
            ),
        }
    }
}

impl std::error::Error for TreasuryError {}

/// A movement of funds in or out of the treasury.
#[derive(Debug, Clone, PartialEq)]
pub struct TreasuryEntry {
    pub asset: String,
    pub amount: f64,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Received,
    Disbursed,
}

pub struct TreasuryService {
    balances: RwLock<HashMap<String, f64>>,
    ledger: RwLock<Vec<TreasuryEntry>>,
}

impl TreasuryService {
    pub fn new() -> Self {
        Self {
            balances: RwLock::new(HashMap::new()),
            ledger: RwLock::new(Vec::new()),
        }
    }

    /// Credit the treasury. Rejects non-finite and non-positive amounts.
    pub fn receive(&self, asset: &str, amount: f64) -> Result<(), TreasuryError> {
        Self::validate(amount)?;
        let asset = asset.to_uppercase();
        *self
            .balances
            .write()
            .unwrap()
            .entry(asset.clone())
            .or_insert(0.0) += amount;
        self.ledger.write().unwrap().push(TreasuryEntry {
            asset,
            amount,
            kind: EntryKind::Received,
        });
        Ok(())
    }

    /// Debit the treasury, failing rather than overdrawing.
    pub fn disburse(&self, asset: &str, amount: f64) -> Result<(), TreasuryError> {
        Self::validate(amount)?;
        let asset = asset.to_uppercase();

        let mut balances = self.balances.write().unwrap();
        let available = balances.get(&asset).copied().unwrap_or(0.0);
        if available < amount {
            return Err(TreasuryError::InsufficientBalance {
                asset,
                requested: amount,
                available,
            });
        }
        *balances.get_mut(&asset).expect("checked above") -= amount;
        drop(balances);

        self.ledger.write().unwrap().push(TreasuryEntry {
            asset,
            amount,
            kind: EntryKind::Disbursed,
        });
        Ok(())
    }

    pub fn balance(&self, asset: &str) -> f64 {
        self.balances
            .read()
            .unwrap()
            .get(&asset.to_uppercase())
            .copied()
            .unwrap_or(0.0)
    }

    /// Net flow per asset across the ledger.
    pub fn net_flow(&self, asset: &str) -> f64 {
        let asset = asset.to_uppercase();
        self.ledger
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.asset == asset)
            .map(|e| match e.kind {
                EntryKind::Received => e.amount,
                EntryKind::Disbursed => -e.amount,
            })
            .sum()
    }

    pub fn ledger_len(&self) -> usize {
        self.ledger.read().unwrap().len()
    }

    fn validate(amount: f64) -> Result<(), TreasuryError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(TreasuryError::InvalidAmount(amount));
        }
        Ok(())
    }
}

impl Default for TreasuryService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_receipts_are_rejected() {
        let treasury = TreasuryService::new();
        treasury.receive("BTC", 10.0).unwrap();

        // The old implementation debited the treasury on a negative receive.
        assert!(treasury.receive("BTC", -5.0).is_err());
        assert_eq!(treasury.balance("BTC"), 10.0);
    }

    #[test]
    fn disburse_cannot_overdraw() {
        let treasury = TreasuryService::new();
        treasury.receive("USDT", 100.0).unwrap();

        assert_eq!(
            treasury.disburse("USDT", 150.0).unwrap_err(),
            TreasuryError::InsufficientBalance {
                asset: "USDT".to_string(),
                requested: 150.0,
                available: 100.0
            }
        );
        assert_eq!(treasury.balance("USDT"), 100.0);
    }

    #[test]
    fn assets_are_case_insensitive_and_independent() {
        let treasury = TreasuryService::new();
        treasury.receive("btc", 1.0).unwrap();
        treasury.receive("BTC", 2.0).unwrap();
        treasury.receive("ETH", 5.0).unwrap();

        assert_eq!(treasury.balance("BTC"), 3.0);
        assert_eq!(treasury.balance("ETH"), 5.0);
    }

    #[test]
    fn ledger_tracks_net_flow() {
        let treasury = TreasuryService::new();
        treasury.receive("USDT", 100.0).unwrap();
        treasury.disburse("USDT", 30.0).unwrap();

        assert_eq!(treasury.net_flow("USDT"), 70.0);
        assert_eq!(treasury.balance("USDT"), 70.0);
        assert_eq!(treasury.ledger_len(), 2);
    }

    #[test]
    fn disbursing_an_unheld_asset_fails_clearly() {
        let treasury = TreasuryService::new();
        assert!(matches!(
            treasury.disburse("DOGE", 1.0).unwrap_err(),
            TreasuryError::InsufficientBalance { .. }
        ));
    }
}
