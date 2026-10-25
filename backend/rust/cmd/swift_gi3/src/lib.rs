//! SWIFT gpi (MT103) message tracking.
//!
//! The previous implementation derived the reference id from the current
//! millisecond, so two messages sent in the same millisecond collided and the
//! second overwrote the first, and it accepted any amount.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct SwiftTransfer {
    /// The MT103 field 20 reference.
    pub ref_id: String,
    pub sender_bic: String,
    pub receiver_bic: String,
    pub amount: f64,
    pub currency: String,
    pub status: GpiStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpiStatus {
    Sent,
    InProgress,
    Credited,
    Rejected,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SwiftError {
    EmptyBic,
    EmptyCurrency,
    InvalidAmount(f64),
    UnknownReference(String),
    InvalidTransition { from: GpiStatus, to: GpiStatus },
}

impl std::fmt::Display for SwiftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SwiftError::EmptyBic => write!(f, "BIC must not be empty"),
            SwiftError::EmptyCurrency => write!(f, "currency must not be empty"),
            SwiftError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            SwiftError::UnknownReference(r) => write!(f, "unknown reference: {r}"),
            SwiftError::InvalidTransition { from, to } => {
                write!(f, "cannot move from {from:?} to {to:?}")
            }
        }
    }
}

impl std::error::Error for SwiftError {}

pub struct SwiftGI3Service {
    transfers: RwLock<HashMap<String, SwiftTransfer>>,
    next_id: RwLock<u64>,
}

impl SwiftGI3Service {
    pub fn new() -> Self {
        Self {
            transfers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Record an outgoing MT103 in the `Sent` state.
    pub fn send_mt103(
        &self,
        sender: &str,
        receiver: &str,
        amount: f64,
        currency: &str,
    ) -> Result<SwiftTransfer, SwiftError> {
        if sender.trim().is_empty() || receiver.trim().is_empty() {
            return Err(SwiftError::EmptyBic);
        }
        if currency.trim().is_empty() {
            return Err(SwiftError::EmptyCurrency);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(SwiftError::InvalidAmount(amount));
        }

        let mut next_id = self.next_id.write().unwrap();
        let ref_id = format!("gpi{:010}", *next_id);
        *next_id += 1;
        drop(next_id);

        let transfer = SwiftTransfer {
            ref_id: ref_id.clone(),
            sender_bic: sender.to_string(),
            receiver_bic: receiver.to_string(),
            amount,
            currency: currency.to_uppercase(),
            status: GpiStatus::Sent,
        };
        self.transfers
            .write()
            .unwrap()
            .insert(ref_id, transfer.clone());
        Ok(transfer)
    }

    /// Advance a transfer's status.
    ///
    /// A message moves Sent -> InProgress -> Credited, or to Rejected from
    /// Sent or InProgress. A Credited or Rejected message is terminal.
    pub fn advance(
        &self,
        ref_id: &str,
        status: GpiStatus,
    ) -> Result<SwiftTransfer, SwiftError> {
        let mut transfers = self.transfers.write().unwrap();
        let transfer = transfers
            .get_mut(ref_id)
            .ok_or_else(|| SwiftError::UnknownReference(ref_id.to_string()))?;

        let allowed = match (transfer.status, status) {
            (GpiStatus::Sent, GpiStatus::InProgress | GpiStatus::Rejected) => true,
            (GpiStatus::InProgress, GpiStatus::Credited | GpiStatus::Rejected) => true,
            _ => false,
        };
        if !allowed {
            return Err(SwiftError::InvalidTransition {
                from: transfer.status,
                to: status,
            });
        }

        transfer.status = status;
        Ok(transfer.clone())
    }

    /// The current status of a reference.
    pub fn track(&self, ref_id: &str) -> Option<GpiStatus> {
        self.transfers.read().unwrap().get(ref_id).map(|t| t.status)
    }

    pub fn transfer(&self, ref_id: &str) -> Option<SwiftTransfer> {
        self.transfers.read().unwrap().get(ref_id).cloned()
    }
}

impl Default for SwiftGI3Service {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_are_unique_even_within_the_same_millisecond() {
        let svc = SwiftGI3Service::new();
        let a = svc.send_mt103("AAAABBCC", "DDDDEEFF", 1_000.0, "USD").unwrap();
        let b = svc.send_mt103("AAAABBCC", "DDDDEEFF", 1_000.0, "USD").unwrap();

        // The old reference was the millisecond timestamp, so a and b collided.
        assert_ne!(a.ref_id, b.ref_id);
        assert!(svc.transfer(&a.ref_id).is_some());
        assert!(svc.transfer(&b.ref_id).is_some());
    }

    #[test]
    fn status_follows_the_lifecycle() {
        let svc = SwiftGI3Service::new();
        let t = svc.send_mt103("AAAABBCC", "DDDDEEFF", 1_000.0, "usd").unwrap();

        assert_eq!(t.status, GpiStatus::Sent);
        assert_eq!(t.currency, "USD");
        assert_eq!(
            svc.advance(&t.ref_id, GpiStatus::InProgress).unwrap().status,
            GpiStatus::InProgress
        );
        assert_eq!(
            svc.advance(&t.ref_id, GpiStatus::Credited).unwrap().status,
            GpiStatus::Credited
        );
    }

    #[test]
    fn invalid_transitions_are_rejected() {
        let svc = SwiftGI3Service::new();
        let t = svc.send_mt103("AAAABBCC", "DDDDEEFF", 1_000.0, "USD").unwrap();

        // Sent cannot jump straight to Credited.
        assert!(matches!(
            svc.advance(&t.ref_id, GpiStatus::Credited).unwrap_err(),
            SwiftError::InvalidTransition { .. }
        ));

        svc.advance(&t.ref_id, GpiStatus::InProgress).unwrap();
        svc.advance(&t.ref_id, GpiStatus::Credited).unwrap();
        // Credited is terminal.
        assert!(svc.advance(&t.ref_id, GpiStatus::InProgress).is_err());
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = SwiftGI3Service::new();
        assert!(svc.send_mt103("", "DDDDEEFF", 1.0, "USD").is_err());
        assert!(svc.send_mt103("AAAABBCC", "", 1.0, "USD").is_err());
        assert!(svc.send_mt103("AAAABBCC", "DDDDEEFF", 1.0, "").is_err());
        assert!(svc.send_mt103("AAAABBCC", "DDDDEEFF", -1.0, "USD").is_err());
        assert!(svc.send_mt103("AAAABBCC", "DDDDEEFF", f64::NAN, "USD").is_err());
        assert!(svc.advance("gpi_missing", GpiStatus::InProgress).is_err());
        assert!(svc.track("gpi_missing").is_none());
    }
}
