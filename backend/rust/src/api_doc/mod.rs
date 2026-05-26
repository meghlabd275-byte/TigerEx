//! API Documentation - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub path: String,
    pub method: Method,
    pub description: String,
    pub params: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Method { GET, POST, PUT, DELETE }

pub struct APIDocumentation {
    endpoints: Vec<Endpoint>,
}

impl APIDocumentation {
    pub fn new() -> Self { Self { endpoints: vec![] } }
    pub fn add_endpoint(&mut self, path: &str, method: Method, desc: &str, params: Vec<&str>) -> String {
        let id = format!("DOC_{}", self.endpoints.len());
        self.endpoints.push(Endpoint { path: path.to_string(), method, description: desc.to_string(), params: params.into_iter().map(String::from).collect() });
        id
    }
    pub fn get_json(&self) -> String {
        serde_json::to_string(&self.endpoints).unwrap_or_default()
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut d = APIDocumentation::new(); d.add_endpoint("/api/v1/trades", Method::GET, "Get trades", vec!["limit", "offset"]); } }
