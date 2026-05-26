//! API Handlers - Rust
use std::sync::RwLock;
use std::collections::HashMap;

pub struct ApiHandler;
impl ApiHandler {
    pub fn new() -> Self { Self }
    pub fn handle(&self, path: &str, body: &[u8]) -> Response {
        match path {
            "/api/v1/account" => Response { status: 200, body: b"{\"ok\":true}".to_vec() },
            "/api/v1/order" => Response { status: 200, body: b"{\"ok\":true}".to_vec() },
            _ => Response { status: 404, body: b"{\"error\":\"not found\"}".to_vec() },
        }
    }
}
impl Default for ApiHandler { fn default() -> Self { Self::new() } }

#[derive(Debug, Clone)]
pub struct Response { pub status: u16, pub body: Vec<u8> }
#[cfg(test)] mod tests { use super::*; #[test] fn test_handle() { let h = ApiHandler::new(); let r = h.handle("/api/v1/account", &[]); assert_eq!(r.status, 200); } }