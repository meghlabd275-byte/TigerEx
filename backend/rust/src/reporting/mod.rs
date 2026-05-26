//! Reporting - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub id: String,
    pub report_type: String,
    pub data: HashMap<String, f64>,
    pub period: String,
}

pub struct ReportingService { reports: Vec<Report> }

impl ReportingService {
    pub fn new() -> Self { Self { reports: Vec::new() } }
    pub fn generate(&mut self, rtype: &str, period: &str) -> String {
        let id = format!("RPT_{}", self.reports.len());
        self.reports.push(Report { id: id.clone(), report_type: rtype.to_string(), data: HashMap::new(), period: period.to_string() });
        id
    }
    pub fn add_metric(&mut self, rpt_id: &str, key: &str, val: f64) {
        if let Some(rpt) = self.reports.iter_mut().find(|r| r.id == rpt_id) { rpt.data.insert(key.to_string(), val); }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut r = ReportingService::new(); let id = r.generate("volume", "2024-01"); assert!(!id.is_empty()); } }
