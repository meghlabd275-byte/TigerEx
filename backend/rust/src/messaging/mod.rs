//! Messaging Service - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub content: String,
    pub read: bool,
}

pub struct MessagingService { msgs: HashMap<String, Vec<Message>> }

impl MessagingService {
    pub fn new() -> Self { Self { msgs: HashMap::new() } }
    pub fn send(&mut self, from: &str, to: &str, content: &str) -> String {
        let id = format!("MSG_{}", self.msgs.len());
        self.msgs.entry(to.to_string()).or_insert_with(Vec::new).push(Message { id: id.clone(), from: from.to_string(), to: to.to_string(), content: content.to_string(), read: false });
        id
    }
    pub fn inbox(&self, user: &str) -> Vec<&Message> {
        self.msgs.get(user).map(|v| v.iter().collect()).unwrap_or_default()
    }
    pub fn mark_read(&mut self, user: &str, msg_id: &str) {
        if let Some(msgs) = self.msgs.get_mut(user) { if let Some(m) = msgs.iter_mut().find(|m| m.id == msg_id) { m.read = true; } }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut m = MessagingService::new(); let id = m.send("user1", "user2", "Hello"); assert!(!id.is_empty()); } }
