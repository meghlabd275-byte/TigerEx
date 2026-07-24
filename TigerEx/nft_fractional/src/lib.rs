// TigerEx NFT Fractionalization System
// Built with Rust for high speed and security

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct NFT {
    pub id: String,
    pub collection_id: String,
    pub owner: String,
    pub token_uri: String,
    pub metadata: String,
}

#[derive(Debug, Clone)]
pub struct FractionalVault {
    pub id: String,
    pub nft_id: String,
    pub total_shares: u64,
    pub shares_issued: u64,
    pub price_per_share: f64,
    pub owner: String,
    pub status: String,
    pub holders: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct FractionalMarket {
    pub vault_id: String,
    pub current_price: f64,
    pub volume_24h: f64,
    pub orders: Vec<Order>,
}

#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub order_type: String,
    pub user: String,
    pub shares: u64,
    pub price: f64,
    pub status: String,
}

pub struct FractionalService {
    vaults: HashMap<String, FractionalVault>,
    markets: HashMap<String, FractionalMarket>,
}

impl FractionalService {
    pub fn new() -> Self {
        Self {
            vaults: HashMap::new(),
            markets: HashMap::new(),
        }
    }

    // Create fractional vault from NFT
    pub fn create_vault(&mut self, nft_id: String, owner: String, total_shares: u64, price_per_share: f64) -> String {
        let vault_id = format!("VAULT_{}", self.vaults.len());
        
        let vault = FractionalVault {
            id: vault_id.clone(),
            nft_id,
            total_shares,
            shares_issued: 0,
            price_per_share,
            owner: owner.clone(),
            status: "ACTIVE".to_string(),
            holders: HashMap::new(),
        };
        
        // Owner holds all shares initially
        let mut holders = HashMap::new();
        holders.insert(owner, total_shares);
        
        let vault_with_holders = FractionalVault {
            holders,
            ..vault
        };
        
        self.vaults.insert(vault_id.clone(), vault_with_holders);
        
        // Create market
        self.markets.insert(vault_id.clone(), FractionalMarket {
            vault_id: vault_id.clone(),
            current_price: price_per_share,
            volume_24h: 0.0,
            orders: Vec::new(),
        });
        
        vault_id
    }

    // Buy shares
    pub fn buy_shares(&mut self, vault_id: &str, buyer: String, shares: u64) -> Result<f64, String> {
        let vault = self.vaults.get_mut(vault_id).ok_or("Vault not found")?;
        
        if vault.shares_issued + shares > vault.total_shares {
            return Err("Not enough shares available".to_string());
        }
        
        let cost = shares as f64 * vault.price_per_share;
        
        vault.shares_issued += shares;
        *vault.holders.entry(buyer).or_insert(0) += shares;
        
        // Update market
        if let Some(market) = self.markets.get_mut(vault_id) {
            market.volume_24h += cost;
        }
        
        Ok(cost)
    }

    // Sell shares
    pub fn sell_shares(&mut self, vault_id: &str, seller: String, shares: u64) -> Result<f64, String> {
        let vault = self.vaults.get_mut(vault_id).ok_or("Vault not found")?;
        
        let seller_shares = vault.holders.get(&seller).copied().unwrap_or(0);
        if seller_shares < shares {
            return Err("Not enough shares".to_string());
        }
        
        let proceeds = shares as f64 * vault.price_per_share;
        
        vault.shares_issued -= shares;
        *vault.holders.get_mut(&seller).unwrap() -= shares;
        
        Ok(proceeds)
    }

    // Get vault info
    pub fn get_vault(&self, vault_id: &str) -> Option<&FractionalVault> {
        self.vaults.get(vault_id)
    }

    // Get holder balance
    pub fn get_balance(&self, vault_id: &str, holder: &str) -> u64 {
        self.vaults.get(vault_id)
            .and_then(|v| v.holders.get(holder))
            .copied()
            .unwrap_or(0)
    }
}

fn main() {
    println!("TigerEx NFT Fractionalization System");
    
    let mut service = FractionalService::new();
    
    // Create vault
    let vault_id = service.create_vault("NFT_123".to_string(), "owner1".to_string(), 1000000, 0.01);
    println!("Created Vault: {}", vault_id);
    
    // Buy shares
    let cost = service.buy_shares(&vault_id, "user1".to_string(), 10000).unwrap();
    println!("User1 bought 10000 shares for: ${}", cost);
    
    // Check balance
    let balance = service.get_balance(&vault_id, "user1");
    println!("User1 balance: {} shares", balance);
    
    // Sell shares
    let proceeds = service.sell_shares(&vault_id, "user1".to_string(), 5000).unwrap();
    println!("User1 sold 5000 shares for: ${}", proceeds);
}
