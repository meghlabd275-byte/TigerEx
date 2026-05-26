//! CDN Manager - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CDNAsset { pub id: String, pub url: String, pub region: String }

pub struct CDNManager {
    assets: HashMap<String, CDNAsset>,
}

impl CDNManager {
    pub fn new() -> Self { Self { assets: HashMap::new() } }
    pub fn upload(&mut self, url: &str, region: &str) -> String {
        let id = format!("CDN_{}", self.assets.len());
        self.assets.insert(id.clone(), CDNAsset { id: id.clone(), url: url.to_string(), region: region.to_string() });
        id
    }
    pub fn get_url(&self, id: &str) -> Option<String> { self.assets.get(id).map(|a| a.url.clone()) }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = CDNManager::new(); let id = c.upload("https://cdn.example.com/asset.png", "us-east"); assert!(!id.is_empty()); } }
