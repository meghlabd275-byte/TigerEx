// Stream Processor - Real-Time Stream Processing
// Rust for stream analytics and transformations

use std::collections::HashMap;

// Stream event
#[derive(Debug, Clone)]
pub struct StreamEvent {
    pub id: String,
    pub stream: String,
    pub payload: String,
    pub timestamp: i64,
    pub metadata: HashMap<String, String>,
}

// Aggregation window
#[derive(Debug, Clone)]
pub enum Window {
    Tumbling(u64), // ms
    Sliding { size: u64, slide: u64 },
    Session { timeout: u64 },
}

// Aggregator
#[derive(Debug, Clone)]
pub struct Aggregator {
    pub stream: String,
    pub window: Window,
    pub func: String, // sum, avg, min, max, count
    pub field: String,
}

// Computed aggregation
#[derive(Debug, Clone)]
pub struct Aggregation {
    pub id: String,
    pub stream: String,
    pub window: Window,
    pub value: f64,
    pub count: u64,
    pub started_at: i64,
    pub ended_at: i64,
}

// Stream processor
pub struct StreamProcessor {
    streams: HashMap<String, Vec<StreamEvent>>,
    aggregators: Vec<Aggregator>,
    windows: HashMap<String, Aggregation>,
}

impl StreamProcessor {
    pub fn new() -> Self {
        StreamProcessor {
            streams: HashMap::new(),
            aggregators: Vec::new(),
            windows: HashMap::new(),
        }
    }

    // Register stream
    pub fn register_stream(&mut self, stream_name: &str) {
        self.streams.insert(stream_name.to_string(), Vec::new());
    }

    // Produce event
    pub fn produce(&mut self, stream_name: &str, payload: String) -> String {
        let event = StreamEvent {
            id: format!("evt_{}", rand_id()),
            stream: stream_name.to_string(),
            payload,
            timestamp: now_ms(),
            metadata: HashMap::new(),
        };

        if let Some(events) = self.streams.get_mut(stream_name) {
            events.push(event.clone());
        }

        // Update aggregators
        self.update_aggregators(stream_name);

        event.id
    }

    // Consume events
    pub fn consume(&self, stream_name: &str, from_ts: i64) -> Vec<&StreamEvent> {
        if let Some(events) = self.streams.get(stream_name) {
            events
                .iter()
                .filter(|e| e.timestamp >= from_ts)
                .collect()
        } else {
            Vec::new()
        }
    }

    // Add aggregator
    pub fn add_aggregator(&mut self, stream: &str, window: Window, func: &str, field: &str) {
        let agg = Aggregator {
            stream: stream.to_string(),
            window,
            func: func.to_string(),
            field: field.to_string(),
        };

        self.aggregators.push(agg);
    }

    // Update aggregators
    fn update_aggregators(&mut self, stream_name: &str) {
        // In real impl: compute aggregations
    }

    // Get aggregated value
    pub fn get_aggregation(&self, stream: &str) -> Option<&Aggregation> {
        self.windows.get(stream)
    }

    // Windowed computation
    pub fn compute_window(&mut self, stream: &str, window: &Window) -> Aggregation {
        let events = self.streams.get(stream);

        let mut sum = 0.0;
        let mut count = 0u64;

        if let Some(evts) = events {
            for e in evts {
                sum += 1.0; // Simplified
                count += 1;
            }
        }

        Aggregation {
            id: format!("agg_{}", rand_id()),
            stream: stream.to_string(),
            window: window.clone(),
            value: if count > 0 { sum / count as f64 } else { 0.0 },
            count,
            started_at: now_ms(),
            ended_at: now_ms(),
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn rand_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    iter::repeat_with(|| chars[0]).take(16).map(|c| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream() {
        let mut proc = StreamProcessor::new();

        proc.register_stream("trades");
        proc.produce("trades", "btc buys".to_string());

        let events = proc.consume("trades", 0);
        assert!(!events.is_empty());
    }
}