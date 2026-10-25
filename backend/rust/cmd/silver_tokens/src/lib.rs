//! Tokenized silver.
//!
//! The previous implementation had a hardcoded 500,000 oz reserve, `mint`
//! credited the reserve without validation (a negative amount drained it), and
//! `redeem` returned a constant 50.0 for any token id and never checked the
//! reserve, so tokens could be redeemed twice or for the wrong size.

use std::collections::HashMap;
use std::sync::RwLock;

/// Troy ounces backing one token.
pub const OZ_PER_TOKEN: f64 = 1.0;

#[derive(Debug, Clone, PartialEq)]
pub enum SilverError {
    InvalidAmount(f64),
    UnknownToken(String),
    InsufficientReserve { requested: f64, available: f64 },
    AlreadyRedeemed(String),
}

impl std::fmt::Display for SilverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SilverError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            SilverError::UnknownToken(t) => write!(f, "unknown token: {t}"),
            SilverError::InsufficientReserve { requested, available } => write!(
                f,
                "requested {requested} oz exceeds the {available} oz reserve"
            ),
            SilverError::AlreadyRedeemed(t) => write!(f, "token {t} was already redeemed"),
        }
    }
}

impl std::error::Error for SilverError {}

#[derive(Debug, Clone, PartialEq)]
pub struct SilverToken {
    pub id: String,
    pub ounces: f64,
    pub redeemed: bool,
}

pub struct SilverTokenService {
    reserves: RwLock<f64>,
    tokens: RwLock<HashMap<String, SilverToken>>,
    next_id: RwLock<u64>,
}

impl SilverTokenService {
    pub fn new(initial_reserve_oz: f64) -> Self {
        Self {
            reserves: RwLock::new(initial_reserve_oz.max(0.0)),
            tokens: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Mint a token backed by `oz` ounces of silver.
    ///
    /// Rejects non-finite and non-positive amounts, and requires the reserve to
    /// actually cover the new token.
    pub fn mint(&self, oz: f64) -> Result<String, SilverError> {
        if !oz.is_finite() || oz <= 0.0 {
            return Err(SilverError::InvalidAmount(oz));
        }

        let mut reserves = self.reserves.write().unwrap();
        if *reserves < oz {
            return Err(SilverError::InsufficientReserve {
                requested: oz,
                available: *reserves,
            });
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("xag_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        *reserves -= oz;
        drop(reserves);

        self.tokens.write().unwrap().insert(
            id.clone(),
            SilverToken {
                id: id.clone(),
                ounces: oz,
                redeemed: false,
            },
        );
        Ok(id)
    }

    /// Redeem a token, returning the ounces it represents.
    pub fn redeem(&self, token_id: &str) -> Result<f64, SilverError> {
        let mut tokens = self.tokens.write().unwrap();
        let token = tokens
            .get_mut(token_id)
            .ok_or_else(|| SilverError::UnknownToken(token_id.to_string()))?;

        if token.redeemed {
            return Err(SilverError::AlreadyRedeemed(token_id.to_string()));
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

    pub fn token(&self, token_id: &str) -> Option<SilverToken> {
        self.tokens.read().unwrap().get(token_id).cloned()
    }
}

impl Default for SilverTokenService {
    fn default() -> Self {
        Self::new(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_moves_ounces_from_the_reserve_into_the_token() {
        let svc = SilverTokenService::new(1_000.0);
        let id = svc.mint(100.0).unwrap();

        assert_eq!(svc.get_reserve(), 900.0);
        assert_eq!(svc.token(&id).unwrap().ounces, 100.0);
    }

    #[test]
    fn negative_and_non_finite_mints_are_rejected() {
        let svc = SilverTokenService::new(1_000.0);
        // The old implementation added a negative amount straight to the reserve.
        assert!(svc.mint(-100.0).is_err());
        assert!(svc.mint(f64::NAN).is_err());
        assert_eq!(svc.get_reserve(), 1_000.0);
    }

    #[test]
    fn minting_beyond_the_reserve_fails() {
        let svc = SilverTokenService::new(50.0);
        assert!(matches!(
            svc.mint(100.0).unwrap_err(),
            SilverError::InsufficientReserve { .. }
        ));
        assert_eq!(svc.get_reserve(), 50.0);
    }

    #[test]
    fn redeem_returns_the_token_size_not_a_constant() {
        let svc = SilverTokenService::new(1_000.0);
        let small = svc.mint(10.0).unwrap();
        let large = svc.mint(250.0).unwrap();

        // The old implementation returned 50.0 for every token.
        assert_eq!(svc.redeem(&small).unwrap(), 10.0);
        assert_eq!(svc.redeem(&large).unwrap(), 250.0);
        assert_eq!(svc.get_reserve(), 1_000.0 - 10.0 - 250.0 + 10.0 + 250.0);
    }

    #[test]
    fn double_redeem_and_unknown_tokens_are_rejected() {
        let svc = SilverTokenService::new(1_000.0);
        let id = svc.mint(100.0).unwrap();

        svc.redeem(&id).unwrap();
        assert_eq!(
            svc.redeem(&id).unwrap_err(),
            SilverError::AlreadyRedeemed(id.clone())
        );
        assert!(matches!(
            svc.redeem("xag_missing").unwrap_err(),
            SilverError::UnknownToken(_)
        ));
    }
}
