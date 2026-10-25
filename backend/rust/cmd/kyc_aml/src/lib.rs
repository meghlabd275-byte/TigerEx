//! KYC review workflow and AML risk scoring.
//!
//! The previous implementation granted the highest verification level
//! (`complete_kyc` set Premium + Verified) with no review at all, and every
//! AML check returned a hardcoded risk score of 15 and `Passed`. Check ids
//! were built from the millisecond clock, so they collided.
//!
//! Here a submission enters review, only an explicit reviewer decision
//! verifies or rejects it, and the AML score is computed from the signals the
//! caller supplies.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KycLevel {
    Unverified,
    Basic,
    Intermediate,
    Advanced,
    Premium,
}

impl KycLevel {
    /// Withdrawal limit for a level, in quote currency.
    pub fn withdrawal_limit(self) -> f64 {
        match self {
            KycLevel::Unverified => 10_000.0,
            KycLevel::Basic => 100_000.0,
            KycLevel::Intermediate => 1_000_000.0,
            KycLevel::Advanced => 5_000_000.0,
            KycLevel::Premium => 10_000_000.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KycStatus {
    NotStarted,
    Pending,
    InReview,
    Verified,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserKyc {
    pub user_id: String,
    /// The highest level the user has been verified at.
    pub level: KycLevel,
    /// The level the user has asked for, if a submission is open.
    pub requested_level: Option<KycLevel>,
    pub status: KycStatus,
    /// Documents the user submitted for the open request.
    pub documents: Vec<String>,
    pub rejection_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AmlCheck {
    pub check_id: String,
    pub user_id: String,
    pub risk_score: i32,
    pub status: AmlStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AmlStatus {
    Pending,
    Passed,
    Flagged,
    Failed,
}

/// Signals an AML check scores. Every field is supplied by the caller; nothing
/// is assumed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AmlSignals {
    /// True when the name matched a sanctions list.
    pub sanctions_hit: bool,
    /// True for a politically exposed person.
    pub pep: bool,
    /// Jurisdiction risk from 0 (low) to 10 (high).
    pub jurisdiction_risk: u8,
    /// The transaction or account value being assessed.
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KycError {
    EmptyUser,
    EmptyReviewer,
    EmptyReason,
    NoDocuments,
    NoOpenRequest(String),
    AlreadyVerified(KycLevel),
    UnknownUser(String),
    InvalidAmount(f64),
    InvalidJurisdictionRisk(u8),
}

impl std::fmt::Display for KycError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KycError::EmptyUser => write!(f, "user id must not be empty"),
            KycError::EmptyReviewer => write!(f, "reviewer id must not be empty"),
            KycError::EmptyReason => write!(f, "a rejection needs a reason"),
            KycError::NoDocuments => write!(f, "a submission needs at least one document"),
            KycError::NoOpenRequest(u) => write!(f, "user {u} has no open KYC request"),
            KycError::AlreadyVerified(l) => write!(f, "user is already verified at {l:?}"),
            KycError::UnknownUser(u) => write!(f, "unknown user: {u}"),
            KycError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            KycError::InvalidJurisdictionRisk(r) => {
                write!(f, "jurisdiction risk {r} must be within 0..=10")
            }
        }
    }
}

impl std::error::Error for KycError {}

pub struct KycAmlService {
    users: RwLock<HashMap<String, UserKyc>>,
    aml_checks: RwLock<HashMap<String, AmlCheck>>,
    /// Score at or above which a check is flagged.
    risk_threshold: i32,
    next_id: AtomicU64,
}

impl KycAmlService {
    pub fn new(risk_threshold: i32) -> Self {
        Self {
            users: RwLock::new(HashMap::new()),
            aml_checks: RwLock::new(HashMap::new()),
            risk_threshold,
            next_id: AtomicU64::new(1),
        }
    }

    /// Open a KYC request. The user starts unverified; the level is only
    /// granted by a reviewer.
    pub async fn submit_kyc(
        &self,
        user_id: &str,
        requested_level: KycLevel,
        documents: Vec<String>,
    ) -> Result<UserKyc, KycError> {
        if user_id.trim().is_empty() {
            return Err(KycError::EmptyUser);
        }
        if documents.is_empty() || documents.iter().any(|d| d.trim().is_empty()) {
            return Err(KycError::NoDocuments);
        }

        let mut users = self.users.write().await;
        let entry = users.entry(user_id.to_string()).or_insert_with(|| UserKyc {
            user_id: user_id.to_string(),
            level: KycLevel::Unverified,
            requested_level: None,
            status: KycStatus::NotStarted,
            documents: Vec::new(),
            rejection_reason: None,
        });

        entry.requested_level = Some(requested_level);
        entry.status = KycStatus::Pending;
        entry.documents = documents;
        entry.rejection_reason = None;
        Ok(entry.clone())
    }

    /// A reviewer moves an open request into review.
    pub async fn start_review(
        &self,
        reviewer_id: &str,
        user_id: &str,
    ) -> Result<UserKyc, KycError> {
        if reviewer_id.trim().is_empty() {
            return Err(KycError::EmptyReviewer);
        }
        let mut users = self.users.write().await;
        let entry = users
            .get_mut(user_id)
            .ok_or_else(|| KycError::UnknownUser(user_id.to_string()))?;
        if entry.requested_level.is_none() || entry.status != KycStatus::Pending {
            return Err(KycError::NoOpenRequest(user_id.to_string()));
        }
        entry.status = KycStatus::InReview;
        Ok(entry.clone())
    }

    /// A reviewer verifies the open request at the requested level.
    ///
    /// The user's level only ever moves up, and only here.
    pub async fn approve(&self, reviewer_id: &str, user_id: &str) -> Result<UserKyc, KycError> {
        if reviewer_id.trim().is_empty() {
            return Err(KycError::EmptyReviewer);
        }
        let mut users = self.users.write().await;
        let entry = users
            .get_mut(user_id)
            .ok_or_else(|| KycError::UnknownUser(user_id.to_string()))?;

        let requested = match entry.status {
            KycStatus::InReview | KycStatus::Pending => entry
                .requested_level
                .ok_or_else(|| KycError::NoOpenRequest(user_id.to_string()))?,
            _ => return Err(KycError::NoOpenRequest(user_id.to_string())),
        };

        if requested as u8 <= entry.level as u8 && entry.status == KycStatus::Verified {
            return Err(KycError::AlreadyVerified(entry.level));
        }

        entry.level = requested;
        entry.status = KycStatus::Verified;
        entry.requested_level = None;
        Ok(entry.clone())
    }

    /// A reviewer rejects the open request with a reason.
    pub async fn reject(
        &self,
        reviewer_id: &str,
        user_id: &str,
        reason: &str,
    ) -> Result<UserKyc, KycError> {
        if reviewer_id.trim().is_empty() {
            return Err(KycError::EmptyReviewer);
        }
        if reason.trim().is_empty() {
            return Err(KycError::EmptyReason);
        }
        let mut users = self.users.write().await;
        let entry = users
            .get_mut(user_id)
            .ok_or_else(|| KycError::UnknownUser(user_id.to_string()))?;
        if entry.requested_level.is_none() {
            return Err(KycError::NoOpenRequest(user_id.to_string()));
        }
        entry.status = KycStatus::Rejected;
        entry.requested_level = None;
        entry.rejection_reason = Some(reason.to_string());
        Ok(entry.clone())
    }

    pub async fn kyc(&self, user_id: &str) -> Option<UserKyc> {
        self.users.read().await.get(user_id).cloned()
    }

    /// The withdrawal limit for a user's verified level.
    pub async fn withdrawal_limit(&self, user_id: &str) -> f64 {
        self.users
            .read()
            .await
            .get(user_id)
            .map(|u| u.level.withdrawal_limit())
            .unwrap_or(KycLevel::Unverified.withdrawal_limit())
    }

    /// Score an AML check from the supplied signals.
    ///
    /// A sanctions hit fails the check outright. Otherwise the score is the
    /// sum of the jurisdiction risk, a PEP penalty and an amount penalty; a
    /// score at or above the threshold is flagged.
    pub async fn run_aml_check(
        &self,
        user_id: &str,
        signals: &AmlSignals,
    ) -> Result<AmlCheck, KycError> {
        if user_id.trim().is_empty() {
            return Err(KycError::EmptyUser);
        }
        if !signals.amount.is_finite() || signals.amount <= 0.0 {
            return Err(KycError::InvalidAmount(signals.amount));
        }
        if signals.jurisdiction_risk > 10 {
            return Err(KycError::InvalidJurisdictionRisk(signals.jurisdiction_risk));
        }

        let mut score = i32::from(signals.jurisdiction_risk) * 5;
        if signals.pep {
            score += 30;
        }
        // Larger amounts carry more risk; 1 point per 10,000 units.
        score += (signals.amount / 10_000.0).floor().min(20.0) as i32;

        let status = if signals.sanctions_hit {
            AmlStatus::Failed
        } else if score >= self.risk_threshold {
            AmlStatus::Flagged
        } else {
            AmlStatus::Passed
        };

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let check = AmlCheck {
            check_id: format!("AML-{id:010}"),
            user_id: user_id.to_string(),
            risk_score: score,
            status,
        };
        self.aml_checks
            .write()
            .await
            .insert(check.check_id.clone(), check.clone());
        Ok(check)
    }

    pub async fn aml_check(&self, check_id: &str) -> Option<AmlCheck> {
        self.aml_checks.read().await.get(check_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn verification_requires_a_reviewer_decision() {
        let svc = KycAmlService::new(50);

        let submitted = svc
            .submit_kyc("alice", KycLevel::Intermediate, vec!["passport".to_string()])
            .await
            .unwrap();
        // The old implementation granted Premium/Verified with no review.
        assert_eq!(submitted.status, KycStatus::Pending);
        assert_eq!(submitted.level, KycLevel::Unverified);
        assert_eq!(svc.withdrawal_limit("alice").await, 10_000.0);

        let reviewed = svc.start_review("reviewer-1", "alice").await.unwrap();
        assert_eq!(reviewed.status, KycStatus::InReview);

        let verified = svc.approve("reviewer-1", "alice").await.unwrap();
        assert_eq!(verified.status, KycStatus::Verified);
        assert_eq!(verified.level, KycLevel::Intermediate);
        assert_eq!(svc.withdrawal_limit("alice").await, 1_000_000.0);
    }

    #[tokio::test]
    async fn rejection_keeps_the_user_unverified_and_records_a_reason() {
        let svc = KycAmlService::new(50);
        svc.submit_kyc("alice", KycLevel::Basic, vec!["id".to_string()])
            .await
            .unwrap();

        let rejected = svc.reject("reviewer-1", "alice", "blurry document").await.unwrap();
        assert_eq!(rejected.status, KycStatus::Rejected);
        assert_eq!(rejected.level, KycLevel::Unverified);
        assert_eq!(rejected.rejection_reason.as_deref(), Some("blurry document"));
        assert_eq!(svc.withdrawal_limit("alice").await, 10_000.0);
    }

    #[tokio::test]
    async fn a_request_cannot_be_approved_without_a_submission() {
        let svc = KycAmlService::new(50);
        assert!(svc.approve("reviewer-1", "nobody").await.is_err());

        svc.submit_kyc("alice", KycLevel::Basic, vec!["id".to_string()])
            .await
            .unwrap();
        svc.reject("reviewer-1", "alice", "no good").await.unwrap();
        // After rejection there is no open request to approve.
        assert!(matches!(
            svc.approve("reviewer-1", "alice").await.unwrap_err(),
            KycError::NoOpenRequest(_)
        ));
    }

    #[tokio::test]
    async fn submissions_are_validated() {
        let svc = KycAmlService::new(50);
        assert!(svc.submit_kyc("", KycLevel::Basic, vec!["id".to_string()]).await.is_err());
        assert!(svc.submit_kyc("alice", KycLevel::Basic, vec![]).await.is_err());
        assert!(svc.submit_kyc("alice", KycLevel::Basic, vec!["".to_string()]).await.is_err());
        assert!(svc.start_review("", "alice").await.is_err());
        assert!(svc.reject("r", "alice", "").await.is_err());
    }

    #[tokio::test]
    async fn aml_scores_reflect_the_signals() {
        let svc = KycAmlService::new(50);

        let clean = svc
            .run_aml_check(
                "alice",
                &AmlSignals {
                    sanctions_hit: false,
                    pep: false,
                    jurisdiction_risk: 1,
                    amount: 5_000.0,
                },
            )
            .await
            .unwrap();
        // The old implementation always returned 15 / Passed.
        assert_eq!(clean.risk_score, 5);
        assert_eq!(clean.status, AmlStatus::Passed);

        let flagged = svc
            .run_aml_check(
                "bob",
                &AmlSignals {
                    sanctions_hit: false,
                    pep: true,
                    jurisdiction_risk: 6,
                    amount: 500_000.0,
                },
            )
            .await
            .unwrap();
        assert!(flagged.risk_score >= 50);
        assert_eq!(flagged.status, AmlStatus::Flagged);

        let sanctioned = svc
            .run_aml_check(
                "carol",
                &AmlSignals {
                    sanctions_hit: true,
                    pep: false,
                    jurisdiction_risk: 0,
                    amount: 100.0,
                },
            )
            .await
            .unwrap();
        assert_eq!(sanctioned.status, AmlStatus::Failed);
    }

    #[tokio::test]
    async fn aml_check_ids_are_unique() {
        let svc = KycAmlService::new(50);
        let signals = AmlSignals {
            sanctions_hit: false,
            pep: false,
            jurisdiction_risk: 0,
            amount: 1_000.0,
        };
        let a = svc.run_aml_check("alice", &signals).await.unwrap();
        let b = svc.run_aml_check("alice", &signals).await.unwrap();

        // The old ids came from the millisecond clock and collided.
        assert_ne!(a.check_id, b.check_id);
        assert!(svc.aml_check(&a.check_id).await.is_some());
        assert!(svc.aml_check(&b.check_id).await.is_some());
    }

    #[tokio::test]
    async fn invalid_aml_inputs_are_rejected() {
        let svc = KycAmlService::new(50);
        let bad_amount = AmlSignals {
            sanctions_hit: false,
            pep: false,
            jurisdiction_risk: 0,
            amount: -1.0,
        };
        assert!(svc.run_aml_check("alice", &bad_amount).await.is_err());

        let bad_risk = AmlSignals {
            sanctions_hit: false,
            pep: false,
            jurisdiction_risk: 11,
            amount: 100.0,
        };
        assert!(svc.run_aml_check("alice", &bad_risk).await.is_err());
    }
}
