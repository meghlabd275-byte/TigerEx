//! Sub-accounts under a parent user.
//!
//! The previous implementation derived ids from the sub-account count, so ids
//! were reused after any sub-account was removed, and it imposed no limit on
//! how many a parent could create.

use std::collections::HashMap;
use std::sync::RwLock;

/// Maximum sub-accounts per parent.
pub const MAX_SUBACCOUNTS: usize = 300;

#[derive(Debug, Clone, PartialEq)]
pub struct Subaccount {
    pub id: String,
    pub parent_id: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SubaccountError {
    EmptyParent,
    EmptyName,
    DuplicateName(String),
    LimitReached(usize),
    UnknownSubaccount(String),
    UnknownParent(String),
}

impl std::fmt::Display for SubaccountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SubaccountError::EmptyParent => write!(f, "parent id must not be empty"),
            SubaccountError::EmptyName => write!(f, "sub-account name must not be empty"),
            SubaccountError::DuplicateName(n) => write!(f, "sub-account {n} already exists"),
            SubaccountError::LimitReached(max) => {
                write!(f, "a parent may hold at most {max} sub-accounts")
            }
            SubaccountError::UnknownSubaccount(id) => write!(f, "unknown sub-account: {id}"),
            SubaccountError::UnknownParent(id) => write!(f, "unknown parent: {id}"),
        }
    }
}

impl std::error::Error for SubaccountError {}

pub struct SubaccountService {
    subaccounts: RwLock<HashMap<String, Subaccount>>,
    next_id: RwLock<u64>,
}

impl SubaccountService {
    pub fn new() -> Self {
        Self {
            subaccounts: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Create a sub-account. Names are unique within a parent and the parent
    /// may hold at most `MAX_SUBACCOUNTS`.
    pub fn create(&self, parent_id: &str, name: &str) -> Result<String, SubaccountError> {
        if parent_id.trim().is_empty() {
            return Err(SubaccountError::EmptyParent);
        }
        if name.trim().is_empty() {
            return Err(SubaccountError::EmptyName);
        }

        let mut subaccounts = self.subaccounts.write().unwrap();
        let existing: Vec<&Subaccount> = subaccounts
            .values()
            .filter(|s| s.parent_id == parent_id)
            .collect();

        if existing.len() >= MAX_SUBACCOUNTS {
            return Err(SubaccountError::LimitReached(MAX_SUBACCOUNTS));
        }
        if existing.iter().any(|s| s.name == name) {
            return Err(SubaccountError::DuplicateName(name.to_string()));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("sub_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        subaccounts.insert(
            id.clone(),
            Subaccount {
                id: id.clone(),
                parent_id: parent_id.to_string(),
                name: name.to_string(),
                enabled: true,
            },
        );
        Ok(id)
    }

    fn set_enabled(&self, id: &str, enabled: bool) -> Result<Subaccount, SubaccountError> {
        let mut subaccounts = self.subaccounts.write().unwrap();
        let sub = subaccounts
            .get_mut(id)
            .ok_or_else(|| SubaccountError::UnknownSubaccount(id.to_string()))?;
        sub.enabled = enabled;
        Ok(sub.clone())
    }

    pub fn disable(&self, subaccount_id: &str) -> Result<Subaccount, SubaccountError> {
        self.set_enabled(subaccount_id, false)
    }

    pub fn enable(&self, subaccount_id: &str) -> Result<Subaccount, SubaccountError> {
        self.set_enabled(subaccount_id, true)
    }

    pub fn get(&self, subaccount_id: &str) -> Option<Subaccount> {
        self.subaccounts.read().unwrap().get(subaccount_id).cloned()
    }

    /// Sub-accounts belonging to a parent.
    pub fn list(&self, parent_id: &str) -> Vec<Subaccount> {
        let mut subs: Vec<Subaccount> = self
            .subaccounts
            .read()
            .unwrap()
            .values()
            .filter(|s| s.parent_id == parent_id)
            .cloned()
            .collect();
        subs.sort_by(|a, b| a.id.cmp(&b.id));
        subs
    }
}

impl Default for SubaccountService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subaccounts_are_scoped_to_their_parent() {
        let svc = SubaccountService::new();
        svc.create("parent1", "trading").unwrap();
        svc.create("parent2", "trading").unwrap();

        // The same name is fine under a different parent.
        assert_eq!(svc.list("parent1").len(), 1);
        assert_eq!(svc.list("parent2").len(), 1);
    }

    #[test]
    fn duplicate_names_within_a_parent_are_rejected() {
        let svc = SubaccountService::new();
        svc.create("parent1", "trading").unwrap();
        assert!(matches!(
            svc.create("parent1", "trading").unwrap_err(),
            SubaccountError::DuplicateName(_)
        ));
    }

    #[test]
    fn invalid_names_and_parents_are_rejected() {
        let svc = SubaccountService::new();
        assert!(svc.create("", "trading").is_err());
        assert!(svc.create("parent1", "").is_err());
        assert!(svc.create("  ", "trading").is_err());
    }

    #[test]
    fn the_subaccount_limit_is_enforced() {
        let svc = SubaccountService::new();
        for i in 0..MAX_SUBACCOUNTS {
            svc.create("parent1", &format!("sub{i}")).unwrap();
        }
        assert!(matches!(
            svc.create("parent1", "one_too_many").unwrap_err(),
            SubaccountError::LimitReached(_)
        ));
    }

    #[test]
    fn enable_and_disable_round_trip() {
        let svc = SubaccountService::new();
        let id = svc.create("parent1", "trading").unwrap();

        assert!(!svc.disable(&id).unwrap().enabled);
        assert!(!svc.get(&id).unwrap().enabled);
        assert!(svc.enable(&id).unwrap().enabled);
        assert!(svc.disable("sub_missing").is_err());
    }

    #[test]
    fn ids_are_unique_and_not_reused() {
        let svc = SubaccountService::new();
        let a = svc.create("parent1", "a").unwrap();
        let b = svc.create("parent1", "b").unwrap();

        // The old id was the sub-account count, so ids collided or repeated.
        assert_ne!(a, b);
        assert!(svc.get(&a).is_some());
        assert!(svc.get(&b).is_some());
    }
}
