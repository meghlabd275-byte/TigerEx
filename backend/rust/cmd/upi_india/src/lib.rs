//! UPI payment requests.
//!
//! The previous implementation accepted any amount, marked every payment
//! "success" on creation, and derived ids from the payment count so they were
//! reused.
//!
//! This module records payment intent and its lifecycle. It does not claim a
//! connection to a UPI network; the final status is set by the caller that
//! owns that rail.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct UPITransfer {
    pub id: String,
    pub vpa: String,
    pub amount: f64,
    pub status: UpiStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpiStatus {
    Pending,
    Success,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UpiError {
    EmptyVpa,
    InvalidAmount(f64),
    InvalidVpaFormat,
    UnknownTransfer(String),
    NotPending(String),
}

impl std::fmt::Display for UpiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpiError::EmptyVpa => write!(f, "VPA must not be empty"),
            UpiError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            UpiError::InvalidVpaFormat => write!(f, "VPA must look like name@handle"),
            UpiError::UnknownTransfer(id) => write!(f, "unknown payment: {id}"),
            UpiError::NotPending(id) => write!(f, "payment {id} is not pending"),
        }
    }
}

impl std::error::Error for UpiError {}

pub struct UPIIndiaService {
    transfers: RwLock<HashMap<String, UPITransfer>>,
    next_id: RwLock<u64>,
}

impl UPIIndiaService {
    pub fn new() -> Self {
        Self {
            transfers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Record a pending UPI payment to a VPA.
    pub fn pay(&self, vpa: &str, amount: f64) -> Result<UPITransfer, UpiError> {
        if vpa.trim().is_empty() {
            return Err(UpiError::EmptyVpa);
        }
        // A UPI VPA is "handle@provider".
        let mut parts = vpa.split('@');
        let handle = parts.next().unwrap_or("");
        let provider = parts.next().unwrap_or("");
        if handle.is_empty() || provider.is_empty() || parts.next().is_some() {
            return Err(UpiError::InvalidVpaFormat);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(UpiError::InvalidAmount(amount));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("upi_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let transfer = UPITransfer {
            id: id.clone(),
            vpa: vpa.to_string(),
            amount,
            status: UpiStatus::Pending,
        };
        self.transfers
            .write()
            .unwrap()
            .insert(id, transfer.clone());
        Ok(transfer)
    }

    fn set_status(&self, id: &str, status: UpiStatus) -> Result<UPITransfer, UpiError> {
        let mut transfers = self.transfers.write().unwrap();
        let transfer = transfers
            .get_mut(id)
            .ok_or_else(|| UpiError::UnknownTransfer(id.to_string()))?;
        if transfer.status != UpiStatus::Pending {
            return Err(UpiError::NotPending(id.to_string()));
        }
        transfer.status = status;
        Ok(transfer.clone())
    }

    pub fn confirm(&self, id: &str) -> Result<UPITransfer, UpiError> {
        self.set_status(id, UpiStatus::Success)
    }

    pub fn fail(&self, id: &str) -> Result<UPITransfer, UpiError> {
        self.set_status(id, UpiStatus::Failed)
    }

    pub fn get(&self, id: &str) -> Option<UPITransfer> {
        self.transfers.read().unwrap().get(id).cloned()
    }

    pub fn pending_count(&self) -> usize {
        self.transfers
            .read()
            .unwrap()
            .values()
            .filter(|t| t.status == UpiStatus::Pending)
            .count()
    }
}

impl Default for UPIIndiaService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_payment_starts_pending_and_confirms_once() {
        let svc = UPIIndiaService::new();
        let p = svc.pay("alice@okhdfcbank", 2_500.0).unwrap();

        // The old implementation marked every payment "success" immediately.
        assert_eq!(p.status, UpiStatus::Pending);
        assert_eq!(svc.pending_count(), 1);

        assert_eq!(svc.confirm(&p.id).unwrap().status, UpiStatus::Success);
        assert!(matches!(
            svc.confirm(&p.id).unwrap_err(),
            UpiError::NotPending(_)
        ));
    }

    #[test]
    fn invalid_amounts_are_rejected() {
        let svc = UPIIndiaService::new();
        assert!(svc.pay("alice@okhdfcbank", -1.0).is_err());
        assert!(svc.pay("alice@okhdfcbank", f64::NAN).is_err());
        assert!(svc.pay("alice@okhdfcbank", 0.0).is_err());
        assert_eq!(svc.pending_count(), 0);
    }

    #[test]
    fn vpa_format_is_validated() {
        let svc = UPIIndiaService::new();
        assert!(matches!(svc.pay("", 1.0).unwrap_err(), UpiError::EmptyVpa));
        assert!(matches!(
            svc.pay("alice", 1.0).unwrap_err(),
            UpiError::InvalidVpaFormat
        ));
        assert!(matches!(
            svc.pay("alice@bank@extra", 1.0).unwrap_err(),
            UpiError::InvalidVpaFormat
        ));
        assert!(svc.pay("alice@okhdfcbank", 1.0).is_ok());
    }

    #[test]
    fn ids_are_unique() {
        let svc = UPIIndiaService::new();
        let a = svc.pay("alice@bank", 1.0).unwrap();
        let b = svc.pay("alice@bank", 1.0).unwrap();
        assert_ne!(a.id, b.id);
    }
}
