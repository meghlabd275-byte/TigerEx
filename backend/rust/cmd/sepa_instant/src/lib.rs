//! SEPA Instant Credit Transfer requests.
//!
//! The previous implementation accepted any amount (including negative and
//! NaN), derived ids from the transfer count so they were reused, and let a
//! settled transfer be re-settled.
//!
//! This module records transfer intent and its lifecycle. It does not claim a
//! connection to a bank or clearing network; settlement status is set by the
//! caller that owns that rail.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct SEPATransfer {
    pub id: String,
    pub from_iban: String,
    pub to_iban: String,
    pub amount: f64,
    pub currency: String,
    pub status: TransferStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferStatus {
    Pending,
    Settled,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SepaError {
    EmptyIban,
    InvalidAmount(f64),
    SameAccount,
    UnsupportedCurrency(String),
    UnknownTransfer(String),
    NotPending(String),
}

impl std::fmt::Display for SepaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SepaError::EmptyIban => write!(f, "IBAN must not be empty"),
            SepaError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            SepaError::SameAccount => write!(f, "source and destination must differ"),
            SepaError::UnsupportedCurrency(c) => write!(f, "currency {c} is not a SEPA currency"),
            SepaError::UnknownTransfer(id) => write!(f, "unknown transfer: {id}"),
            SepaError::NotPending(id) => write!(f, "transfer {id} is not pending"),
        }
    }
}

impl std::error::Error for SepaError {}

/// Currencies SEPA Instant supports.
const SEPA_CURRENCIES: [&str; 1] = ["EUR"];

pub struct SEPAInstantService {
    transfers: RwLock<HashMap<String, SEPATransfer>>,
    next_id: RwLock<u64>,
}

impl SEPAInstantService {
    pub fn new() -> Self {
        Self {
            transfers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Record a pending SEPA Instant transfer.
    pub fn transfer(
        &self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<SEPATransfer, SepaError> {
        self.transfer_in(from, to, amount, "EUR")
    }

    pub fn transfer_in(
        &self,
        from: &str,
        to: &str,
        amount: f64,
        currency: &str,
    ) -> Result<SEPATransfer, SepaError> {
        if from.trim().is_empty() || to.trim().is_empty() {
            return Err(SepaError::EmptyIban);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(SepaError::InvalidAmount(amount));
        }
        if from == to {
            return Err(SepaError::SameAccount);
        }
        let currency = currency.to_uppercase();
        if !SEPA_CURRENCIES.contains(&currency.as_str()) {
            return Err(SepaError::UnsupportedCurrency(currency));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("sepa_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let transfer = SEPATransfer {
            id: id.clone(),
            from_iban: from.to_string(),
            to_iban: to.to_string(),
            amount,
            currency,
            status: TransferStatus::Pending,
        };
        self.transfers
            .write()
            .unwrap()
            .insert(id, transfer.clone());
        Ok(transfer)
    }

    fn set_status(&self, id: &str, status: TransferStatus) -> Result<SEPATransfer, SepaError> {
        let mut transfers = self.transfers.write().unwrap();
        let transfer = transfers
            .get_mut(id)
            .ok_or_else(|| SepaError::UnknownTransfer(id.to_string()))?;
        if transfer.status != TransferStatus::Pending {
            return Err(SepaError::NotPending(id.to_string()));
        }
        transfer.status = status;
        Ok(transfer.clone())
    }

    pub fn settle(&self, id: &str) -> Result<SEPATransfer, SepaError> {
        self.set_status(id, TransferStatus::Settled)
    }

    pub fn fail(&self, id: &str) -> Result<SEPATransfer, SepaError> {
        self.set_status(id, TransferStatus::Failed)
    }

    pub fn get(&self, id: &str) -> Option<SEPATransfer> {
        self.transfers.read().unwrap().get(id).cloned()
    }

    pub fn pending_count(&self) -> usize {
        self.transfers
            .read()
            .unwrap()
            .values()
            .filter(|t| t.status == TransferStatus::Pending)
            .count()
    }
}

impl Default for SEPAInstantService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_transfer_starts_pending_and_settles_once() {
        let svc = SEPAInstantService::new();
        let t = svc
            .transfer("DE89370400440532013000", "FR1420041010050500013M02606", 1_500.0)
            .unwrap();

        // The old implementation marked the transfer "instant" on creation.
        assert_eq!(t.status, TransferStatus::Pending);
        assert_eq!(svc.pending_count(), 1);

        assert_eq!(svc.settle(&t.id).unwrap().status, TransferStatus::Settled);
        assert_eq!(svc.pending_count(), 0);

        // A settled transfer cannot be settled again.
        assert!(matches!(
            svc.settle(&t.id).unwrap_err(),
            SepaError::NotPending(_)
        ));
    }

    #[test]
    fn invalid_amounts_are_rejected() {
        let svc = SEPAInstantService::new();
        // The old implementation accepted all of these.
        assert!(svc.transfer("A", "B", -1.0).is_err());
        assert!(svc.transfer("A", "B", f64::NAN).is_err());
        assert!(svc.transfer("A", "B", 0.0).is_err());
        assert_eq!(svc.pending_count(), 0);
    }

    #[test]
    fn empty_and_identical_accounts_are_rejected() {
        let svc = SEPAInstantService::new();
        assert!(svc.transfer("", "B", 1.0).is_err());
        assert!(svc.transfer("A", "", 1.0).is_err());
        assert!(matches!(
            svc.transfer("A", "A", 1.0).unwrap_err(),
            SepaError::SameAccount
        ));
    }

    #[test]
    fn only_euro_is_supported() {
        let svc = SEPAInstantService::new();
        assert!(svc.transfer_in("A", "B", 1.0, "EUR").is_ok());
        assert!(matches!(
            svc.transfer_in("A", "B", 1.0, "USD").unwrap_err(),
            SepaError::UnsupportedCurrency(_)
        ));
    }

    #[test]
    fn ids_are_unique() {
        let svc = SEPAInstantService::new();
        let a = svc.transfer("A", "B", 1.0).unwrap();
        let b = svc.transfer("A", "B", 1.0).unwrap();
        assert_ne!(a.id, b.id);
    }
}
