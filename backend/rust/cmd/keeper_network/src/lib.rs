//! Keeper network for automated on-chain actions.
//!
//! The previous implementation returned formatted strings from
//! `execute_trigger` and `schedule_rebalance` without recording anything, and
//! never checked whether a trigger had already been executed.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Trigger {
    pub id: String,
    pub kind: TriggerKind,
    pub user_id: String,
    /// Keeper that claimed the job, if any.
    pub keeper: Option<String>,
    pub executed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerKind {
    Liquidation,
    Rebalance,
    StopLoss,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KeeperError {
    EmptyKeeper,
    EmptyUser,
    UnknownKeeper(String),
    UnknownTrigger(String),
    AlreadyExecuted(String),
}

impl std::fmt::Display for KeeperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeeperError::EmptyKeeper => write!(f, "keeper id must not be empty"),
            KeeperError::EmptyUser => write!(f, "user id must not be empty"),
            KeeperError::UnknownKeeper(id) => write!(f, "keeper {id} is not registered"),
            KeeperError::UnknownTrigger(id) => write!(f, "unknown trigger: {id}"),
            KeeperError::AlreadyExecuted(id) => write!(f, "trigger {id} was already executed"),
        }
    }
}

impl std::error::Error for KeeperError {}

pub struct KeeperNetworkService {
    keepers: RwLock<Vec<String>>,
    triggers: RwLock<HashMap<String, Trigger>>,
    next_id: RwLock<u64>,
}

impl KeeperNetworkService {
    pub fn new() -> Self {
        Self {
            keepers: RwLock::new(Vec::new()),
            triggers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Register a keeper. Registration is idempotent.
    pub fn register_keeper(&self, keeper_id: &str) -> Result<(), KeeperError> {
        if keeper_id.trim().is_empty() {
            return Err(KeeperError::EmptyKeeper);
        }
        let mut keepers = self.keepers.write().unwrap();
        if !keepers.contains(&keeper_id.to_string()) {
            keepers.push(keeper_id.to_string());
        }
        Ok(())
    }

    pub fn keepers(&self) -> Vec<String> {
        self.keepers.read().unwrap().clone()
    }

    /// Queue a trigger for execution.
    pub fn schedule(
        &self,
        kind: TriggerKind,
        user_id: &str,
    ) -> Result<Trigger, KeeperError> {
        if user_id.trim().is_empty() {
            return Err(KeeperError::EmptyUser);
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("trg_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let trigger = Trigger {
            id: id.clone(),
            kind,
            user_id: user_id.to_string(),
            keeper: None,
            executed: false,
        };
        self.triggers
            .write()
            .unwrap()
            .insert(id, trigger.clone());
        Ok(trigger)
    }

    /// A registered keeper executes a trigger. A trigger runs only once, and
    /// only a registered keeper may claim it.
    pub fn execute_trigger(
        &self,
        keeper_id: &str,
        trigger_id: &str,
    ) -> Result<Trigger, KeeperError> {
        if !self.keepers.read().unwrap().contains(&keeper_id.to_string()) {
            return Err(KeeperError::UnknownKeeper(keeper_id.to_string()));
        }

        let mut triggers = self.triggers.write().unwrap();
        let trigger = triggers
            .get_mut(trigger_id)
            .ok_or_else(|| KeeperError::UnknownTrigger(trigger_id.to_string()))?;

        if trigger.executed {
            return Err(KeeperError::AlreadyExecuted(trigger_id.to_string()));
        }
        trigger.executed = true;
        trigger.keeper = Some(keeper_id.to_string());
        Ok(trigger.clone())
    }

    pub fn trigger(&self, id: &str) -> Option<Trigger> {
        self.triggers.read().unwrap().get(id).cloned()
    }

    pub fn pending_count(&self) -> usize {
        self.triggers
            .read()
            .unwrap()
            .values()
            .filter(|t| !t.executed)
            .count()
    }
}

impl Default for KeeperNetworkService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> KeeperNetworkService {
        let s = KeeperNetworkService::new();
        s.register_keeper("keeper-1").unwrap();
        s
    }

    #[test]
    fn a_trigger_executes_once_and_records_the_keeper() {
        let svc = svc();
        let trigger = svc.schedule(TriggerKind::Liquidation, "alice").unwrap();
        assert_eq!(svc.pending_count(), 1);

        let executed = svc.execute_trigger("keeper-1", &trigger.id).unwrap();
        assert!(executed.executed);
        assert_eq!(executed.keeper.as_deref(), Some("keeper-1"));
        assert_eq!(svc.pending_count(), 0);

        // The old implementation returned a string and allowed re-execution.
        assert!(matches!(
            svc.execute_trigger("keeper-1", &trigger.id).unwrap_err(),
            KeeperError::AlreadyExecuted(_)
        ));
    }

    #[test]
    fn only_registered_keepers_may_execute() {
        let svc = svc();
        let trigger = svc.schedule(TriggerKind::Rebalance, "alice").unwrap();

        assert!(matches!(
            svc.execute_trigger("stranger", &trigger.id).unwrap_err(),
            KeeperError::UnknownKeeper(_)
        ));
        assert!(!svc.trigger(&trigger.id).unwrap().executed);
    }

    #[test]
    fn registration_is_idempotent() {
        let svc = KeeperNetworkService::new();
        svc.register_keeper("keeper-1").unwrap();
        svc.register_keeper("keeper-1").unwrap();
        assert_eq!(svc.keepers().len(), 1);
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = svc();
        assert!(svc.register_keeper("").is_err());
        assert!(svc.schedule(TriggerKind::StopLoss, "").is_err());
        assert!(svc.execute_trigger("keeper-1", "trg_missing").is_err());
    }

    #[test]
    fn ids_are_unique() {
        let svc = svc();
        let a = svc.schedule(TriggerKind::Liquidation, "alice").unwrap();
        let b = svc.schedule(TriggerKind::Liquidation, "alice").unwrap();
        assert_ne!(a.id, b.id);
    }
}
