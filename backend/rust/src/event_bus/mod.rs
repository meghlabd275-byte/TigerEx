//! Event Bus - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub payload: String,
    pub timestamp: i64,
}

pub struct EventBus {
    subscribers: HashMap<String, Vec<String>>,
    events: Vec<Event>,
}

impl EventBus {
    pub fn new() -> Self { Self { subscribers: HashMap::new(), events: vec![] } }
    pub fn subscribe(&mut self, event_type: &str, subscriber: &str) {
        self.subscribers.entry(event_type.to_string()).or_insert_with(Vec::new).push(subscriber.to_string());
    }
    pub fn publish(&mut self, event_type: &str, payload: &str) {
        self.events.push(Event { event_type: event_type.to_string(), payload: payload.to_string(), timestamp: now_ms() });
    }
    pub fn get_events(&self, event_type: &str) -> Vec<&Event> {
        self.events.iter().filter(|e| e.event_type == event_type).collect()
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut e = EventBus::new(); e.publish("trade", "{}"); } }
