//! Event Handler - Rust Implementation
//! High-performance event handling for TigerEx

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub payload: serde_json::Value,
    pub timestamp: i64,
}

/// Event result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Event handler function type
pub type EventHandlerFn = fn(Event) -> EventResult;

/// Event handler registry
pub struct EventHandler {
    handlers: Mutex<HashMap<String, EventHandlerFn>>,
}

impl EventHandler {
    /// Create new event handler
    pub fn new() -> Self {
        Self {
            handlers: Mutex::new(HashMap::new()),
        }
    }

    /// Register event handler
    pub fn on(&self, event: &str, handler: EventHandlerFn) {
        let mut handlers = self.handlers.lock().unwrap();
        handlers.insert(event.to_string(), handler);
    }

    /// Emit event
    pub fn emit(&self, event: Event) -> EventResult {
        let handlers = self.handlers.lock().unwrap();
        
        if let Some(handler) = handlers.get(&event.event_type) {
            handler(event)
        } else {
            EventResult {
                success: false,
                error: Some(format!("No handler for event: {}", event.event_type)),
            }
        }
    }

    /// Check if handler exists
    pub fn has_handler(&self, event: &str) -> bool {
        let handlers = self.handlers.lock().unwrap();
        handlers.contains_key(event)
    }

    /// Remove handler
    pub fn off(&self, event: &str) {
        let mut handlers = self.handlers.lock().unwrap();
        handlers.remove(event);
    }
}

/// Global event handler
pub fn create_event_handler() -> EventHandler {
    EventHandler::new()
}

/// Trade event handler
pub fn handle_trade(event: Event) -> EventResult {
    println!("Trade event: {:?}", event.payload);
    EventResult { success: true, error: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_handler() {
        let eh = EventHandler::new();
        
        eh.on("trade", handle_trade);
        
        let event = Event {
            event_type: "trade".to_string(),
            payload: serde_json::json!({"price": 50000}),
            timestamp: 1234567890,
        };
        
        let result = eh.emit(event);
        assert!(result.success);
    }

    #[test]
    fn test_has_handler() {
        let eh = EventHandler::new();
        eh.on("test", handle_trade);
        
        assert!(eh.has_handler("test"));
        assert!(!eh.has_handler("other"));
    }
}