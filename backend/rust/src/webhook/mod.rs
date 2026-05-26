//! Webhook Handler - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Webhook {
    pub id: String,
    pub url: String,
    pub event: String,
    pub secret: String,
    pub enabled: bool,
}

pub struct WebhookService {
    webhooks: HashMap<String, Webhook>,
}

impl WebhookService {
    pub fn new() -> Self { Self { webhooks: HashMap::new() } }
    pub fn register(&mut self, url: &str, event: &str) -> String {
        let id = format!("WH_{}", self.webhooks.len());
        let secret = format!("sec_{:016x}", self.webhooks.len() * 789);
        self.webhooks.insert(id.clone(), Webhook { id: id.clone(), url: url.to_string(), event: event.to_string(), secret, enabled: true });
        id
    }
    pub fn trigger(&self, id: &str) -> Option<&str> { self.webhooks.get(id).map(|w| w.event.as_str()) }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut w = WebhookService::new(); let id = w.register("https://example.com/hook", "trade"); assert!(!id.is_empty()); } }
