//! Gift Cards - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftCard { pub code: String, pub amount: f64, pub currency: String, pub claimed: bool }

pub struct GiftCardService { cards: HashMap<String, GiftCard> }

impl GiftCardService { pub fn new() -> Self { Self { cards: HashMap::new() } }
    pub fn create(&mut self, code: &str, amount: f64, curr: &str) {
        self.cards.insert(code.to_string(), GiftCard { code: code.to_string(), amount, currency: curr.to_string(), claimed: false });
    }
    pub fn claim(&mut self, code: &str) -> Result<f64, String> {
        let card = self.cards.get_mut(code).ok_or("Code not found")?;
        if card.claimed { return Err("Already claimed".into()); }
        card.claimed = true;
        Ok(card.amount)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut g = GiftCardService::new(); g.create("GIFT123", 100.0, "USD"); assert!(g.claim("GIFT123").unwrap() == 100.0); } }
