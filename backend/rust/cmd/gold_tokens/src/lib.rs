//! Tokenized gold.
//!
//! The previous implementation had a hardcoded 100,000 oz reserve, `mint`
//! credited the reserve without validation, and `redeem` returned a constant
//! 10.0 for any token id, never checking the reserve or whether the token had
//! already been redeemed.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum GoldError {
    InvalidAmount(f64),
    UnknownToken(String),
    InsufficientReserve { requested: f64, available: f64 },
    AlreadyRedeemed(String),
}

impl std::fmt::Display for GoldError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GoldError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            GoldError::UnknownToken(t) => write!(f, "unknown token: {t}"),
            GoldError::InsufficientReserve { requested, available } => write!(
                f,
                "requested {requested} oz exceeds the {available} oz reserve"
            ),
            GoldError::AlreadyRedeemed(t) => write!(f, "token {t} was already redeemed"),
        }
    }
}

impl std::error::Error for GoldError {}

#[derive(Debug, Clone, PartialEq)]
pub struct GoldToken {
    pub id: String,
    pub ounces: f64,
    pub redeemed: bool,
}

pub struct GoldTokenService {
    reserves: RwLock<f64>,
    tokens: RwLock<HashMap<String, GoldToken>>,
    next_id: RwLock<u64>,
}

impl GoldTokenService {
    pub fn new(initial_reserve_oz: f64) -> Self {
        Self {
            reserves: RwLock::new(initial_reserve_oz.max(0.0)),
            tokens: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Mint a token backed by `oz` ounces of gold.
    pub fn mint(&self, oz: f64) -> Result<String, GoldError> {
        if !oz.is_finite() || oz <= 0.0 {
            return Err(GoldError::InvalidAmount(oz));
        }

        let mut reserves = self.reserves.write().unwrap();
        if *reserves < oz {
            return Err(GoldError::InsufficientReserve {
                requested: oz,
                available: *reserves,
            });
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("xau_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        *reserves -= oz;
        drop(reserves);

        self.tokens.write().unwrap().insert(
            id.clone(),
            GoldToken {
                id: id.clone(),
                ounces: oz,
                redeemed: false,
            },
        );
        Ok(id)
    }

    /// Redeem a token, returning the ounces it represents.
    pub fn redeem(&self, token_id: &str) -> Result<f64, GoldError> {
        let mut tokens = self.tokens.write().unwrap();
        let token = tokens
            .get_mut(token_id)
            .ok_or_else(|| GoldError::UnknownToken(token_id.to_string()))?;

        if token.redeemed {
            return Err(GoldError::AlreadyRedeemed(token_id.to_string()));
        }
        token.redeemed = true;
        let ounces = token.ounces;
        drop(tokens);

        *self.reserves.write().unwrap() += ounces;
        Ok(ounces)
    }

    pub fn get_reserve(&self) -> f64 {
        *self.reserves.read().unwrap()
    }

    pub fn token(&self, token_id: &str) -> Option<GoldToken> {
        self.tokens.read().unwrap().get(token_id).cloned()
    }
}

impl Default for GoldTokenService {
    fn default() -> Self {
        Self::new(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_moves_ounces_from_the_reserve_into_the_token() {
        let svc = GoldTokenService::new(1_000.0);
        let id = svc.mint(100.0).unwrap();

        assert_eq!(svc.get_reserve(), 900.0);
        assert_eq!(svc.token(&id).unwrap().ounces, 100.0);
    }

    #[test]
    fn negative_and_non_finite_mints_are_rejected() {
        let svc = GoldTokenService::new(1_000.0);
        assert!(svc.mint(-100.0).is_err());
        assert!(svc.mint(f64::NAN).is_err());
        assert_eq!(svc.get_reserve(), 1_000.0);
    }

    #[test]
    fn minting_beyond_the_reserve_fails() {
        let svc = GoldTokenService::new(50.0);
        assert!(matches!(
            svc.mint(100.0).unwrap_err(),
            GoldError::InsufficientReserve { .. }
        ));
    }

    #[test]
    fn redeem_returns_the_token_size_not_a_constant() {
        let svc = GoldTokenService::new(1_000.0);
        let small = svc.mint(5.0).unwrap();
        let large = svc.mint(200.0).unwrap();

        // The old implementation returned 10.0 for every token.
        assert_eq!(svc.redeem(&small).unwrap(), 5.0);
        assert_eq!(svc.redeem(&large).unwrap(), 200.0);
    }

    #[test]
    fn double_redeem_and_unknown_tokens_are_rejected() {
        let svc = GoldTokenService::new(1_000.0);
        let id = svc.mint(100.0).unwrap();

        svc.redeem(&id).unwrap();
        assert_eq!(
            svc.redeem(&id).unwrap_err(),
            GoldError::AlreadyRedeemed(id.clone())
        );
        assert!(svc.redeem("xau_missing").is_err());
    }
}
