//! Alpha Trading Platform
//! Migration: TypeScript -> Rust

use std::collections::HashMap;

/// Alpha token
#[derive(Debug, Clone)]
pub struct AlphaToken {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub change_24h: f64,
    pub holders: u64,
    pub score: f64,
    pub launch_time: i64,
}

/// Signal
#[derive(Debug, Clone)]
pub struct Signal {
    pub id: String,
    pub token: String,
    pub signal_type: String,
    pub confidence: f64,
    pub timestamp: i64,
}

/// Alpha platform
#[derive(Default)]
pub struct AlphaPlatform {
    tokens: HashMap<String, AlphaToken>,
    signals: Vec<Signal>,
}

impl AlphaPlatform {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_token(&mut self, symbol: &str, name: &str, price: f64) -> AlphaToken {
        let token = AlphaToken {
            id: format!("alpha_{}", self.tokens.len()),
            symbol: symbol.to_string(),
            name: name.to_string(),
            price,
            change_24h: 0.0,
            holders: 0,
            score: 50.0,
            launch_time: chrono::Utc::now().timestamp(),
            tag: "new".to_string(),
        };
        
        self.tokens.insert(token.symbol.clone(), token.clone());
        token
    }

    pub fn calculate_score(&self, token: &AlphaToken) -> f64 {
        let holder_score = (token.holders as f64 / 1000.0).min(30.0);
        let volume_score = if token.change_24h > 0.0 { 20.0 } else { 0.0 };
        let time_score = 10.0;
        
        holder_score + volume_score + time_score
    }

    pub fn get_top_tokens(&self, limit: usize) -> Vec<&AlphaToken> {
        let mut tokens: Vec<_> = self.tokens.values().collect();
        tokens.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        tokens.into_iter().take(limit).collect()
    }
}