//! KYC Service - Rust Implementation
//! 
//! Know Your Customer - verification flow

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// KYC application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCApplication {
    pub user_id: String,
    pub level: KYCLevel,
    pub status: KYCStatus,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: i64,
    pub nationality: String,
    pub country: String,
    pub address: String,
    pub documents: Vec<KYCDocument>,
    pub submitted_at: Option<i64>,
    pub reviewed_at: Option<i64>,
    pub reviewed_by: Option<String>,
}

#[derive(Debug, Clone,_copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KYCLevel {
    None = 0,
    Basic = 1,
    Intermediate = 2,
    Full = 3,
    Institutional = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KYCStatus {
    Pending,
    InReview,
    Approved,
    Rejected,
    NeedsMoreInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCDocument {
    pub id: String,
    pub doc_type: DocumentType,
    pub country: String,
    pub number: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentType {
    Passport,
    DriverLicense,
    NationalID,
    UtilityBill,
}

pub struct KYCService {
    applications: HashMap<String, KYCApplication>,
}

impl KYCService {
    pub fn new() -> Self {
        Self {
            applications: HashMap::new(),
        }
    }

    /// Submit KYC application
    pub fn submit(&mut self, user_id: &str, first_name: &str, last_name: &str,
              dob: i64, nationality: &str, country: &str, address: &str) -> String {
        let app = KYCApplication {
            user_id: user_id.to_string(),
            level: KYCLevel::Basic,
            status: KYCStatus::Pending,
            first_name: first_name.to_string(),
            last_name: last_name.to_string(),
            date_of_birth: dob,
            nationality: nationality.to_string(),
            country: country.to_string(),
            address: address.to_string(),
            documents: Vec::new(),
            submitted_at: Some(current_timestamp_ms()),
            reviewed_at: None,
            reviewed_by: None,
        };

        let id = user_id.to_string();
        self.applications.insert(id, app);
        id
    }

    /// Add document
    pub fn add_document(&mut self, user_id: &str, doc_type: DocumentType,
                     country: &str, number: &str) -> Result<(), String> {
        let app = self.applications.get_mut(user_id)
            .ok_or("KYC not found")?;

        app.documents.push(KYCDocument {
            id: format!("doc_{}", app.documents.len()),
            doc_type,
            country: country.to_string(),
            number: number.to_string(),
            verified: false,
        });

        Ok(())
    }

    /// Approve KYC
    pub fn approve(&mut self, user_id: &str, reviewer_id: &str) -> Result<KYCLevel, String> {
        let app = self.applications.get_mut(user_id)
            .ok_or("KYC not found")?;

        app.status = KYCStatus::Approved;
        app.reviewed_at = Some(current_timestamp_ms());
        app.reviewed_by = Some(reviewer_id.to_string());

        Ok(app.level)
    }

    /// Reject KYC
    pub fn reject(&mut self, user_id: &str, reviewer_id: &str, reason: &str) -> Result<(), String> {
        let app = self.applications.get_mut(user_id)
            .ok_or("KYC not found")?;

        app.status = KYCStatus::Rejected;
        app.reviewed_at = Some(current_timestamp_ms());
        app.reviewed_by = Some(reviewer_id.to_string());

        Ok(())
    }

    /// Get application
    pub fn get_application(&self, user_id: &str) -> Option<&KYCApplication> {
        self.applications.get(user_id)
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_submit_kyc() {
        let mut service = KYCService::new();
        let id = service.submit("user1", "John", "Doe", 0, "US", "US", "123 Main St");
        assert_eq!(id, "user1");
    }
}