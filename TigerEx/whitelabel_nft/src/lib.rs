// TigerEx NFT Management System
// Built with Rust for high speed with ultra-low latency

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct NFTCollection {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub owner: String,
    pub total_supply: u64,
    pub minted: u64,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct NFT {
    pub id: String,
    pub collection_id: String,
    pub owner: String,
    pub token_uri: String,
    pub metadata: String,
    pub status: String,
}

pub struct NFTManager {
    collections: HashMap<String, NFTCollection>,
    nfts: HashMap<String, NFT>,
}

impl NFTManager {
    pub fn new() -> Self {
        Self {
            collections: HashMap::new(),
            nfts: HashMap::new(),
        }
    }

    pub fn create_collection(&mut self, name: &str, symbol: &str, owner: &str) -> String {
        let id = format!("COLL_{}", name.len());
        let collection = NFTCollection {
            id: id.clone(),
            name: name.to_string(),
            symbol: symbol.to_string(),
            owner: owner.to_string(),
            total_supply: 10000,
            minted: 0,
            status: "ACTIVE".to_string(),
        };
        self.collections.insert(id.clone(), collection);
        id
    }

    pub fn mint_nft(&mut self, collection_id: &str, owner: &str, token_uri: &str) -> String {
        let nft_id = format!("NFT_{}", self.nfts.len());
        let nft = NFT {
            id: nft_id.clone(),
            collection_id: collection_id.to_string(),
            owner: owner.to_string(),
            token_uri: token_uri.to_string(),
            metadata: "{}".to_string(),
            status: "MINTED".to_string(),
        };
        
        if let Some(col) = self.collections.get_mut(collection_id) {
            col.minted += 1;
        }
        
        self.nfts.insert(nft_id.clone(), nft);
        nft_id
    }

    pub fn transfer_nft(&mut self, nft_id: &str, to: &str) -> bool {
        if let Some(nft) = self.nfts.get_mut(nft_id) {
            nft.owner = to.to_string();
            return true;
        }
        false
    }

    pub fn burn_nft(&mut self, nft_id: &str) -> bool {
        if let Some(nft) = self.nfts.get_mut(nft_id) {
            nft.status = "BURNED".to_string();
            return true;
        }
        false
    }

    pub fn get_collection(&self, id: &str) -> Option<&NFTCollection> {
        self.collections.get(id)
    }

    pub fn get_nft(&self, id: &str) -> Option<&NFT> {
        self.nfts.get(id)
    }

    pub fn get_collections(&self) -> Vec<&NFTCollection> {
        self.collections.values().collect()
    }
}

fn main() {
    println!("TigerEx NFT Management System");
    
    let mut manager = NFTManager::new();
    
    // Create collection
    let coll_id = manager.create_collection("Tiger NFTs", "TIGER", "admin");
    println!("Created collection: {}", coll_id);
    
    // Mint NFTs
    let nft1 = manager.mint_nft(&coll_id, "user1", "ipfs://token1");
    let nft2 = manager.mint_nft(&coll_id, "user2", "ipfs://token2");
    println!("Minted: {}, {}", nft1, nft2);
    
    // Transfer
    manager.transfer_nft(&nft1, "user3");
    println!("Transferred NFT to user3");
    
    // List collections
    for c in manager.get_collections() {
        println!("Collection: {} - {}", c.name, c.minted);
    }
}
