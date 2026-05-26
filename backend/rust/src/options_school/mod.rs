//! Options Academy - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionContract {
    pub id: String,
    pub strike: f64,
    pub expiry: i64,
    pub call_put: CallPut,
    pub premium: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CallPut { Call, Put }

pub struct OptionsAcademy {
    contracts: Vec<OptionContract>,
}

impl OptionsAcademy {
    pub fn new() -> Self { Self { contracts: vec![] } }
    pub fn create_option(&mut self, strike: f64, expiry: i64, cp: CallPut, premium: f64) -> String {
        let id = format!("OPT_{}", self.contracts.len());
        self.contracts.push(OptionContract { id: id.clone(), strike, expiry, call_put: cp, premium });
        id
    }
    pub fn exercise(&mut self, id: &str, underlying: f64) -> f64 {
        if let Some(o) = self.contracts.iter().find(|x| x.id == id) {
            return match o.call_put {
                CallPut::Call => (underlying - o.strike).max(0.0),
                CallPut::Put => (o.strike - underlying).max(0.0),
            };
        }
        0.0
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut a = OptionsAcademy::new(); let id = a.create_option(50000.0, 9999999999, CallPut::Call, 500.0); assert!(!id.is_empty()); } }
