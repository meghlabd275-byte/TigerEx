//! ETF Trading - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct ETF { pub ticker: String, pub nav: f64, pub holdings: Vec<(String,f64)> }
pub struct ETFTradingService { etfs: RwLock<HashMap<String, ETF>> }
impl ETFTradingService {
    pub fn new() -> Self { Self { etfs: RwLock::new(HashMap::new()) } }
    pub fn create(&self, ticker: &str, holdings: Vec<(String,f64)>) -> String { let nav: f64 = holdings.iter().map(|(_,v)| v).sum(); self.etfs.write().unwrap().insert(ticker.to_string(), ETF{ticker:ticker.to_string(),nav,holdings}); ticker.to_string() }
    pub fn trade(&self, ticker: &str, qty: f64) -> Result<f64,String> { self.etfs.read().unwrap().get(ticker).map(|e| e.nav*qty).ok_or("ETF not found".to_string()) }
}
impl Default for ETFTradingService{fn default()->Self{Self::new()}}
#[cfg(test)]mod tests{use super::*;#[test]fn test(){let s=ETFTradingService::new();}}