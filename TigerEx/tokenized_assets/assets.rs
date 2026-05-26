//! Tokenized Assets Platform
//! Migration: TypeScript -> Rust

use std::collections::HashMap;

/// Asset type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetType {
    Stock,
    ETF,
    Commodity,
    RealEstate,
    Bond,
    Fund,
}

/// Asset status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetStatus {
    Active,
    Paused,
    Settled,
}

/// Tokenized asset
#[derive(Debug, Clone)]
pub struct TokenizedAsset {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub asset_type: AssetType,
    pub underlying: String,
    pub total_supply: f64,
    pub circulating_supply: f64,
    pub price_per_token: f64,
    pub currency: String,
    pub status: AssetStatus,
}

/// Asset platform
#[derive(Default)]
pub struct AssetPlatform {
    assets: HashMap<String, TokenizedAsset>,
}

impl AssetPlatform {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_asset(&mut self, symbol: &str, name: &str, asset_type: AssetType, underlying: &str, supply: f64, price: f64) -> TokenizedAsset {
        let asset = TokenizedAsset {
            id: format!("asset_{}", self.assets.len()),
            symbol: symbol.to_string(),
            name: name.to_string(),
            asset_type,
            underlying: underlying.to_string(),
            total_supply: supply,
            circulating_supply: 0.0,
            price_per_token: price,
            currency: "USD".to_string(),
            status: AssetStatus::Active,
        };
        
        self.assets.insert(asset.symbol.clone(), asset.clone());
        asset
    }

    pub fn get_price(&self, symbol: &str) -> f64 {
        self.assets.get(symbol).map(|a| a.price_per_token).unwrap_or(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create() {
        let mut plat = AssetPlatform::new();
        let asset = plat.create_asset("AAPL", "Apple Inc", AssetType::Stock, "AAPL", 1_000_000.0, 150.0);
        assert_eq!(asset.price_per_token, 150.0);
    }
}