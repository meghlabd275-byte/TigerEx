//! Cross-Margin Portfolio - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct PortfolioPosition { pub product: String, pub value: f64, pub margin_used: f64 }
pub struct CrossMarginService { portfolios: RwLock<HashMap<String, Vec<PortfolioPosition>>> }
impl CrossMarginService {
    pub fn new() -> Self { Self { portfolios: RwLock::new(HashMap::new()) } }
    pub fn allocate(&self, user_id: &str, product: &str, value: f64) -> Result<(), String> {
        let mut p = self.portfolios.write().unwrap();
        let portfolio = p.entry(user_id.to_string()).or_insert_with(Vec::new);
        portfolio.push(PortfolioPosition { product: product.to_string(), value, margin_used: value * 0.1 });
        Ok(())
    }
    pub fn get_total_exposure(&self, user_id: &str) -> f64 { self.portfolios.read().unwrap().get(user_id).map(|p| p.iter().map(|x| x.value).sum::<f64>()).unwrap_or(0.0) }
}
impl Default for CrossMarginService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = CrossMarginService::new(); } }