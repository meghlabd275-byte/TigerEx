// TigerEx Token Creation System
// Built with Rust for high speed with ultra-low latency

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Token {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: u64,
    pub contract: String,
    pub blockchain: String,
    pub status: String,
}

pub struct TokenManager {
    tokens: HashMap<String, Token>,
}

impl TokenManager {
    pub fn new() -> Self {
        Self { tokens: HashMap::new() }
    }

    pub fn create_token(&mut self, name: &str, symbol: &str, decimals: u8, total_supply: u64, blockchain: &str) -> String {
        let id = format!("TOKEN_{}", self.tokens.len());
        let token = Token {
            id: id.clone(),
            name: name.to_string(),
            symbol: symbol.to_string(),
            decimals,
            total_supply,
            contract: format!("0x{:040x}", id.len()),
            blockchain: blockchain.to_string(),
            status: "ACTIVE".to_string(),
        };
        self.tokens.insert(id.clone(), token);
        id
    }

    pub fn deploy_token(&self, id: &str) -> bool {
        self.tokens.contains_key(id)
    }

    pub fn get_token(&self, id: &str) -> Option<&Token> {
        self.tokens.get(id)
    }

    pub fn get_tokens_by_blockchain(&self, blockchain: &str) -> Vec<&Token> {
        self.tokens.values().filter(|t| t.blockchain == blockchain).collect()
    }

    pub fn mint_tokens(&mut self, id: &str, amount: u64) -> bool {
        if let Some(token) = self.tokens.get_mut(id) {
            token.total_supply += amount;
            return true;
        }
        false
    }

    pub fn burn_tokens(&mut self, id: &str, amount: u64) -> bool {
        if let Some(token) = self.tokens.get_mut(id) {
            if token.total_supply >= amount {
                token.total_supply -= amount;
                return true;
            }
        }
        false
    }

    pub fn pause_token(&mut self, id: &str) -> bool {
        if let Some(token) = self.tokens.get_mut(id) {
            token.status = "PAUSED".to_string();
            return true;
        }
        false
    }

    pub fn resume_token(&mut self, id: &str) -> bool {
        if let Some(token) = self.tokens.get_mut(id) {
            token.status = "ACTIVE".to_string();
            return true;
        }
        false
    }
}

fn main() {
    println!("TigerEx Token Creation System");
    
    let mut manager = TokenManager::new();
    
    // Create tokens
    let t1 = manager.create_token("Tiger Token", "TGR", 18, 1000000000, "Ethereum");
    let t2 = manager.create_token("USD Tiger", "USDT", 6, 10000000000, "BSC");
    let t3 = manager.create_token("Gold Tiger", "XAU", 8, 1000000, "Ethereum");
    
    println!("Created: {}", t1);
    println!("Created: {}", t2);
    println!("Created: {}", t3);
    
    // Mint more
    manager.mint_tokens(&t1, 500000000);
    println!("Minted 500M TGR");
    
    // Pause
    manager.pause_token(&t3);
    println!("Paused XAU");
    
    // List by blockchain
    for t in manager.get_tokens_by_blockchain("Ethereum") {
        println!("Token: {} - {}", t.symbol, t.status);
    }
}
