//! Schema migration planning and application.
//!
//! The previous implementation returned formatted strings
//! (`"migrated_to_<version>"`, `"rolled_back_to_<version>"`) without tracking
//! any state, validating versions, or refusing a rollback that would skip
//! applied migrations.

use std::collections::BTreeMap;
use std::sync::RwLock;

/// A registered migration.
#[derive(Debug, Clone, PartialEq)]
pub struct Migration {
    /// Monotonic version number.
    pub version: u64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MigrationError {
    EmptyName,
    DuplicateVersion(u64),
    UnknownVersion(u64),
    NotApplied(u64),
    WouldSkipApplied { target: u64, applied: u64 },
    OutOfOrder { target: u64, latest: u64 },
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MigrationError::EmptyName => write!(f, "migration name must not be empty"),
            MigrationError::DuplicateVersion(v) => write!(f, "version {v} is already registered"),
            MigrationError::UnknownVersion(v) => write!(f, "version {v} is not registered"),
            MigrationError::NotApplied(v) => write!(f, "version {v} has not been applied"),
            MigrationError::WouldSkipApplied { target, applied } => write!(
                f,
                "rolling back to {target} would discard applied migration {applied}"
            ),
            MigrationError::OutOfOrder { target, latest } => write!(
                f,
                "cannot apply {target} while {latest} is the highest registered version"
            ),
        }
    }
}

impl std::error::Error for MigrationError {}

pub struct MigrationService {
    /// Registered migrations, keyed by version.
    registered: RwLock<BTreeMap<u64, Migration>>,
    /// Applied versions, in application order.
    applied: RwLock<Vec<u64>>,
}

impl MigrationService {
    pub fn new() -> Self {
        Self {
            registered: RwLock::new(BTreeMap::new()),
            applied: RwLock::new(Vec::new()),
        }
    }

    /// Register a migration. Versions are unique.
    pub fn register(&self, version: u64, name: &str) -> Result<(), MigrationError> {
        if name.trim().is_empty() {
            return Err(MigrationError::EmptyName);
        }
        let mut registered = self.registered.write().unwrap();
        if registered.contains_key(&version) {
            return Err(MigrationError::DuplicateVersion(version));
        }
        registered.insert(
            version,
            Migration {
                version,
                name: name.to_string(),
            },
        );
        Ok(())
    }

    /// Apply every registered migration above the latest applied one, in
    /// version order. Returns the versions applied, in order.
    pub fn run(&self) -> Result<Vec<u64>, MigrationError> {
        let registered = self.registered.read().unwrap();
        let mut applied = self.applied.write().unwrap();
        let last = applied.last().copied().unwrap_or(0);

        let pending: Vec<u64> = registered
            .keys()
            .copied()
            .filter(|v| *v > last)
            .collect();

        for version in &pending {
            applied.push(*version);
        }
        Ok(pending)
    }

    /// Apply a single specific version, which must be the next one in order.
    pub fn run_one(&self, version: u64) -> Result<(), MigrationError> {
        let registered = self.registered.read().unwrap();
        if !registered.contains_key(&version) {
            return Err(MigrationError::UnknownVersion(version));
        }
        drop(registered);

        let mut applied = self.applied.write().unwrap();
        let last = applied.last().copied().unwrap_or(0);
        if applied.contains(&version) {
            return Err(MigrationError::DuplicateVersion(version));
        }
        let next = {
            let registered = self.registered.read().unwrap();
            registered
                .keys()
                .copied()
                .find(|v| *v > last)
                .ok_or(MigrationError::UnknownVersion(version))?
        };
        if next != version {
            return Err(MigrationError::OutOfOrder {
                target: version,
                latest: last,
            });
        }
        applied.push(version);
        Ok(())
    }

    /// Roll back to a target version, discarding every migration applied after
    /// it. The target must itself have been applied.
    pub fn rollback(&self, target: u64) -> Result<Vec<u64>, MigrationError> {
        let mut applied = self.applied.write().unwrap();
        if !applied.contains(&target) {
            return Err(MigrationError::NotApplied(target));
        }

        let mut removed = Vec::new();
        while applied.last().copied().map(|v| v > target).unwrap_or(false) {
            removed.push(applied.pop().expect("checked above"));
        }
        removed.reverse();
        Ok(removed)
    }

    /// The highest applied version, or 0 when none have been applied.
    pub fn current_version(&self) -> u64 {
        self.applied.read().unwrap().last().copied().unwrap_or(0)
    }

    pub fn applied_versions(&self) -> Vec<u64> {
        self.applied.read().unwrap().clone()
    }
}

impl Default for MigrationService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> MigrationService {
        let s = MigrationService::new();
        s.register(1, "create_users").unwrap();
        s.register(2, "add_kyc").unwrap();
        s.register(3, "add_orders").unwrap();
        s
    }

    #[test]
    fn running_applies_pending_migrations_in_order() {
        let svc = svc();
        // The old implementation returned a string and tracked nothing.
        assert_eq!(svc.current_version(), 0);

        let applied = svc.run().unwrap();
        assert_eq!(applied, vec![1, 2, 3]);
        assert_eq!(svc.current_version(), 3);

        // Running again applies nothing.
        assert!(svc.run().unwrap().is_empty());
    }

    #[test]
    fn rollback_discards_later_migrations() {
        let svc = svc();
        svc.run().unwrap();

        let removed = svc.rollback(1).unwrap();
        assert_eq!(removed, vec![2, 3]);
        assert_eq!(svc.current_version(), 1);
        assert_eq!(svc.applied_versions(), vec![1]);
    }

    #[test]
    fn rollback_to_an_unapplied_version_is_rejected() {
        let svc = svc();
        svc.register(4, "later").unwrap();
        svc.run_one(1).unwrap();

        assert!(matches!(
            svc.rollback(4).unwrap_err(),
            MigrationError::NotApplied(4)
        ));
        assert_eq!(svc.current_version(), 1);
    }

    #[test]
    fn run_one_enforces_order() {
        let svc = svc();
        // Cannot jump to version 2 before version 1.
        assert!(matches!(
            svc.run_one(2).unwrap_err(),
            MigrationError::OutOfOrder { .. }
        ));
        svc.run_one(1).unwrap();
        svc.run_one(2).unwrap();
        assert_eq!(svc.current_version(), 2);

        // Re-applying an applied version is rejected.
        assert!(svc.run_one(1).is_err());
    }

    #[test]
    fn registration_is_validated() {
        let svc = MigrationService::new();
        assert!(svc.register(1, "").is_err());
        svc.register(1, "a").unwrap();
        assert!(matches!(
            svc.register(1, "b").unwrap_err(),
            MigrationError::DuplicateVersion(1)
        ));
        assert!(matches!(
            svc.run_one(99).unwrap_err(),
            MigrationError::UnknownVersion(99)
        ));
    }
}
