// Event Store - Append-Only Event Storage
// Rust for durable event sourcing

use std::collections::VecDeque;
use serde::{Serialize, Deserialize};

// Event envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub event_type: String,
    pub aggregate_id: String,
    pub payload: String, // JSON serialized
    pub timestamp: i64,
    pub version: u32,
    pub metadata: std::collections::HashMap<String, String>,
}

// Aggregate snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub aggregate_id: String,
    pub version: u32,
    pub data: String, // JSON serialized
    pub timestamp: i64,
}

// Event store configuration
#[derive(Debug, Clone)]
pub struct Config {
    pub snapshot_interval: u32,
    pub max_events_in_memory: usize,
}

// Event store
pub struct EventStore {
    events: Vec<Event>,
    snapshots: std::collections::HashMap<String, Snapshot>,
    subscribers: Vec<Box<dyn EventHandler>>,
    config: Config,
    cursor: usize,
}

impl EventStore {
    pub fn new(config: Config) -> Self {
        EventStore {
            events: Vec::new(),
            snapshots: std::collections::HashMap::new(),
            subscribers: Vec::new(),
            config,
            cursor: 0,
        }
    }

    // Append event
    pub fn append(&mut self, event: Event) -> Result<(), String> {
        // Validate version
        let last_version = self.get_last_version(&event.aggregate_id);
        if event.version != last_version + 1 {
            return Err(format!(
                "version mismatch: expected {}, got {}",
                last_version + 1,
                event.version
            ));
        }

        self.events.push(event);

        // Optionally snapshot
        if self.config.snapshot_interval > 0 &&
           self.events.len() % self.config.snapshot_interval as usize == 0 {
            self.snapshot(&event.aggregate_id)?;
        }

        // Notify subscribers
        for sub in &mut self.subscribers {
            sub.handle(&event);
        }

        Ok(())
    }

    // Get events for aggregate
    pub fn get_events(&self, aggregate_id: &str, from_version: u32) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|e| e.aggregate_id == aggregate_id && e.version > from_version)
            .collect()
    }

    // Get last version
    fn get_last_version(&self, aggregate_id: &str) -> u32 {
        self.events
            .iter()
            .filter(|e| e.aggregate_id == aggregate_id)
            .map(|e| e.version)
            .max()
            .unwrap_or(0)
    }

    // Snapshot aggregate
    fn snapshot(&mut self, aggregate_id: &str) -> Result<(), String> {
        let version = self.get_last_version(aggregate_id);
        
        // In real impl, serialize current state
        let data = "{}".to_string();
        
        let snapshot = Snapshot {
            aggregate_id: aggregate_id.to_string(),
            version,
            data,
            timestamp: now_ms(),
        };
        
        self.snapshots.insert(aggregate_id.to_string(), snapshot);
        
        Ok(())
    }

    // Rebuild from snapshot + events
    pub fn rebuild(&self, aggregate_id: &str) -> Option<String> {
        if let Some(snapshot) = self.snapshots.get(aggregate_id) {
            let events = self.get_events(aggregate_id, snapshot.version);
            
            // In real impl: apply events to snapshot
            return Some(snapshot.data.clone());
        }
        
        // No snapshot, rebuild from genesis
        let events = self.get_events(aggregate_id, 0);
        if events.is_empty() {
            return None;
        }
        
        // In real impl: apply all events
        Some("{}".to_string())
    }

    // Subscribe to events
    pub fn subscribe(&mut self, handler: Box<dyn EventHandler>) {
        self.subscribers.push(handler);
    }

    // Replay events from cursor
    pub fn replay(&mut self) -> Vec<&Event> {
        let start = self.cursor;
        self.cursor = self.events.len();
        self.events[start..].iter().collect()
    }
}

// Event handler trait
trait EventHandler {
    fn handle(&mut self, event: &Event);
}

// Handler implementation
struct LoggingHandler;

impl EventHandler for LoggingHandler {
    fn handle(&mut self, event: &Event) {
        println!("Event: {} {}", event.event_type, event.aggregate_id);
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_store() {
        let config = Config {
            snapshot_interval: 10,
            max_events_in_memory: 1000,
        };
        
        let mut store = EventStore::new(config);
        
        let event = Event {
            id: "1".to_string(),
            event_type: "Test".to_string(),
            aggregate_id: "agg1".to_string(),
            payload: "{}".to_string(),
            timestamp: now_ms(),
            version: 1,
            std::collections::HashMap::new(),
        };
        
        store.append(event).unwrap();
        let events = store.get_events("agg1", 0);
        
        assert_eq!(events.len(), 1);
    }
}