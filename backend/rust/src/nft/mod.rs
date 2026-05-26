//! NFT Marketplace - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NFTCollection {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub floor_px: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NFTToken {
    pub id: String,
    pub collection: String,
    pub owner: String,
    pub price: f64,
    pub listed: bool,
}

pub struct NFTMarketplace {
    collections: HashMap<String, NFTCollection>,
    tokens: HashMap<String, NFTToken>,
}

impl NFTMarketplace {
    pub fn new() -> Self {
        Self { collections: HashMap::new(), tokens: HashMap::new() }
    }
    pub fn create_collection(&mut self, name: &str, sym: &str) -> String {
        let id = format!("COL_{}", self.collections.len());
        self.collections.insert(id.clone(), NFTCollection {
            id: id.clone(),
            name: name.to_string(),
            symbol: sym.to_string(),
            floor_px: 0.0,
        });
        id
    }
    pub fn mint(&mut self, col: &str, owner: &str) -> String {
        let id = format!("{}_{}", col, self.tokens.len());
        self.tokens.insert(id.clone(), NFTToken {
            id: id.clone(),
            collection: col.to_string(),
            owner: owner.to_string(),
            price: 0.0,
            listed: false,
        });
        id
    }
    pub fn list(&mut self, token_id: &str, price: f64) -> Result<(), String> {
        let t = self.tokens.get_mut(&token_id).ok_or("Token not found")?;
        t.listed = true;
        t.price = price;
        Ok(())
    }
    pub fn buy(&mut self, token_id: &str, buyer: &str) -> Result<f64, String> {
        let t = self.tokens.get_mut(&token_id).ok_or("Token not found")?;
        if !t.listed {
            return Err("Not listed".into());
        }
        let px = t.price;
        t.owner = buyer.to_string();
        t.listed = false;
        Ok(px)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_nft() {
        let mut m = NFTMarketplace::new();
        let col = m.create_collection("Test", "TEST");
        let tok = m.mint(&col, "user1");
        assert!(m.list(&tok, 1.0).is_ok());
    }
}
