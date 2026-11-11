//! TigerEx Rust Crypto Module
//! High-performance cryptographic operations for security-critical functions

pub mod grid;
pub mod merkle;
pub mod cross;
pub mod signing;
pub mod websocket_gateway;
pub mod stream_processor;
pub mod auth;
pub mod risk;
pub mod pnl;
pub mod crypto_utils;
pub mod quant;
pub mod admin;
pub mod affiliate;
pub mod aml;
pub mod analytics;
pub mod api_doc;
pub mod api_gateway;
pub mod api_version;
pub mod arbitrage;
pub mod audit_log;
pub mod backup;
pub mod billing;
pub mod blockchain_node;
pub mod cache_layer;
pub mod cdn;
pub mod chaos;
pub mod circuit_break;
pub mod competition;
pub mod compliance;
pub mod constants;
pub mod copy;
pub mod cross_chain;
pub mod custody;
pub mod custody_mod;
pub mod dca_strategy;
pub mod defi;
pub mod delegate;
pub mod derivation;
pub mod derivatives;
pub mod dns;
pub mod domain;
pub mod earn_yield;
pub mod event_bus;
pub mod event_handler;
pub mod export;
pub mod external_clients;
pub mod feed;
pub mod fiat;
pub mod fiat_ramp;
pub mod giftcard;
pub mod governance;
pub mod grid_trading;
pub mod heALTH;
pub mod health_monitor;
pub mod hedge;
pub mod hidden;
pub mod index;
pub mod institutional;
pub mod insurance;
pub mod invoice;
pub mod job_queue;
pub mod kYC;
pub mod kyc;
pub mod launchpad;
pub mod lb;
pub mod leaderboard;
pub mod ledger;
pub mod limits;
pub mod liquidation;
pub mod liquidity_pool;
pub mod margin;
pub mod margin_loan;
pub mod market_data_feed;
pub mod matching;
pub mod matching_engine;
pub mod messaging;
pub mod mev;
pub mod middleware;
pub mod monitoring;
pub mod nft;
pub mod notification;
pub mod options_school;
pub mod oracle;
pub mod oracle_price;
pub mod oracle_svc;
pub mod order_service;
pub mod p2p;
pub mod p2p_bridge;
pub mod p2p_service;
pub mod partner_api;
pub mod payment_gateway;
pub mod perpetual;
pub mod prediction;
pub mod premium;
pub mod price;
pub mod prime;
pub mod priority_queue;
pub mod proof;
pub mod rate;
pub mod redis_cache;
pub mod referral;
pub mod referral_sys;
pub mod report;
pub mod reporting;
pub mod reserve;
pub mod reward;
pub mod rewards;
pub mod risk_engine;
pub mod scheduler;
pub mod secrets;
pub mod security;
pub mod service_mesh;
pub mod snapshot;
pub mod social;
pub mod spot_trading;
pub mod staking;
pub mod staking_node;
pub mod storage_engine;
pub mod sub;
pub mod throttle;
pub mod time_series_db;
pub mod trading_bots;
pub mod trading_pairs;
pub mod validators;
pub mod vault;
pub mod vol;
pub mod vote;
pub mod wallet_core;
pub mod wallet_service;
pub mod web3_svc;
pub mod webhook;


pub mod crypto {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use argon2::{password_hash::{PasswordHash, SaltString}, Argon2, PasswordHasher, PasswordVerifier};
    use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
    use rand::rngs::OsRng;
    use rand::RngCore;
    use sha2::{Digest, Sha256};

    /// Generate cryptographically secure random bytes
    pub fn generate_random_bytes(len: usize) -> Vec<u8> {
        let mut bytes = vec![0u8; len];
        OsRng.fill_bytes(&mut bytes);
        bytes
    }

    /// Hash password using Argon2id (memory-hard function)
    pub fn hash_password(password: &str) -> Result<String, String> {
        let argon2 = Argon2::default();
        let salt = SaltString::generate(&mut OsRng);
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Password hashing failed: {}", e))?;
        // Store the full PHC string, including algorithm, parameters, salt, and hash.
        Ok(hash.to_string())
    }

    /// Verify a password against its encoded Argon2 PHC string.
    pub fn verify_password(password: &str, encoded_hash: &str) -> Result<bool, String> {
        let parsed = PasswordHash::new(encoded_hash)
            .map_err(|e| format!("Invalid encoded password hash: {}", e))?;
        Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
    }

    /// Encrypt data with AES-256-GCM
    pub fn encrypt_aes_gcm(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Cipher error: {}", e))?;
            
        let nonce_bytes = generate_random_bytes(12);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encrypt error: {}", e))?;
            
        let mut result = nonce_bytes;
        result.extend(ciphertext);
        Ok(result)
    }

    /// Decrypt data with AES-256-GCM
    pub fn decrypt_aes_gcm(ciphertext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        if ciphertext.len() < 12 {
            return Err("Ciphertext too short".to_string());
        }
        
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Cipher error: {}", e))?;
            
        let nonce = Nonce::from_slice(&ciphertext[..12]);
        let encrypted = &ciphertext[12..];
        
        cipher
            .decrypt(nonce, encrypted)
            .map_err(|e| format!("Decrypt error: {}", e))
    }

    /// Generate Ed25519 keypair for signing
    pub fn generate_signing_keypair() -> (SigningKey, VerifyingKey) {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        (signing_key, verifying_key)
    }

    /// Sign data with Ed25519
    pub fn sign_ed25519(message: &[u8], signing_key: &SigningKey) -> Signature {
        signing_key.sign(message)
    }

    /// Verify Ed25519 signature
    pub fn verify_ed25519(message: &[u8], signature: &Signature, verifying_key: &VerifyingKey) -> bool {
        verifying_key.verify(message, signature).is_ok()
    }

    /// SHA-256 hash
    pub fn sha256(data: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher.finalize().into()
    }

    /// Constant-time comparison (prevent timing attacks)
    pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        a.iter().zip(b.iter()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
    }
}

pub mod hsm {
    //! Threshold secret sharing for cold-wallet key material.
    //! This is not a hardware security module integration.

    use rand::{rngs::OsRng, RngCore};

    pub struct ColdWallet {
        pub key_id: String,
        pub threshold: u8,
        pub total_shares: u8,
    }

    impl ColdWallet {
        pub fn new(threshold: u8, total: u8) -> Self {
            Self {
                key_id: format!("HSM-{}", hex::encode(rand::random::<[u8; 8]>())),
                threshold,
                total_shares: total,
            }
        }

        /// Generate Shamir shares over GF(256). Empty output means invalid
        /// parameters or a CSPRNG failure; callers must fail closed.
        pub fn generate_shares(&self, secret: &[u8], n: u8) -> Vec<Vec<u8>> {
            if secret.is_empty() || self.threshold == 0 || n < self.threshold || n == 0 || n > self.total_shares {
                return Vec::new();
            }
            let degree = self.threshold as usize - 1;
            let mut coefficients = vec![0u8; secret.len().saturating_mul(degree)];
            if OsRng.try_fill_bytes(&mut coefficients).is_err() {
                return Vec::new();
            }

            let mut shares = vec![vec![0u8; secret.len() + 1]; n as usize];
            for (index, share) in shares.iter_mut().enumerate() {
                let x = (index + 1) as u8;
                share[0] = x;
                for (byte_index, secret_byte) in secret.iter().enumerate() {
                    let mut y = *secret_byte;
                    let mut power = x;
                    for coefficient_index in 0..degree {
                        let coefficient = coefficients[byte_index * degree + coefficient_index];
                        y ^= gf_mul(coefficient, power);
                        power = gf_mul(power, x);
                    }
                    share[byte_index + 1] = y;
                }
            }
            shares
        }

        /// Reconstruct from any threshold-sized set of distinct shares.
        pub fn reconstruct(&self, shares: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
            let threshold = self.threshold as usize;
            if threshold == 0 || shares.len() < threshold {
                return Err("Not enough shares for the configured threshold".to_string());
            }
            let selected = &shares[..threshold];
            let share_len = selected[0].len();
            if share_len < 2 || selected.iter().any(|share| share.len() != share_len || share[0] == 0) {
                return Err("Invalid share format".to_string());
            }
            for i in 0..selected.len() {
                if selected[..i].iter().any(|previous| previous[0] == selected[i][0]) {
                    return Err("Duplicate share coordinate".to_string());
                }
            }

            let mut secret = vec![0u8; share_len - 1];
            for byte_index in 0..secret.len() {
                let mut value = 0u8;
                for i in 0..threshold {
                    let xi = selected[i][0];
                    let mut basis = 1u8;
                    for j in 0..threshold {
                        if i != j {
                            let xj = selected[j][0];
                            basis = gf_mul(basis, gf_mul(xj, gf_inv(xi ^ xj)));
                        }
                    }
                    value ^= gf_mul(selected[i][byte_index + 1], basis);
                }
                secret[byte_index] = value;
            }
            Ok(secret)
        }
    }

    fn gf_mul(mut a: u8, mut b: u8) -> u8 {
        let mut result = 0u8;
        for _ in 0..8 {
            if b & 1 != 0 { result ^= a; }
            let high_bit = a & 0x80;
            a <<= 1;
            if high_bit != 0 { a ^= 0x1b; }
            b >>= 1;
        }
        result
    }

    fn gf_pow(mut base: u8, mut exponent: u8) -> u8 {
        let mut result = 1u8;
        while exponent > 0 {
            if exponent & 1 != 0 { result = gf_mul(result, base); }
            base = gf_mul(base, base);
            exponent >>= 1;
        }
        result
    }

    fn gf_inv(value: u8) -> u8 {
        if value == 0 { 0 } else { gf_pow(value, 254) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn threshold_shares_reconstruct_from_any_quorum() {
            let wallet = ColdWallet::new(3, 5);
            let secret = b"custody-key-material";
            let shares = wallet.generate_shares(secret, 5);
            assert_eq!(shares.len(), 5);
            let recovered = wallet.reconstruct(vec![shares[0].clone(), shares[2].clone(), shares[4].clone()]).unwrap();
            assert_eq!(recovered, secret);
        }

        #[test]
        fn rejects_insufficient_and_duplicate_shares() {
            let wallet = ColdWallet::new(2, 3);
            let shares = wallet.generate_shares(b"secret", 3);
            assert!(wallet.reconstruct(vec![shares[0].clone()]).is_err());
            assert!(wallet.reconstruct(vec![shares[0].clone(), shares[0].clone()]).is_err());
        }

        #[test]
        fn rejects_invalid_share_parameters() {
            let wallet = ColdWallet::new(3, 5);
            assert!(wallet.generate_shares(b"secret", 2).is_empty());
        }
    }
}

pub mod orderbook {
    //! High-performance order matching engine (Rust for speed)
    
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum Side {
        Bid,
        Ask,
    }

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum OrderType {
        Market,
        Limit,
        StopLoss,
        StopLimit,
    }

    #[derive(Debug, Clone)]
    pub struct Order {
        pub id: String,
        pub user_id: String,
        pub symbol: String,
        pub side: Side,
        pub order_type: OrderType,
        pub quantity: f64,
        pub price: Option<f64>,
        pub stop_price: Option<f64>,
        pub filled: f64,
    }

    impl Order {
        pub fn new(
            id: String,
            user_id: String,
            symbol: String,
            side: Side,
            order_type: OrderType,
            quantity: f64,
            price: Option<f64>,
        ) -> Self {
            Self {
                id,
                user_id,
                symbol,
                side,
                order_type,
                quantity,
                price,
                stop_price: None,
                filled: 0.0,
            }
        }
    }

    pub struct OrderBook {
        pub symbol: String,
        pub bids: Vec<(f64, f64)>, // (price, quantity)
        pub asks: Vec<(f64, f64)>,
    }

    impl OrderBook {
        pub fn new(symbol: String) -> Self {
            Self {
                symbol,
                bids: Vec::new(),
                asks: Vec::new(),
            }
        }

        pub fn add_order(&mut self, order: &Order) {
            let price = order.price.unwrap_or(0.0);
            let qty = order.quantity - order.filled;
            
            // Sort and aggregate
            if order.side == Side::Bid {
                self.bids.push((price, qty));
                self.bids.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
            } else {
                self.asks.push((price, qty));
                self.asks.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            }
            
            self.optimize_book();
        }

        fn optimize_book(&mut self) {
            // Merge at same price level
            let mut merged: Vec<(f64, f64)> = Vec::new();
            for (price, qty) in &self.bids {
                if let Some(last) = merged.last_mut() {
                    if (last.0 - price).abs() < f64::EPSILON {
                        last.1 += qty;
                        continue;
                    }
                }
                merged.push((*price, *qty));
            }
            self.bids = merged;

            let mut merged: Vec<(f64, f64)> = Vec::new();
            for (price, qty) in &self.asks {
                if let Some(last) = merged.last_mut() {
                    if (last.0 - price).abs() < f64::EPSILON {
                        last.1 += qty;
                        continue;
                    }
                }
                merged.push((*price, *qty));
            }
            self.asks = merged;
        }

        pub fn match_orders(&mut self) -> Vec<(String, String, f64, f64)> {
            // Bids vs Asks matching
            let mut matches = Vec::new();
            
            while !self.bids.is_empty() && !self.asks.is_empty() {
                let (bid_price, bid_qty) = self.bids.first().unwrap();
                let (ask_price, ask_qty) = self.asks.first().unwrap();
                
                if bid_price >= ask_price {
                    let price = (bid_price + ask_price) / 2.0;
                    let qty = (*bid_qty).min(*ask_qty);
                    
                    matches.push((
                        format!("BID-{}", bid_price),
                        format!("ASK-{}", ask_price),
                        price,
                        qty,
                    ));
                    
                    if bid_qty < ask_qty {
                        self.asks.first_mut().unwrap().1 -= qty;
                        self.bids.remove(0);
                    } else if bid_qty > ask_qty {
                        self.bids.first_mut().unwrap().1 -= qty;
                        self.asks.remove(0);
                    } else {
                        self.bids.remove(0);
                        self.asks.remove(0);
                    }
                } else {
                    break;
                }
            }
            
            matches
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::orderbook::{Order, OrderBook, OrderType, Side};
    
    #[test]
    fn test_orderbook_match() {
        let mut book = OrderBook::new("BTC-USDT".to_string());
        
        // Add bid at 65000
        book.add_order(&Order::new(
            "bid1".to_string(),
            "user1".to_string(),
            "BTC-USDT".to_string(),
            Side::Bid,
            OrderType::Limit,
            1.0,
            Some(65000.0),
        ));
        
        // Add ask at 64900
        book.add_order(&Order::new(
            "ask1".to_string(),
            "user2".to_string(),
            "BTC-USDT".to_string(),
            Side::Ask,
            OrderType::Limit,
            1.0,
            Some(64900.0),
        ));
        
        // Should match
        assert!(!book.match_orders().is_empty());
    }
}

#[cfg(test)]
mod password_hash_tests {
    use super::crypto::{hash_password, verify_password};

    #[test]
    fn argon2_hash_is_stored_and_verified() {
        let encoded = hash_password("A-long-test-password-91!").expect("hash should succeed");
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify_password("A-long-test-password-91!", &encoded).unwrap());
        assert!(!verify_password("wrong-password", &encoded).unwrap());
    }
}
