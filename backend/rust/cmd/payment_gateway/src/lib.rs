//! Fiat payment gateway.
//!
//! The previous implementation accepted any amount (including negative and
//! NaN), never debited a balance, derived ids from the payment count so they
//! were reused, and allowed `confirm` to be called repeatedly on the same
//! payment.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Payment {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub method: String,
    pub status: PaymentStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentStatus {
    Pending,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PaymentError {
    InvalidAmount(f64),
    EmptyMethod,
    UnknownPayment(String),
    AlreadyConfirmed(String),
    NotPending(String),
    InsufficientBalance { available: f64 },
}

impl std::fmt::Display for PaymentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            PaymentError::EmptyMethod => write!(f, "payment method must not be empty"),
            PaymentError::UnknownPayment(id) => write!(f, "unknown payment: {id}"),
            PaymentError::AlreadyConfirmed(id) => write!(f, "payment {id} is already confirmed"),
            PaymentError::NotPending(id) => write!(f, "payment {id} is not pending"),
            PaymentError::InsufficientBalance { available } => {
                write!(f, "only {available} available")
            }
        }
    }
}

impl std::error::Error for PaymentError {}

pub struct PaymentGatewayService {
    payments: RwLock<HashMap<String, Payment>>,
    /// user -> available fiat balance.
    balances: RwLock<HashMap<String, f64>>,
    next_id: RwLock<u64>,
}

impl PaymentGatewayService {
    pub fn new() -> Self {
        Self {
            payments: RwLock::new(HashMap::new()),
            balances: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        let mut next_id = self.next_id.write().unwrap();
        let id = format!("{prefix}_{}", *next_id);
        *next_id += 1;
        id
    }

    pub fn balance(&self, user_id: &str) -> f64 {
        self.balances
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(0.0)
    }

    /// Record a pending deposit. The balance is credited on confirmation.
    pub fn deposit(
        &self,
        user_id: &str,
        amount: f64,
        method: &str,
    ) -> Result<String, PaymentError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(PaymentError::InvalidAmount(amount));
        }
        if method.trim().is_empty() {
            return Err(PaymentError::EmptyMethod);
        }

        let id = self.next_id("dep");
        self.payments.write().unwrap().insert(
            id.clone(),
            Payment {
                id: id.clone(),
                user_id: user_id.to_string(),
                amount,
                method: method.to_string(),
                status: PaymentStatus::Pending,
            },
        );
        Ok(id)
    }

    /// Record a pending withdrawal. The balance is debited up front so the
    /// same funds cannot back two withdrawals; a failure refunds it.
    pub fn withdraw(
        &self,
        user_id: &str,
        amount: f64,
        method: &str,
    ) -> Result<String, PaymentError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(PaymentError::InvalidAmount(amount));
        }
        if method.trim().is_empty() {
            return Err(PaymentError::EmptyMethod);
        }

        {
            let mut balances = self.balances.write().unwrap();
            let available = balances.get(user_id).copied().unwrap_or(0.0);
            if available < amount {
                return Err(PaymentError::InsufficientBalance { available });
            }
            *balances.get_mut(user_id).expect("balance checked above") -= amount;
        }

        let id = self.next_id("wd");
        self.payments.write().unwrap().insert(
            id.clone(),
            Payment {
                id: id.clone(),
                user_id: user_id.to_string(),
                amount,
                method: method.to_string(),
                status: PaymentStatus::Pending,
            },
        );
        Ok(id)
    }

    /// Confirm a pending payment. A deposit credits the balance; a withdrawal
    /// already debited it. A payment can be confirmed only once.
    pub fn confirm(&self, payment_id: &str) -> Result<Payment, PaymentError> {
        let payment = {
            let mut payments = self.payments.write().unwrap();
            let payment = payments
                .get_mut(payment_id)
                .ok_or_else(|| PaymentError::UnknownPayment(payment_id.to_string()))?;

            if payment.status == PaymentStatus::Confirmed {
                return Err(PaymentError::AlreadyConfirmed(payment_id.to_string()));
            }
            if payment.status != PaymentStatus::Pending {
                return Err(PaymentError::NotPending(payment_id.to_string()));
            }
            payment.status = PaymentStatus::Confirmed;
            payment.clone()
        };

        if payment.id.starts_with("dep") {
            *self
                .balances
                .write()
                .unwrap()
                .entry(payment.user_id.clone())
                .or_insert(0.0) += payment.amount;
        }
        Ok(payment)
    }

    /// Fail a pending payment, refunding a reserved withdrawal.
    pub fn fail(&self, payment_id: &str) -> Result<Payment, PaymentError> {
        let payment = {
            let mut payments = self.payments.write().unwrap();
            let payment = payments
                .get_mut(payment_id)
                .ok_or_else(|| PaymentError::UnknownPayment(payment_id.to_string()))?;
            if payment.status != PaymentStatus::Pending {
                return Err(PaymentError::NotPending(payment_id.to_string()));
            }
            payment.status = PaymentStatus::Failed;
            payment.clone()
        };

        if payment.id.starts_with("wd") {
            *self
                .balances
                .write()
                .unwrap()
                .entry(payment.user_id.clone())
                .or_insert(0.0) += payment.amount;
        }
        Ok(payment)
    }

    pub fn payment(&self, payment_id: &str) -> Option<Payment> {
        self.payments.read().unwrap().get(payment_id).cloned()
    }
}

impl Default for PaymentGatewayService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmed_deposits_credit_the_balance() {
        let svc = PaymentGatewayService::new();
        let id = svc.deposit("u1", 500.0, "bank").unwrap();

        // Pending: not yet credited.
        assert_eq!(svc.balance("u1"), 0.0);

        svc.confirm(&id).unwrap();
        assert_eq!(svc.balance("u1"), 500.0);
    }

    #[test]
    fn a_payment_cannot_be_confirmed_twice() {
        let svc = PaymentGatewayService::new();
        let id = svc.deposit("u1", 500.0, "bank").unwrap();

        svc.confirm(&id).unwrap();
        // The old implementation re-credited on every call.
        assert!(matches!(
            svc.confirm(&id).unwrap_err(),
            PaymentError::AlreadyConfirmed(_)
        ));
        assert_eq!(svc.balance("u1"), 500.0);
    }

    #[test]
    fn withdrawals_reserve_the_balance_and_refund_on_failure() {
        let svc = PaymentGatewayService::new();
        let deposit = svc.deposit("u1", 1_000.0, "bank").unwrap();
        svc.confirm(&deposit).unwrap();

        let wd = svc.withdraw("u1", 400.0, "bank").unwrap();
        assert_eq!(svc.balance("u1"), 600.0);

        svc.fail(&wd).unwrap();
        assert_eq!(svc.balance("u1"), 1_000.0);
    }

    #[test]
    fn negative_and_non_finite_amounts_are_rejected() {
        let svc = PaymentGatewayService::new();
        // The old implementation accepted all of these.
        assert!(svc.deposit("u1", -1.0, "bank").is_err());
        assert!(svc.deposit("u1", f64::NAN, "bank").is_err());
        assert!(svc.withdraw("u1", -1.0, "bank").is_err());
        assert!(svc.deposit("u1", 1.0, "").is_err());
    }

    #[test]
    fn withdrawals_beyond_the_balance_are_rejected() {
        let svc = PaymentGatewayService::new();
        assert!(matches!(
            svc.withdraw("u1", 100.0, "bank").unwrap_err(),
            PaymentError::InsufficientBalance { .. }
        ));
    }

    #[test]
    fn ids_are_unique_across_deposits_and_withdrawals() {
        let svc = PaymentGatewayService::new();
        let a = svc.deposit("u1", 1.0, "bank").unwrap();
        let b = svc.deposit("u1", 1.0, "bank").unwrap();
        assert_ne!(a, b);
        assert!(svc.payment(&a).is_some());
        assert!(svc.payment(&b).is_some());
    }
}
