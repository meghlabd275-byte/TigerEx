//! Margin positions.
//!
//! The previous implementation derived ids from the position count (so ids
//! were reused after a close), accepted any size, entry and side, and
//! computed PnL as `(exit - entry) * size`, ignoring leverage and treating
//! `size` as both quantity and notional.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MarginPos {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub side: Side,
    /// Quantity of the asset.
    pub quantity: f64,
    pub leverage: u32,
    pub entry: f64,
    /// Margin posted by the user.
    pub margin: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarginError {
    EmptyUser,
    EmptyAsset,
    InvalidQuantity(f64),
    InvalidEntry(f64),
    InvalidLeverage(u32),
    LeverageTooHigh { requested: u32, max: u32 },
    InvalidExit(f64),
    UnknownPosition(String),
}

impl std::fmt::Display for MarginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MarginError::EmptyUser => write!(f, "user id must not be empty"),
            MarginError::EmptyAsset => write!(f, "asset must not be empty"),
            MarginError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
            MarginError::InvalidEntry(e) => write!(f, "entry price {e} must be finite and positive"),
            MarginError::InvalidLeverage(l) => write!(f, "leverage {l} must be at least 1"),
            MarginError::LeverageTooHigh { requested, max } => {
                write!(f, "leverage {requested} exceeds the maximum of {max}")
            }
            MarginError::InvalidExit(e) => write!(f, "exit price {e} must be finite and positive"),
            MarginError::UnknownPosition(id) => write!(f, "unknown position: {id}"),
        }
    }
}

impl std::error::Error for MarginError {}

pub struct MarginTradingService {
    positions: RwLock<HashMap<String, MarginPos>>,
    max_leverage: u32,
    next_id: RwLock<u64>,
}

impl MarginTradingService {
    pub fn new(max_leverage: u32) -> Self {
        Self {
            positions: RwLock::new(HashMap::new()),
            max_leverage,
            next_id: RwLock::new(1),
        }
    }

    /// Open a margin position.
    ///
    /// Margin is notional divided by leverage; the notional is quantity times
    /// entry price.
    pub fn open(
        &self,
        user_id: &str,
        asset: &str,
        side: Side,
        quantity: f64,
        leverage: u32,
        entry: f64,
    ) -> Result<MarginPos, MarginError> {
        if user_id.trim().is_empty() {
            return Err(MarginError::EmptyUser);
        }
        if asset.trim().is_empty() {
            return Err(MarginError::EmptyAsset);
        }
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(MarginError::InvalidQuantity(quantity));
        }
        if !entry.is_finite() || entry <= 0.0 {
            return Err(MarginError::InvalidEntry(entry));
        }
        if leverage == 0 {
            return Err(MarginError::InvalidLeverage(leverage));
        }
        if leverage > self.max_leverage {
            return Err(MarginError::LeverageTooHigh {
                requested: leverage,
                max: self.max_leverage,
            });
        }

        let notional = quantity * entry;
        let margin = notional / f64::from(leverage);

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("mt_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let position = MarginPos {
            id: id.clone(),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            side,
            quantity,
            leverage,
            entry,
            margin,
        };
        self.positions
            .write()
            .unwrap()
            .insert(id, position.clone());
        Ok(position)
    }

    /// Close a position at `exit`, returning the PnL on the notional.
    pub fn close(&self, pos_id: &str, exit: f64) -> Result<f64, MarginError> {
        if !exit.is_finite() || exit <= 0.0 {
            return Err(MarginError::InvalidExit(exit));
        }
        let mut positions = self.positions.write().unwrap();
        let position = positions
            .remove(pos_id)
            .ok_or_else(|| MarginError::UnknownPosition(pos_id.to_string()))?;

        let pnl = match position.side {
            Side::Long => (exit - position.entry) * position.quantity,
            Side::Short => (position.entry - exit) * position.quantity,
        };
        Ok(pnl)
    }

    /// PnL a position would realise at `mark`, without closing it.
    pub fn unrealized_pnl(&self, pos_id: &str, mark: f64) -> Result<f64, MarginError> {
        if !mark.is_finite() || mark <= 0.0 {
            return Err(MarginError::InvalidExit(mark));
        }
        let positions = self.positions.read().unwrap();
        let position = positions
            .get(pos_id)
            .ok_or_else(|| MarginError::UnknownPosition(pos_id.to_string()))?;
        Ok(match position.side {
            Side::Long => (mark - position.entry) * position.quantity,
            Side::Short => (position.entry - mark) * position.quantity,
        })
    }

    pub fn position(&self, id: &str) -> Option<MarginPos> {
        self.positions.read().unwrap().get(id).cloned()
    }

    pub fn open_count(&self) -> usize {
        self.positions.read().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn margin_is_notional_over_leverage() {
        let svc = MarginTradingService::new(10);
        let p = svc
            .open("alice", "BTC", Side::Long, 0.1, 10, 50_000.0)
            .unwrap();

        // Notional 5,000 at 10x -> 500 margin.
        assert_eq!(p.margin, 500.0);
    }

    #[test]
    fn long_and_short_pnl_have_opposite_signs() {
        let svc = MarginTradingService::new(10);
        let long = svc
            .open("alice", "BTC", Side::Long, 1.0, 5, 100.0)
            .unwrap();
        let short = svc
            .open("bob", "BTC", Side::Short, 1.0, 5, 100.0)
            .unwrap();

        assert_eq!(svc.close(&long.id, 110.0).unwrap(), 10.0);
        assert_eq!(svc.close(&short.id, 110.0).unwrap(), -10.0);
    }

    #[test]
    fn leverage_is_capped() {
        let svc = MarginTradingService::new(10);
        assert!(matches!(
            svc.open("alice", "BTC", Side::Long, 1.0, 20, 100.0).unwrap_err(),
            MarginError::LeverageTooHigh { .. }
        ));
        assert!(svc.open("alice", "BTC", Side::Long, 1.0, 0, 100.0).is_err());
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = MarginTradingService::new(10);
        assert!(svc.open("", "BTC", Side::Long, 1.0, 5, 100.0).is_err());
        assert!(svc.open("alice", "", Side::Long, 1.0, 5, 100.0).is_err());
        assert!(svc.open("alice", "BTC", Side::Long, -1.0, 5, 100.0).is_err());
        assert!(svc.open("alice", "BTC", Side::Long, 1.0, 5, f64::NAN).is_err());
        assert_eq!(svc.open_count(), 0);
    }

    #[test]
    fn ids_are_unique_and_not_reused() {
        let svc = MarginTradingService::new(10);
        let a = svc.open("alice", "BTC", Side::Long, 1.0, 5, 100.0).unwrap();
        svc.close(&a.id, 110.0).unwrap();
        let b = svc.open("alice", "BTC", Side::Long, 1.0, 5, 100.0).unwrap();

        // The old id was the position count, so b reused a's id.
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn closing_an_unknown_position_is_rejected() {
        let svc = MarginTradingService::new(10);
        assert!(svc.close("mt_missing", 100.0).is_err());
        assert!(svc.unrealized_pnl("mt_missing", 100.0).is_err());
    }
}
