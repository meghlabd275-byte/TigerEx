//! Social (copy) trading strategies.
//!
//! The previous implementation derived the strategy id from its name, so two
//! strategies with the same name (by different traders) collided and the
//! second silently overwrote the first, and it let a trader copy their own
//! strategy.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Strategy {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub copiers: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SocialError {
    EmptyName,
    EmptyUser,
    DuplicateName(String),
    UnknownStrategy(String),
    CannotCopyOwn,
    AlreadyCopying,
    NotCopying,
}

impl std::fmt::Display for SocialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SocialError::EmptyName => write!(f, "strategy name must not be empty"),
            SocialError::EmptyUser => write!(f, "user id must not be empty"),
            SocialError::DuplicateName(n) => {
                write!(f, "this trader already has a strategy named {n}")
            }
            SocialError::UnknownStrategy(id) => write!(f, "unknown strategy: {id}"),
            SocialError::CannotCopyOwn => write!(f, "a trader cannot copy their own strategy"),
            SocialError::AlreadyCopying => write!(f, "already copying this strategy"),
            SocialError::NotCopying => write!(f, "not copying this strategy"),
        }
    }
}

impl std::error::Error for SocialError {}

pub struct SocialTradingService {
    strategies: RwLock<HashMap<String, Strategy>>,
    /// strategy id -> set of copier user ids.
    copiers: RwLock<HashMap<String, Vec<String>>>,
    next_id: RwLock<u64>,
}

impl SocialTradingService {
    pub fn new() -> Self {
        Self {
            strategies: RwLock::new(HashMap::new()),
            copiers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Publish a strategy. Names are unique per trader.
    pub fn create_strategy(&self, user_id: &str, name: &str) -> Result<String, SocialError> {
        if user_id.trim().is_empty() {
            return Err(SocialError::EmptyUser);
        }
        if name.trim().is_empty() {
            return Err(SocialError::EmptyName);
        }

        let strategies = self.strategies.read().unwrap();
        if strategies
            .values()
            .any(|s| s.user_id == user_id && s.name == name)
        {
            return Err(SocialError::DuplicateName(name.to_string()));
        }
        drop(strategies);

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("strat_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.strategies.write().unwrap().insert(
            id.clone(),
            Strategy {
                id: id.clone(),
                user_id: user_id.to_string(),
                name: name.to_string(),
                copiers: 0,
            },
        );
        Ok(id)
    }

    /// Start copying a strategy. A trader cannot copy their own, and a user
    /// cannot start the same copy twice.
    pub fn copy_strategy(&self, user_id: &str, strategy_id: &str) -> Result<(), SocialError> {
        let owner = {
            let strategies = self.strategies.read().unwrap();
            strategies
                .get(strategy_id)
                .map(|s| s.user_id.clone())
                .ok_or_else(|| SocialError::UnknownStrategy(strategy_id.to_string()))?
        };

        if owner == user_id {
            return Err(SocialError::CannotCopyOwn);
        }

        let mut copiers = self.copiers.write().unwrap();
        let entry = copiers.entry(strategy_id.to_string()).or_default();
        if entry.contains(&user_id.to_string()) {
            return Err(SocialError::AlreadyCopying);
        }
        entry.push(user_id.to_string());
        drop(copiers);

        if let Some(strategy) = self.strategies.write().unwrap().get_mut(strategy_id) {
            strategy.copiers += 1;
        }
        Ok(())
    }

    /// Stop copying a strategy.
    pub fn stop_copying(&self, user_id: &str, strategy_id: &str) -> Result<(), SocialError> {
        let mut copiers = self.copiers.write().unwrap();
        let entry = copiers
            .get_mut(strategy_id)
            .ok_or_else(|| SocialError::UnknownStrategy(strategy_id.to_string()))?;
        let pos = entry
            .iter()
            .position(|u| u == user_id)
            .ok_or(SocialError::NotCopying)?;
        entry.remove(pos);
        drop(copiers);

        if let Some(strategy) = self.strategies.write().unwrap().get_mut(strategy_id) {
            strategy.copiers = strategy.copiers.saturating_sub(1);
        }
        Ok(())
    }

    pub fn get_strategies(&self) -> Vec<Strategy> {
        self.strategies.read().unwrap().values().cloned().collect()
    }

    pub fn strategy(&self, id: &str) -> Option<Strategy> {
        self.strategies.read().unwrap().get(id).cloned()
    }

    pub fn copiers_of(&self, strategy_id: &str) -> Vec<String> {
        self.copiers
            .read()
            .unwrap()
            .get(strategy_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for SocialTradingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_named_strategies_by_different_traders_do_not_collide() {
        let svc = SocialTradingService::new();
        let a = svc.create_strategy("alice", "Momentum").unwrap();
        let b = svc.create_strategy("bob", "Momentum").unwrap();

        // The old id was the name, so b overwrote a.
        assert_ne!(a, b);
        assert_eq!(svc.strategy(&a).unwrap().user_id, "alice");
        assert_eq!(svc.strategy(&b).unwrap().user_id, "bob");
    }

    #[test]
    fn duplicate_names_per_trader_are_rejected() {
        let svc = SocialTradingService::new();
        svc.create_strategy("alice", "Momentum").unwrap();
        assert!(matches!(
            svc.create_strategy("alice", "Momentum").unwrap_err(),
            SocialError::DuplicateName(_)
        ));
    }

    #[test]
    fn a_trader_cannot_copy_their_own_strategy() {
        let svc = SocialTradingService::new();
        let id = svc.create_strategy("alice", "Momentum").unwrap();
        assert!(matches!(
            svc.copy_strategy("alice", &id).unwrap_err(),
            SocialError::CannotCopyOwn
        ));
    }

    #[test]
    fn copying_is_idempotent_per_user() {
        let svc = SocialTradingService::new();
        let id = svc.create_strategy("alice", "Momentum").unwrap();

        svc.copy_strategy("bob", &id).unwrap();
        assert_eq!(svc.strategy(&id).unwrap().copiers, 1);

        // The old implementation incremented on every call.
        assert!(matches!(
            svc.copy_strategy("bob", &id).unwrap_err(),
            SocialError::AlreadyCopying
        ));
        assert_eq!(svc.strategy(&id).unwrap().copiers, 1);

        svc.copy_strategy("carol", &id).unwrap();
        assert_eq!(svc.strategy(&id).unwrap().copiers, 2);
        assert_eq!(svc.copiers_of(&id).len(), 2);
    }

    #[test]
    fn stopping_a_copy_decrements_the_count() {
        let svc = SocialTradingService::new();
        let id = svc.create_strategy("alice", "Momentum").unwrap();
        svc.copy_strategy("bob", &id).unwrap();

        svc.stop_copying("bob", &id).unwrap();
        assert_eq!(svc.strategy(&id).unwrap().copiers, 0);
        assert!(matches!(
            svc.stop_copying("bob", &id).unwrap_err(),
            SocialError::NotCopying
        ));
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = SocialTradingService::new();
        assert!(svc.create_strategy("", "Momentum").is_err());
        assert!(svc.create_strategy("alice", "").is_err());
        assert!(svc.copy_strategy("bob", "strat_missing").is_err());
    }
}
