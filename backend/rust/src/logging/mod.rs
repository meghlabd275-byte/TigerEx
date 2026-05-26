// Logging - Structured Logging
// Rust for structured logging

use std::collections::HashMap;

// Log level
#[derive(Debug, Clone)]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

// Log entry
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub level: Level,
    pub message: String,
    pub timestamp: i64,
    pub fields: HashMap<String, String>,
    pub caller: String,
}

// Logger
pub struct Logger {
    level: Level,
    fields: HashMap<String, String>,
}

impl Logger {
    pub fn new(level: Level) -> Self {
        Logger {
            level,
            fields: HashMap::new(),
        }
    }

    // Set field
    pub fn with_field(mut self, key: &str, value: &str) -> Self {
        self.fields.insert(key.to_string(), value.to_string());
        self
    }

    // Log
    pub fn log(&self, level: Level, message: &str) {
        if level < self.level {
            return;
        }

        let entry = LogEntry {
            level: level.clone(),
            message: message.to_string(),
            timestamp: now_ms(),
            fields: self.fields.clone(),
            caller: "main".to_string(),
        };

        // In real impl: write to output
        println!("{:?} {}", entry.timestamp, entry.message);
    }

    // Convenience methods
    pub fn trace(&self, msg: &str) { self.log(Level::Trace, msg); }
    pub fn debug(&self, msg: &str) { self.log(Level::Debug, msg); }
    pub fn info(&self, msg: &str) { self.log(Level::Info, msg); }
    pub fn warn(&self, msg: &str) { self.log(Level::Warn, msg); }
    pub fn error(&self, msg: &str) { self.log(Level::Error, msg); }
}

// Default logger
pub fn default_logger() -> Logger {
    Logger::new(Level::Info)
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
    fn test_logging() {
        let log = Logger::new(Level::Debug);
        log.info("Hello, World!");
    }
}