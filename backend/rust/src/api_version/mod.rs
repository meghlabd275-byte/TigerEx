//! API Versioning - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIVersion {
    pub version: String,
    pub deprecated: bool,
    pub sunset_date: Option<i64>,
}

pub struct VersionService {
    versions: Vec<APIVersion>,
}

impl VersionService {
    pub fn new() -> Self { Self { versions: vec![] } }
    pub fn register(&mut self, version: &str) {
        self.versions.push(APIVersion { version: version.to_string(), deprecated: false, sunset_date: None });
    }
    pub fn deprecate(&mut self, version: &str) -> Result<(), String> {
        let v = self.versions.iter_mut().find(|v| v.version == version).ok_or("Version not found")?;
        v.deprecated = true;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut v = VersionService::new(); v.register("v1"); } }
