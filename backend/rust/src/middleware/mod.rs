//! Middleware Stack - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Middleware {
    pub name: String,
    pub order: u32,
    pub enabled: bool,
}

pub struct MiddlewareStack {
    middlewares: Vec<Middleware>,
}

impl MiddlewareStack {
    pub fn new() -> Self { Self { middlewares: vec![] } }
    pub fn add(&mut self, name: &str, order: u32) {
        self.middlewares.push(Middleware { name: name.to_string(), order, enabled: true });
    }
    pub fn process(&self, req: &str) -> String {
        format!("processed: {}", req)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut m = MiddlewareStack::new(); m.add("auth", 1); } }
