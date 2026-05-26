//! Gateway Utility - Rust
pub struct GatewayUtil;
impl GatewayUtil {
    pub fn new() -> Self { Self }
    pub fn process_payment(&self, method: &str, amount: f64) -> Result<(), String> { Ok(()) }
    pub fn get_supported_methods(&self) -> Vec<String> { vec!["bank".to_string(), "card".to_string(), "crypto".to_string()] }
}
impl Default for GatewayUtil { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let g = GatewayUtil::new(); } }