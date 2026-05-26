//! Config Utility - Rust
use std::collections::HashMap;
pub struct Config { entries: HashMap<String, String> }
impl Config {
    pub fn new() -> Self { Self { entries: HashMap::new() } }
    pub fn get(&self, key: &str) -> Option<&String> { self.entries.get(key) }
    pub fn set(&mut self, key: &str, value: &str) { self.entries.insert(key.to_string(), value.to_string()); }
}
impl Default for Config { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let c = Config::new(); } }