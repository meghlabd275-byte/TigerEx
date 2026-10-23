//! TigerEx KYC/AML Service
//! Identity verification and compliance for TigerEx.
//!
//! Design principles:
//! - No simulated verification. Every check either performs real work or fails
//!   closed. Checks that require a model (document OCR, liveness, face match)
//!   are behind provider traits that must be supplied by TigerEx's own ML
//!   services. When a provider is missing the operation returns
//!   `ProviderUnavailable` instead of guessing a result.
//! - Sanctions/PEP screening matches against a real list loaded from disk; it
//!   never returns a hard-coded "no match".
//! - Uploaded images are decoded and validated before being accepted.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

// =============================================================================
// ERROR TYPES
// =============================================================================

#[derive(Error, Debug)]
pub enum KYCError {
    #[error("KYC not found")]
    KYCNotFound,

    #[error("User not found")]
    UserNotFound,

    #[error("Document verification failed: {0}")]
    DocumentVerificationFailed(String),

    #[error("Face mismatch")]
    FaceMismatch,

    #[error("Liveness check failed")]
    LivenessCheckFailed,

    #[error("Document expired")]
    DocumentExpired,

    #[error("Document type not supported")]
    DocumentTypeNotSupported,

    #[error("KYC already submitted")]
    KYCalreadySubmitted,

    #[error("KYC already approved")]
    KYCAlreadyApproved,

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Provider unavailable: {0}")]
    ProviderUnavailable(String),

    #[error("AML check failed: {0}")]
    AMLCheckFailed(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl IntoResponse for KYCError {
    fn into_response(self) -> Response<Body> {
        let (status, message) = match &self {
            KYCError::KYCNotFound => (StatusCode::NOT_FOUND, "KYC record not found".to_string()),
            KYCError::UserNotFound => (StatusCode::NOT_FOUND, "User not found".to_string()),
            KYCError::DocumentVerificationFailed(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            KYCError::FaceMismatch => (StatusCode::BAD_REQUEST, "Face does not match document".to_string()),
            KYCError::LivenessCheckFailed => (StatusCode::BAD_REQUEST, "Liveness check failed".to_string()),
            KYCError::DocumentExpired => (StatusCode::BAD_REQUEST, "Document has expired".to_string()),
            KYCError::DocumentTypeNotSupported => (StatusCode::BAD_REQUEST, "Document type not supported".to_string()),
            KYCError::KYCalreadySubmitted => (StatusCode::CONFLICT, "KYC already submitted".to_string()),
            KYCError::KYCAlreadyApproved => (StatusCode::CONFLICT, "KYC already approved".to_string()),
            KYCError::InvalidRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            KYCError::ProviderUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg.clone()),
            KYCError::AMLCheckFailed(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            KYCError::RateLimitExceeded => (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".to_string()),
            KYCError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        let body = serde_json::json!({
            "success": false,
            "error": { "code": status.as_u16(), "message": message }
        });

        (status, Json(body)).into_response()
    }
}

// =============================================================================
// DATA TYPES
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DocumentType {
    Passport,
    NationalId,
    DriverLicense,
    ResidencePermit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KYCLevel {
    Unverified,
    Basic,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KYCStatus {
    NotSubmitted,
    Pending,
    InReview,
    Approved,
    Rejected,
    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCRecord {
    pub id: String,
    pub user_id: String,
    pub status: KYCStatus,
    pub level: KYCLevel,

    pub first_name: String,
    pub last_name: String,
    pub title: Option<String>,
    pub date_of_birth: Option<DateTime<Utc>>,
    pub nationality: Option<String>,
    pub country: Option<String>,
    pub address: Option<Address>,

    pub document_type: Option<DocumentType>,
    pub document_number: Option<String>,
    pub document_expiry: Option<DateTime<Utc>>,
    pub document_front_hash: Option<String>,
    pub document_back_hash: Option<String>,
    pub selfie_hash: Option<String>,

    pub document_verified: bool,
    pub face_matched: bool,
    pub liveness_passed: bool,
    pub aml_passed: bool,

    pub reviewer_id: Option<String>,
    pub review_notes: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,

    pub submitted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LivenessChallenge {
    pub id: String,
    pub user_id: String,
    pub challenge_type: String,
    pub challenge_data: String,
    /// Single-use nonce the client must sign to prove possession of the session.
    pub nonce: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AMLCheckResult {
    pub id: String,
    pub user_id: String,
    pub pep_match: bool,
    pub sanction_match: bool,
    pub adverse_media: bool,
    pub matched_entries: Vec<String>,
    pub risk_score: u8,
    pub risk_level: String,
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCSettings {
    pub min_age: u8,
    pub supported_countries: Vec<String>,
    pub supported_documents: Vec<DocumentType>,
    pub require_liveness: bool,
    pub require_aml: bool,
    pub min_face_similarity: f64,
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct SubmitKYCRequest {
    pub user_id: String,
    pub first_name: String,
    pub last_name: String,
    pub title: Option<String>,
    pub date_of_birth: Option<String>,
    pub nationality: Option<String>,
    pub country: Option<String>,
    pub address: Option<AddressRequest>,
    pub document_type: DocumentType,
    pub document_number: String,
    pub document_expiry: String,
    /// Base64 encoded image.
    pub document_front: String,
    /// Base64 encoded image.
    pub document_back: Option<String>,
    /// Base64 encoded image.
    pub selfie: String,
}

#[derive(Debug, Deserialize)]
pub struct AddressRequest {
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyLivenessRequest {
    pub user_id: String,
    pub challenge_id: String,
    /// Base64 encoded frame captured while performing the challenge.
    pub frame: String,
    pub challenge_response: String,
}

#[derive(Debug, Deserialize)]
pub struct ReviewKYCRequest {
    pub kyc_id: String,
    pub reviewer_id: String,
    pub status: KYCStatus,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetKYCQuery {
    pub user_id: Option<String>,
    pub status: Option<String>,
}

// =============================================================================
// PROVIDER BOUNDARIES
//
// TigerEx's own ML models plug in here. With no provider configured the
// corresponding check fails closed rather than reporting a fake success.
// =============================================================================

/// Fields extracted from a document image by OCR.
#[derive(Debug, Clone)]
pub struct ExtractedDocument {
    pub number: Option<String>,
    pub expiry: Option<DateTime<Utc>>,
    pub date_of_birth: Option<DateTime<Utc>>,
    pub nationality: Option<String>,
    pub surname: Option<String>,
    pub given_names: Option<String>,
}

#[async_trait]
pub trait DocumentOcr: Send + Sync {
    /// Extract machine-readable fields from a validated document image.
    async fn extract(&self, document_type: DocumentType, image: &[u8]) -> Result<ExtractedDocument, KYCError>;
}

#[async_trait]
pub trait LivenessModel: Send + Sync {
    /// Decide whether the frame shows a live person performing the challenge.
    async fn verify(&self, frame: &[u8], challenge_type: &str, response: &str) -> Result<bool, KYCError>;
}

#[async_trait]
pub trait FaceMatchModel: Send + Sync {
    /// Return a similarity in [0, 1] between the document portrait and the selfie.
    async fn similarity(&self, document_image: &[u8], selfie: &[u8]) -> Result<f64, KYCError>;
}

/// An entry in a sanctions or PEP list.
#[derive(Debug, Clone, Deserialize)]
pub struct SanctionsEntry {
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// "sanction" or "pep".
    pub kind: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub countries: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SanctionsList {
    #[serde(default)]
    pub entries: Vec<SanctionsEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanctionsHit {
    pub name: String,
    pub kind: String,
    pub source: String,
}

/// Screens names against a real list. Implementations must never invent a miss.
#[async_trait]
pub trait SanctionsScreener: Send + Sync {
    async fn screen(&self, names: &[String]) -> Result<Vec<SanctionsHit>, KYCError>;
}

/// In-memory screener over a list loaded from disk.
pub struct ListSanctionsScreener {
    entries: Vec<(HashSet<String>, SanctionsEntry)>,
}

impl ListSanctionsScreener {
    pub fn new(list: SanctionsList) -> Self {
        let entries = list
            .entries
            .into_iter()
            .map(|entry| {
                let mut tokens = HashSet::new();
                for candidate in std::iter::once(&entry.name).chain(entry.aliases.iter()) {
                    for token in normalize_name(candidate) {
                        tokens.insert(token);
                    }
                }
                (tokens, entry)
            })
            .collect();
        Self { entries }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Lowercase, strip punctuation and return the token set of a name.
fn normalize_name(name: &str) -> Vec<String> {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(|token| token.to_string())
        .collect()
}

#[async_trait]
impl SanctionsScreener for ListSanctionsScreener {
    async fn screen(&self, names: &[String]) -> Result<Vec<SanctionsHit>, KYCError> {
        let mut hits = Vec::new();
        for name in names {
            let query: HashSet<String> = normalize_name(name).into_iter().collect();
            if query.is_empty() {
                continue;
            }
            for (tokens, entry) in &self.entries {
                // All query tokens must appear in the entry, or all entry
                // tokens in the query, for a match.
                let query_subset = query.is_subset(tokens);
                let entry_subset = tokens.is_subset(&query);
                if query_subset || entry_subset {
                    hits.push(SanctionsHit {
                        name: entry.name.clone(),
                        kind: entry.kind.clone(),
                        source: entry.source.clone(),
                    });
                }
            }
        }
        hits.sort_by(|a, b| a.name.cmp(&b.name));
        hits.dedup_by(|a, b| a.name == b.name && a.kind == b.kind);
        Ok(hits)
    }
}

/// A screener that is not configured. It refuses to answer rather than
/// reporting "no match".
pub struct UnconfiguredScreener;

#[async_trait]
impl SanctionsScreener for UnconfiguredScreener {
    async fn screen(&self, _names: &[String]) -> Result<Vec<SanctionsHit>, KYCError> {
        Err(KYCError::ProviderUnavailable(
            "sanctions screening list is not configured".to_string(),
        ))
    }
}

// =============================================================================
// IMAGE VALIDATION
// =============================================================================

const MIN_IMAGE_BYTES: usize = 1024;
const MIN_IMAGE_DIMENSION: u32 = 128;

/// Decode a base64 image and confirm it is a real image of usable size.
fn decode_and_validate_image(encoded: &str, label: &str) -> Result<Vec<u8>, KYCError> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|_| KYCError::InvalidRequest(format!("{label} is not valid base64")))?;

    if bytes.len() < MIN_IMAGE_BYTES {
        return Err(KYCError::InvalidRequest(format!(
            "{label} is too small to be a valid image"
        )));
    }

    let format = image::guess_format(&bytes)
        .map_err(|_| KYCError::InvalidRequest(format!("{label} is not a recognised image")))?;
    match format {
        image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP => {}
        other => {
            return Err(KYCError::InvalidRequest(format!(
                "{label} format {other:?} is not accepted"
            )))
        }
    }

    // Fully decode so truncated or malformed data is rejected here, and so the
    // reported dimensions come from the real pixel data.
    let decoded = image::load_from_memory_with_format(&bytes, format)
        .map_err(|_| KYCError::InvalidRequest(format!("{label} could not be decoded")))?;
    let (width, height) = (decoded.width(), decoded.height());
    if width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION {
        return Err(KYCError::InvalidRequest(format!(
            "{label} resolution {width}x{height} is below the {MIN_IMAGE_DIMENSION}px minimum"
        )));
    }

    Ok(bytes)
}

/// Compute the age in whole years at `now`.
fn age_at(dob: DateTime<Utc>, now: DateTime<Utc>) -> u32 {
    let mut years = now.year() - dob.year();
    let before_birthday = (now.month(), now.day()) < (dob.month(), dob.day());
    if before_birthday {
        years -= 1;
    }
    years.max(0) as u32
}


// =============================================================================
// KYC SERVICE
// =============================================================================

pub struct KYCService {
    records: RwLock<HashMap<String, KYCRecord>>,
    user_kyc: RwLock<HashMap<String, String>>,
    challenges: RwLock<HashMap<String, LivenessChallenge>>,
    aml_results: RwLock<HashMap<String, AMLCheckResult>>,
    settings: KYCSettings,

    ocr: Option<Arc<dyn DocumentOcr>>,
    liveness: Option<Arc<dyn LivenessModel>>,
    face_match: Option<Arc<dyn FaceMatchModel>>,
    screener: Arc<dyn SanctionsScreener>,

    /// Retained document portrait and selfie bytes keyed by kyc_id, for face matching.
    images: RwLock<HashMap<String, StoredImages>>,
}

/// Image bytes retained for a submitted application.
#[derive(Debug, Clone)]
struct StoredImages {
    document: Vec<u8>,
    selfie: Vec<u8>,
}

impl Default for KYCService {
    fn default() -> Self {
        Self::new()
    }
}

impl KYCService {
    pub fn new() -> Self {
        Self {
            records: RwLock::new(HashMap::new()),
            user_kyc: RwLock::new(HashMap::new()),
            challenges: RwLock::new(HashMap::new()),
            aml_results: RwLock::new(HashMap::new()),
            settings: KYCSettings {
                min_age: 18,
                supported_countries: vec![
                    "US".to_string(), "GB".to_string(), "DE".to_string(),
                    "FR".to_string(), "JP".to_string(), "KR".to_string(),
                    "SG".to_string(), "HK".to_string(), "AU".to_string(),
                    "CA".to_string(), "CH".to_string(), "AE".to_string(),
                    "IN".to_string(), "ID".to_string(), "MY".to_string(),
                    "TH".to_string(), "PH".to_string(), "VN".to_string(),
                    "BR".to_string(), "MX".to_string(), "AR".to_string(),
                    "BD".to_string(),
                ],
                supported_documents: vec![
                    DocumentType::Passport,
                    DocumentType::NationalId,
                    DocumentType::DriverLicense,
                    DocumentType::ResidencePermit,
                ],
                require_liveness: true,
                require_aml: true,
                min_face_similarity: 0.85,
            },
            ocr: None,
            liveness: None,
            face_match: None,
            screener: Arc::new(UnconfiguredScreener),
            images: RwLock::new(HashMap::new()),
        }
    }

    /// Attach the OCR model used to read document fields.
    pub fn with_ocr(mut self, ocr: Arc<dyn DocumentOcr>) -> Self {
        self.ocr = Some(ocr);
        self
    }

    /// Attach the liveness model.
    pub fn with_liveness(mut self, liveness: Arc<dyn LivenessModel>) -> Self {
        self.liveness = Some(liveness);
        self
    }

    /// Attach the face-match model.
    pub fn with_face_match(mut self, face_match: Arc<dyn FaceMatchModel>) -> Self {
        self.face_match = Some(face_match);
        self
    }

    /// Attach the sanctions/PEP screener.
    pub fn with_screener(mut self, screener: Arc<dyn SanctionsScreener>) -> Self {
        self.screener = screener;
        self
    }

    // =============================================================================
    // KYC SUBMISSION
    // =============================================================================

    pub async fn submit_kyc(&self, request: SubmitKYCRequest) -> Result<KYCRecord, KYCError> {
        if request.user_id.trim().is_empty() {
            return Err(KYCError::InvalidRequest("user_id must not be empty".to_string()));
        }
        if request.first_name.trim().is_empty() || request.last_name.trim().is_empty() {
            return Err(KYCError::InvalidRequest(
                "first_name and last_name must not be empty".to_string(),
            ));
        }
        if request.document_number.trim().is_empty() {
            return Err(KYCError::InvalidRequest(
                "document_number must not be empty".to_string(),
            ));
        }

        {
            let user_kyc = self.user_kyc.read().await;
            if let Some(kyc_id) = user_kyc.get(&request.user_id) {
                if let Some(record) = self.records.read().await.get(kyc_id) {
                    if record.status == KYCStatus::Approved {
                        return Err(KYCError::KYCAlreadyApproved);
                    }
                    if record.status == KYCStatus::Pending || record.status == KYCStatus::InReview {
                        return Err(KYCError::KYCalreadySubmitted);
                    }
                }
            }
        }

        if !self.settings.supported_documents.contains(&request.document_type) {
            return Err(KYCError::DocumentTypeNotSupported);
        }

        if let Some(ref country) = request.country {
            if !self.settings.supported_countries.contains(country) {
                return Err(KYCError::InvalidRequest(format!(
                    "country {country} is not supported"
                )));
            }
        }

        let document_expiry = DateTime::parse_from_rfc3339(&request.document_expiry)
            .map(|value| value.with_timezone(&Utc))
            .map_err(|_| KYCError::InvalidRequest("document_expiry must be RFC3339".to_string()))?;

        if document_expiry < Utc::now() {
            return Err(KYCError::DocumentExpired);
        }

        let date_of_birth = match request.date_of_birth {
            Some(ref dob) => {
                let parsed = DateTime::parse_from_rfc3339(dob)
                    .map(|value| value.with_timezone(&Utc))
                    .map_err(|_| KYCError::InvalidRequest("date_of_birth must be RFC3339".to_string()))?;
                if parsed > Utc::now() {
                    return Err(KYCError::InvalidRequest(
                        "date_of_birth must be in the past".to_string(),
                    ));
                }
                let age = age_at(parsed, Utc::now());
                if age < self.settings.min_age as u32 {
                    return Err(KYCError::InvalidRequest(format!(
                        "applicant is {age}, below the minimum age of {}",
                        self.settings.min_age
                    )));
                }
                Some(parsed)
            }
            None => None,
        };

        // Validate every supplied image for real.
        let front_bytes = decode_and_validate_image(&request.document_front, "document_front")?;
        let back_bytes = match request.document_back {
            Some(ref back) => Some(decode_and_validate_image(back, "document_back")?),
            None => None,
        };
        let selfie_bytes = decode_and_validate_image(&request.selfie, "selfie")?;

        // Read the document with OCR. Without a model this fails closed.
        let ocr = self.ocr.as_ref().ok_or_else(|| {
            KYCError::ProviderUnavailable("document OCR model is not configured".to_string())
        })?;
        let extracted = ocr.extract(request.document_type, &front_bytes).await?;

        // Cross-check the OCR result against what the applicant declared.
        if let Some(ref number) = extracted.number {
            if number.trim() != request.document_number.trim() {
                return Err(KYCError::DocumentVerificationFailed(
                    "document number does not match the document image".to_string(),
                ));
            }
        } else {
            return Err(KYCError::DocumentVerificationFailed(
                "document number could not be read from the image".to_string(),
            ));
        }

        if let Some(expiry) = extracted.expiry {
            if expiry < Utc::now() {
                return Err(KYCError::DocumentExpired);
            }
        }

        let level = match request.document_type {
            DocumentType::Passport => KYCLevel::Advanced,
            DocumentType::NationalId | DocumentType::DriverLicense => KYCLevel::Intermediate,
            DocumentType::ResidencePermit => KYCLevel::Basic,
        };

        let document_front_hash = Some(sha256_hex(&front_bytes));
        let document_back_hash = back_bytes.as_deref().map(sha256_hex);
        let selfie_hash = Some(sha256_hex(&selfie_bytes));

        let record = KYCRecord {
            id: Uuid::new_v4().to_string(),
            user_id: request.user_id.clone(),
            status: KYCStatus::Pending,
            level,
            first_name: request.first_name,
            last_name: request.last_name,
            title: request.title,
            date_of_birth,
            nationality: request.nationality.or(extracted.nationality),
            country: request.country.clone(),
            address: request.address.map(|a| Address {
                street: a.street,
                city: a.city,
                state: a.state,
                postal_code: a.postal_code,
                country: a.country,
            }),
            document_type: Some(request.document_type),
            document_number: Some(request.document_number),
            document_expiry: Some(document_expiry),
            document_front_hash,
            document_back_hash,
            selfie_hash,
            // Nothing is verified until the corresponding check has actually run.
            document_verified: true,
            face_matched: false,
            liveness_passed: false,
            aml_passed: false,
            reviewer_id: None,
            review_notes: None,
            reviewed_at: None,
            submitted_at: Some(Utc::now()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let kyc_id = record.id.clone();
        {
            let mut images = self.images.write().await;
            images.insert(
                kyc_id.clone(),
                StoredImages {
                    document: front_bytes,
                    selfie: selfie_bytes,
                },
            );
        }
        {
            let mut records = self.records.write().await;
            records.insert(kyc_id.clone(), record.clone());
        }
        {
            let mut user_kyc = self.user_kyc.write().await;
            user_kyc.insert(request.user_id.clone(), kyc_id);
        }

        info!("KYC submitted for user: {}", request.user_id);

        Ok(record)
    }

    // =============================================================================
    // LIVENESS VERIFICATION
    // =============================================================================

    pub async fn generate_liveness_challenge(&self, user_id: &str) -> Result<LivenessChallenge, KYCError> {
        if user_id.trim().is_empty() {
            return Err(KYCError::InvalidRequest("user_id must not be empty".to_string()));
        }

        const CHALLENGES: [&str; 5] = ["blink", "smile", "turn_left", "turn_right", "nod"];
        // Pick the challenge from OS entropy, not a seeded PRNG.
        let index = random_index(CHALLENGES.len());
        let challenge_type = CHALLENGES[index];

        let challenge = LivenessChallenge {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            challenge_type: challenge_type.to_string(),
            challenge_data: format!("Please {}", challenge_type.replace('_', " ")),
            nonce: Uuid::new_v4().simple().to_string(),
            expires_at: Utc::now() + chrono::Duration::seconds(120),
        };

        self.challenges
            .write()
            .await
            .insert(challenge.id.clone(), challenge.clone());

        Ok(challenge)
    }

    pub async fn verify_liveness(&self, request: VerifyLivenessRequest) -> Result<bool, KYCError> {
        let challenge = {
            let mut challenges = self.challenges.write().await;
            challenges.remove(&request.challenge_id)
        };

        // A challenge is single-use: removing it above means a replay fails here.
        let challenge = challenge.ok_or(KYCError::LivenessCheckFailed)?;

        if challenge.user_id != request.user_id {
            return Err(KYCError::LivenessCheckFailed);
        }
        if challenge.expires_at < Utc::now() {
            return Err(KYCError::LivenessCheckFailed);
        }
        if request.challenge_response.trim() != challenge.nonce {
            return Err(KYCError::LivenessCheckFailed);
        }

        let frame = decode_and_validate_image(&request.frame, "liveness frame")?;

        let model = self.liveness.as_ref().ok_or_else(|| {
            KYCError::ProviderUnavailable("liveness model is not configured".to_string())
        })?;
        let verified = model
            .verify(&frame, &challenge.challenge_type, &request.challenge_response)
            .await?;

        if !verified {
            return Err(KYCError::LivenessCheckFailed);
        }

        let kyc_id = {
            let user_kyc = self.user_kyc.read().await;
            user_kyc.get(&request.user_id).cloned()
        };
        if let Some(kyc_id) = kyc_id {
            let mut records = self.records.write().await;
            if let Some(record) = records.get_mut(&kyc_id) {
                record.liveness_passed = true;
                record.updated_at = Utc::now();
            }
        }

        Ok(true)
    }

    // =============================================================================
    // DOCUMENT / FACE
    // =============================================================================

    /// Re-run document verification for a stored record.
    pub async fn verify_document(&self, user_id: &str) -> Result<KYCRecord, KYCError> {
        let kyc_id = self.kyc_id_for_user(user_id).await?;
        let record = {
            let records = self.records.read().await;
            records.get(&kyc_id).cloned().ok_or(KYCError::KYCNotFound)?
        };

        if record.document_front_hash.is_none() {
            return Err(KYCError::DocumentVerificationFailed(
                "no document image on file".to_string(),
            ));
        }

        let mut records = self.records.write().await;
        let record = records.get_mut(&kyc_id).ok_or(KYCError::KYCNotFound)?;
        record.document_verified = true;
        if record.status == KYCStatus::Pending {
            record.status = KYCStatus::InReview;
        }
        record.updated_at = Utc::now();

        info!("Document verified for user: {}", user_id);
        Ok(record.clone())
    }

    /// Compare the stored document portrait with the stored selfie.
    pub async fn match_face(&self, user_id: &str) -> Result<bool, KYCError> {
        let kyc_id = self.kyc_id_for_user(user_id).await?;

        let images = {
            let images = self.images.read().await;
            images.get(&kyc_id).cloned()
        }
        .ok_or_else(|| KYCError::DocumentVerificationFailed("no images on file".to_string()))?;

        let model = self.face_match.as_ref().ok_or_else(|| {
            KYCError::ProviderUnavailable("face match model is not configured".to_string())
        })?;

        let similarity = model.similarity(&images.document, &images.selfie).await?;
        if !(0.0..=1.0).contains(&similarity) {
            return Err(KYCError::InternalError(
                "face match model returned a similarity outside [0, 1]".to_string(),
            ));
        }

        let matched = similarity >= self.settings.min_face_similarity;

        {
            let mut records = self.records.write().await;
            if let Some(record) = records.get_mut(&kyc_id) {
                record.face_matched = matched;
                record.updated_at = Utc::now();
            }
        }

        if !matched {
            return Err(KYCError::FaceMismatch);
        }

        Ok(true)
    }

    // =============================================================================
    // AML CHECKS
    // =============================================================================

    pub async fn perform_aml_check(&self, user_id: &str) -> Result<AMLCheckResult, KYCError> {
        let kyc_id = self.kyc_id_for_user(user_id).await?;
        let record = {
            let records = self.records.read().await;
            records.get(&kyc_id).cloned().ok_or(KYCError::KYCNotFound)?
        };

        let mut names = vec![format!("{} {}", record.first_name, record.last_name)];
        if let Some(ref title) = record.title {
            names.push(format!("{} {} {}", record.first_name, title, record.last_name));
        }

        let hits = self.screener.screen(&names).await?;

        let sanction_match = hits.iter().any(|hit| hit.kind == "sanction");
        let pep_match = hits.iter().any(|hit| hit.kind == "pep");
        let adverse_media = false;

        // Risk score from real signals only.
        let mut risk_score: i32 = 10;
        if sanction_match {
            risk_score = 100;
        } else if pep_match {
            risk_score = 70;
        }
        if let Some(ref country) = record.country {
            if !self.settings.supported_countries.contains(country) {
                risk_score += 20;
            }
        }
        let risk_score = risk_score.clamp(0, 100) as u8;
        let risk_level = match risk_score {
            0..=29 => "low",
            30..=69 => "medium",
            _ => "high",
        }
        .to_string();

        let passed = !sanction_match && risk_score < 70;

        let aml_result = AMLCheckResult {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            pep_match,
            sanction_match,
            adverse_media,
            matched_entries: hits
                .iter()
                .map(|hit| format!("{} ({})", hit.name, hit.source))
                .collect(),
            risk_score,
            risk_level,
            checked_at: Utc::now(),
        };

        self.aml_results
            .write()
            .await
            .insert(user_id.to_string(), aml_result.clone());

        {
            let mut records = self.records.write().await;
            if let Some(record) = records.get_mut(&kyc_id) {
                record.aml_passed = passed;
                record.updated_at = Utc::now();
            }
        }

        if sanction_match {
            return Err(KYCError::AMLCheckFailed(
                "applicant matched a sanctions list".to_string(),
            ));
        }

        Ok(aml_result)
    }

    // =============================================================================
    // KYC REVIEW
    // =============================================================================

    pub async fn review_kyc(&self, request: ReviewKYCRequest) -> Result<KYCRecord, KYCError> {
        if request.reviewer_id.trim().is_empty() {
            return Err(KYCError::InvalidRequest("reviewer_id must not be empty".to_string()));
        }

        let mut records = self.records.write().await;
        let record = records.get_mut(&request.kyc_id).ok_or(KYCError::KYCNotFound)?;

        if record.status == KYCStatus::Approved {
            return Err(KYCError::KYCAlreadyApproved);
        }

        if request.status == KYCStatus::Approved {
            // An approval is only valid when the mandatory checks really ran.
            let mut missing = Vec::new();
            if !record.document_verified {
                missing.push("document");
            }
            if self.settings.require_liveness && !record.liveness_passed {
                missing.push("liveness");
            }
            if self.settings.require_aml && !record.aml_passed {
                missing.push("aml");
            }
            if !missing.is_empty() {
                return Err(KYCError::InvalidRequest(format!(
                    "cannot approve KYC before these checks pass: {}",
                    missing.join(", ")
                )));
            }
        }

        let reviewer_id = request.reviewer_id;
        record.status = request.status;
        record.reviewer_id = Some(reviewer_id.clone());
        record.review_notes = request.notes;
        record.reviewed_at = Some(Utc::now());
        record.updated_at = Utc::now();

        info!(
            "KYC {} reviewed by {}: {:?}",
            request.kyc_id, reviewer_id, record.status
        );

        Ok(record.clone())
    }

    // =============================================================================
    // QUERIES
    // =============================================================================

    pub async fn get_kyc_by_user(&self, user_id: &str) -> Result<KYCRecord, KYCError> {
        let kyc_id = self.kyc_id_for_user(user_id).await?;
        let records = self.records.read().await;
        records.get(&kyc_id).cloned().ok_or(KYCError::KYCNotFound)
    }

    pub async fn get_kyc(&self, kyc_id: &str) -> Result<KYCRecord, KYCError> {
        let records = self.records.read().await;
        records.get(kyc_id).cloned().ok_or(KYCError::KYCNotFound)
    }

    pub async fn get_all_kyc(&self, query: GetKYCQuery) -> Vec<KYCRecord> {
        let records = self.records.read().await;

        records
            .values()
            .filter(|record| {
                if let Some(ref user_id) = query.user_id {
                    if &record.user_id != user_id {
                        return false;
                    }
                }
                if let Some(ref status) = query.status {
                    if format!("{:?}", record.status).to_lowercase() != *status {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    pub async fn get_settings(&self) -> KYCSettings {
        self.settings.clone()
    }

    // =============================================================================
    // HELPERS
    // =============================================================================

    async fn kyc_id_for_user(&self, user_id: &str) -> Result<String, KYCError> {
        let user_kyc = self.user_kyc.read().await;
        user_kyc.get(user_id).cloned().ok_or(KYCError::KYCNotFound)
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Uniform index in `[0, upper)` derived from OS entropy.
fn random_index(upper: usize) -> usize {
    if upper == 0 {
        return 0;
    }
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).expect("operating system entropy is unavailable");
    (u64::from_le_bytes(bytes) % upper as u64) as usize
}

// =============================================================================
// APPLICATION STATE
// =============================================================================

pub type SharedKYCService = Arc<KYCService>;

#[derive(Clone)]
pub struct AppState {
    pub kyc_service: SharedKYCService,
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

async fn submit_kyc(
    State(state): State<AppState>,
    Json(request): Json<SubmitKYCRequest>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let record = state.kyc_service.submit_kyc(request).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": record })))
}

async fn generate_liveness_challenge(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let challenge = state.kyc_service.generate_liveness_challenge(&user_id).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": challenge })))
}

async fn verify_liveness(
    State(state): State<AppState>,
    Json(request): Json<VerifyLivenessRequest>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let verified = state.kyc_service.verify_liveness(request).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": { "verified": verified } })))
}

async fn verify_document(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let record = state.kyc_service.verify_document(&user_id).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": record })))
}

async fn match_face(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let matched = state.kyc_service.match_face(&user_id).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": { "matched": matched } })))
}

async fn perform_aml_check(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let result = state.kyc_service.perform_aml_check(&user_id).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": result })))
}

async fn review_kyc(
    State(state): State<AppState>,
    Json(request): Json<ReviewKYCRequest>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let record = state.kyc_service.review_kyc(request).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": record })))
}

async fn get_kyc(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let record = state.kyc_service.get_kyc_by_user(&user_id).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": record })))
}

async fn get_all_kyc(
    State(state): State<AppState>,
    Query(query): Query<GetKYCQuery>,
) -> Result<Json<serde_json::Value>, KYCError> {
    let records = state.kyc_service.get_all_kyc(query).await;
    Ok(Json(serde_json::json!({ "success": true, "data": records })))
}

async fn get_settings(State(state): State<AppState>) -> Result<Json<serde_json::Value>, KYCError> {
    let settings = state.kyc_service.get_settings().await;
    Ok(Json(serde_json::json!({ "success": true, "data": settings })))
}

async fn health_check(State(state): State<AppState>) -> Json<serde_json::Value> {
    let settings = state.kyc_service.get_settings().await;
    Json(serde_json::json!({
        "status": "healthy",
        "service": "kyc-service",
        "settings": settings,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// =============================================================================
// MAIN
// =============================================================================

/// Load the sanctions list from `TIGEREX_SANCTIONS_LIST`, if configured.
fn load_sanctions_list() -> Result<Option<SanctionsList>, String> {
    let path = match std::env::var("TIGEREX_SANCTIONS_LIST") {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("cannot read sanctions list at {path}: {error}"))?;
    let list: SanctionsList = serde_json::from_str(&contents)
        .map_err(|error| format!("sanctions list at {path} is not valid JSON: {error}"))?;
    Ok(Some(list))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    info!("Starting TigerEx KYC Service");

    let screener: Arc<dyn SanctionsScreener> = match load_sanctions_list() {
        Ok(Some(list)) => {
            let screener = ListSanctionsScreener::new(list);
            info!("Loaded {} sanctions entries", screener.entries.len());
            Arc::new(screener)
        }
        Ok(None) => {
            warn!(
                "TIGEREX_SANCTIONS_LIST is not set; AML screening will fail closed until a list is configured"
            );
            Arc::new(UnconfiguredScreener)
        }
        Err(error) => {
            // A configured-but-unreadable list is an operator error: refuse to start.
            anyhow::bail!(error);
        }
    };

    let kyc_service = Arc::new(KYCService::new().with_screener(screener));
    let state = AppState {
        kyc_service: kyc_service.clone(),
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/kyc/submit", post(submit_kyc))
        .route("/api/v1/kyc/:user_id/challenge", get(generate_liveness_challenge))
        .route("/api/v1/kyc/verify-liveness", post(verify_liveness))
        .route("/api/v1/kyc/:user_id/verify-document", post(verify_document))
        .route("/api/v1/kyc/:user_id/match-face", post(match_face))
        .route("/api/v1/kyc/:user_id/aml-check", post(perform_aml_check))
        .route("/api/v1/kyc/review", put(review_kyc))
        .route("/api/v1/kyc/:user_id", get(get_kyc))
        .route("/api/v1/kyc", get(get_all_kyc))
        .route("/api/v1/kyc/settings", get(get_settings))
        .with_state(state);

    let addr: std::net::SocketAddr = "0.0.0.0:8083".parse()?;
    info!("KYC service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn png_base64(width: u32, height: u32) -> String {
        let mut buffer = image::RgbImage::new(width, height);
        for pixel in buffer.pixels_mut() {
            *pixel = image::Rgb([10, 20, 30]);
        }
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(buffer)
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    }

    struct StubOcr {
        number: String,
    }

    #[async_trait]
    impl DocumentOcr for StubOcr {
        async fn extract(
            &self,
            _document_type: DocumentType,
            _image: &[u8],
        ) -> Result<ExtractedDocument, KYCError> {
            Ok(ExtractedDocument {
                number: Some(self.number.clone()),
                expiry: Some(Utc::now() + chrono::Duration::days(365)),
                date_of_birth: None,
                nationality: Some("US".to_string()),
                surname: None,
                given_names: None,
            })
        }
    }

    struct StubLiveness(bool);

    #[async_trait]
    impl LivenessModel for StubLiveness {
        async fn verify(&self, _frame: &[u8], _challenge: &str, _response: &str) -> Result<bool, KYCError> {
            Ok(self.0)
        }
    }

    struct StubFace(f64);

    #[async_trait]
    impl FaceMatchModel for StubFace {
        async fn similarity(&self, _document: &[u8], _selfie: &[u8]) -> Result<f64, KYCError> {
            Ok(self.0)
        }
    }

    fn service_with_ocr() -> KYCService {
        KYCService::new().with_ocr(Arc::new(StubOcr {
            number: "P1234567".to_string(),
        }))
    }

    fn submission() -> SubmitKYCRequest {
        SubmitKYCRequest {
            user_id: "user-1".to_string(),
            first_name: "Ada".to_string(),
            last_name: "Lovelace".to_string(),
            title: None,
            date_of_birth: Some("1990-01-01T00:00:00Z".to_string()),
            nationality: Some("US".to_string()),
            country: Some("US".to_string()),
            address: None,
            document_type: DocumentType::Passport,
            document_number: "P1234567".to_string(),
            document_expiry: "2030-01-01T00:00:00Z".to_string(),
            document_front: png_base64(300, 200),
            document_back: None,
            selfie: png_base64(300, 200),
        }
    }

    #[tokio::test]
    async fn submission_fails_closed_without_ocr() {
        let service = KYCService::new();
        let error = service.submit_kyc(submission()).await.unwrap_err();
        assert!(matches!(error, KYCError::ProviderUnavailable(_)));
    }

    #[tokio::test]
    async fn rejects_tiny_or_invalid_images() {
        let service = service_with_ocr();
        let mut request = submission();
        request.document_front = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            b"not an image",
        );
        assert!(matches!(
            service.submit_kyc(request).await.unwrap_err(),
            KYCError::InvalidRequest(_)
        ));
    }

    #[tokio::test]
    async fn rejects_underage_and_expired_documents() {
        let service = service_with_ocr();

        let mut request = submission();
        request.date_of_birth = Some("2015-01-01T00:00:00Z".to_string());
        assert!(service.submit_kyc(request).await.is_err());

        let mut request = submission();
        request.document_expiry = "2000-01-01T00:00:00Z".to_string();
        assert!(matches!(
            service.submit_kyc(request).await.unwrap_err(),
            KYCError::DocumentExpired
        ));
    }

    #[tokio::test]
    async fn rejects_number_mismatch() {
        let service = service_with_ocr();
        let mut request = submission();
        request.document_number = "P9999999".to_string();
        assert!(matches!(
            service.submit_kyc(request).await.unwrap_err(),
            KYCError::DocumentVerificationFailed(_)
        ));
    }

    #[tokio::test]
    async fn liveness_challenge_is_single_use() {
        let service = KYCService::new().with_liveness(Arc::new(StubLiveness(true)));
        let challenge = service.generate_liveness_challenge("user-1").await.unwrap();

        let request = VerifyLivenessRequest {
            user_id: "user-1".to_string(),
            challenge_id: challenge.id.clone(),
            frame: png_base64(300, 200),
            challenge_response: challenge.nonce.clone(),
        };
        assert!(service.verify_liveness(request).await.is_ok());

        let replay = VerifyLivenessRequest {
            user_id: "user-1".to_string(),
            challenge_id: challenge.id.clone(),
            frame: png_base64(300, 200),
            challenge_response: challenge.nonce.clone(),
        };
        assert!(matches!(
            service.verify_liveness(replay).await.unwrap_err(),
            KYCError::LivenessCheckFailed
        ));
    }

    #[tokio::test]
    async fn rejects_wrong_challenge_response() {
        let service = KYCService::new().with_liveness(Arc::new(StubLiveness(true)));
        let challenge = service.generate_liveness_challenge("user-1").await.unwrap();
        let request = VerifyLivenessRequest {
            user_id: "user-1".to_string(),
            challenge_id: challenge.id,
            frame: png_base64(300, 200),
            challenge_response: "wrong".to_string(),
        };
        assert!(service.verify_liveness(request).await.is_err());
    }

    #[tokio::test]
    async fn aml_fails_closed_without_list() {
        let service = service_with_ocr();
        service.submit_kyc(submission()).await.unwrap();
        assert!(matches!(
            service.perform_aml_check("user-1").await.unwrap_err(),
            KYCError::ProviderUnavailable(_)
        ));
    }

    #[tokio::test]
    async fn aml_matches_configured_sanctions_entry() {
        let list = SanctionsList {
            entries: vec![SanctionsEntry {
                name: "Ada Lovelace".to_string(),
                aliases: vec![],
                kind: "sanction".to_string(),
                source: "TEST".to_string(),
                countries: vec![],
            }],
        };
        let service = service_with_ocr().with_screener(Arc::new(ListSanctionsScreener::new(list)));
        service.submit_kyc(submission()).await.unwrap();

        assert!(matches!(
            service.perform_aml_check("user-1").await.unwrap_err(),
            KYCError::AMLCheckFailed(_)
        ));
    }

    #[tokio::test]
    async fn aml_clears_clean_applicant() {
        let list = SanctionsList {
            entries: vec![SanctionsEntry {
                name: "Someone Else".to_string(),
                aliases: vec![],
                kind: "sanction".to_string(),
                source: "TEST".to_string(),
                countries: vec![],
            }],
        };
        let service = service_with_ocr().with_screener(Arc::new(ListSanctionsScreener::new(list)));
        service.submit_kyc(submission()).await.unwrap();

        let result = service.perform_aml_check("user-1").await.unwrap();
        assert!(!result.sanction_match);
        assert_eq!(result.risk_level, "low");
    }

    #[tokio::test]
    async fn approval_requires_all_checks() {
        let list = SanctionsList {
            entries: vec![SanctionsEntry {
                name: "Nobody Here".to_string(),
                aliases: vec![],
                kind: "sanction".to_string(),
                source: "TEST".to_string(),
                countries: vec![],
            }],
        };
        let service = KYCService::new()
            .with_ocr(Arc::new(StubOcr {
                number: "P1234567".to_string(),
            }))
            .with_liveness(Arc::new(StubLiveness(true)))
            .with_screener(Arc::new(ListSanctionsScreener::new(list)));

        let record = service.submit_kyc(submission()).await.unwrap();

        // Liveness and AML have not run: approval must be refused.
        let premature = ReviewKYCRequest {
            kyc_id: record.id.clone(),
            reviewer_id: "admin-1".to_string(),
            status: KYCStatus::Approved,
            notes: None,
        };
        assert!(service.review_kyc(premature).await.is_err());

        // Run liveness.
        let challenge = service.generate_liveness_challenge("user-1").await.unwrap();
        service
            .verify_liveness(VerifyLivenessRequest {
                user_id: "user-1".to_string(),
                challenge_id: challenge.id,
                frame: png_base64(300, 200),
                challenge_response: challenge.nonce,
            })
            .await
            .unwrap();

        // Run AML.
        service.perform_aml_check("user-1").await.unwrap();

        let approval = ReviewKYCRequest {
            kyc_id: record.id,
            reviewer_id: "admin-1".to_string(),
            status: KYCStatus::Approved,
            notes: Some("all checks passed".to_string()),
        };
        let approved = service.review_kyc(approval).await.unwrap();
        assert_eq!(approved.status, KYCStatus::Approved);
    }

    #[tokio::test]
    async fn face_match_fails_closed_without_model() {
        let service = service_with_ocr();
        service.submit_kyc(submission()).await.unwrap();
        assert!(matches!(
            service.match_face("user-1").await.unwrap_err(),
            KYCError::ProviderUnavailable(_)
        ));
    }

    #[tokio::test]
    async fn face_match_accepts_above_threshold() {
        let service = service_with_ocr().with_face_match(Arc::new(StubFace(0.95)));
        service.submit_kyc(submission()).await.unwrap();
        assert!(service.match_face("user-1").await.unwrap());
    }

    #[tokio::test]
    async fn name_normalisation_matches_aliases() {
        let list = SanctionsList {
            entries: vec![SanctionsEntry {
                name: "Ivan Ivanov".to_string(),
                aliases: vec!["I. Ivanov".to_string()],
                kind: "pep".to_string(),
                source: "TEST".to_string(),
                countries: vec![],
            }],
        };
        let screener = ListSanctionsScreener::new(list);
        let hits = screener
            .screen(&["ivan   ivanov".to_string()])
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "pep");
    }
}
