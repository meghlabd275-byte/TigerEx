//! Recurring auto-invest plans.
//!
//! The previous implementation had `pause_plan` and `resume_plan` as empty
//! no-ops, derived the plan id from the millisecond clock (so two plans created
//! in the same millisecond collided), accepted any amount and frequency, and
//! never advanced `next_execute`.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
}

impl Frequency {
    /// Interval in milliseconds.
    pub fn interval_ms(self) -> u64 {
        match self {
            Frequency::Daily => 24 * 60 * 60 * 1000,
            Frequency::Weekly => 7 * 24 * 60 * 60 * 1000,
            Frequency::Monthly => 30 * 24 * 60 * 60 * 1000,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "daily" => Some(Frequency::Daily),
            "weekly" => Some(Frequency::Weekly),
            "monthly" => Some(Frequency::Monthly),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub frequency: Frequency,
    pub next_execute: u64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AutoInvestError {
    EmptyAsset,
    InvalidAmount(f64),
    InvalidFrequency(String),
    UnknownPlan(String),
}

impl std::fmt::Display for AutoInvestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AutoInvestError::EmptyAsset => write!(f, "asset must not be empty"),
            AutoInvestError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            AutoInvestError::InvalidFrequency(freq) => {
                write!(f, "frequency {freq} must be daily, weekly or monthly")
            }
            AutoInvestError::UnknownPlan(id) => write!(f, "unknown plan: {id}"),
        }
    }
}

impl std::error::Error for AutoInvestError {}

pub struct AutoInvestService {
    /// plan id -> plan.
    plans: RwLock<HashMap<String, Plan>>,
    next_id: RwLock<u64>,
}

impl AutoInvestService {
    pub fn new() -> Self {
        Self {
            plans: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Create a plan. The first execution is one interval from now.
    pub fn create_plan(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        frequency: &str,
    ) -> Result<String, AutoInvestError> {
        if asset.trim().is_empty() {
            return Err(AutoInvestError::EmptyAsset);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(AutoInvestError::InvalidAmount(amount));
        }
        let frequency =
            Frequency::parse(frequency).ok_or_else(|| AutoInvestError::InvalidFrequency(frequency.to_string()))?;

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("plan_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.plans.write().unwrap().insert(
            id.clone(),
            Plan {
                id: id.clone(),
                user_id: user_id.to_string(),
                asset: asset.to_string(),
                amount,
                frequency,
                next_execute: current_ts() + frequency.interval_ms(),
                active: true,
            },
        );
        Ok(id)
    }

    /// Pause a plan. Returns the updated plan.
    pub fn pause_plan(&self, plan_id: &str) -> Result<Plan, AutoInvestError> {
        self.set_active(plan_id, false)
    }

    /// Resume a paused plan.
    pub fn resume_plan(&self, plan_id: &str) -> Result<Plan, AutoInvestError> {
        self.set_active(plan_id, true)
    }

    fn set_active(&self, plan_id: &str, active: bool) -> Result<Plan, AutoInvestError> {
        let mut plans = self.plans.write().unwrap();
        let plan = plans
            .get_mut(plan_id)
            .ok_or_else(|| AutoInvestError::UnknownPlan(plan_id.to_string()))?;
        plan.active = active;
        Ok(plan.clone())
    }

    /// Execute every active plan whose next run is due at `now_ms`.
    ///
    /// Returns the (plan id, amount) pairs that ran and advances each plan's
    /// next execution by one interval.
    pub fn run_due(&self, now_ms: u64) -> Vec<(String, f64)> {
        let mut plans = self.plans.write().unwrap();
        let mut executed = Vec::new();

        for plan in plans.values_mut() {
            if plan.active && plan.next_execute <= now_ms {
                executed.push((plan.id.clone(), plan.amount));
                // Advance past now so a long outage does not queue a burst.
                let interval = plan.frequency.interval_ms();
                plan.next_execute = now_ms + interval;
            }
        }
        executed
    }

    pub fn get_plan(&self, plan_id: &str) -> Option<Plan> {
        self.plans.read().unwrap().get(plan_id).cloned()
    }

    pub fn plans_for(&self, user_id: &str) -> Vec<Plan> {
        self.plans
            .read()
            .unwrap()
            .values()
            .filter(|p| p.user_id == user_id)
            .cloned()
            .collect()
    }
}

impl Default for AutoInvestService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_and_resume_actually_change_state() {
        let svc = AutoInvestService::new();
        let id = svc.create_plan("u1", "BTC", 100.0, "daily").unwrap();
        assert!(svc.get_plan(&id).unwrap().active);

        // The old implementation did nothing here.
        let paused = svc.pause_plan(&id).unwrap();
        assert!(!paused.active);
        assert!(!svc.get_plan(&id).unwrap().active);

        let resumed = svc.resume_plan(&id).unwrap();
        assert!(resumed.active);
    }

    #[test]
    fn invalid_plans_are_rejected() {
        let svc = AutoInvestService::new();
        assert!(svc.create_plan("u1", "BTC", -1.0, "daily").is_err());
        assert!(svc.create_plan("u1", "BTC", f64::NAN, "daily").is_err());
        assert!(svc.create_plan("u1", "", 100.0, "daily").is_err());
        assert!(svc.create_plan("u1", "BTC", 100.0, "hourly").is_err());
    }

    #[test]
    fn ids_are_unique() {
        let svc = AutoInvestService::new();
        let a = svc.create_plan("u1", "BTC", 100.0, "daily").unwrap();
        let b = svc.create_plan("u1", "ETH", 100.0, "daily").unwrap();
        // The old id was the millisecond clock, so these collided.
        assert_ne!(a, b);
        assert_eq!(svc.plans_for("u1").len(), 2);
    }

    #[test]
    fn due_plans_execute_and_advance() {
        let svc = AutoInvestService::new();
        let id = svc.create_plan("u1", "BTC", 100.0, "daily").unwrap();
        let plan = svc.get_plan(&id).unwrap();

        // Not due yet.
        assert!(svc.run_due(plan.next_execute - 1).is_empty());

        let executed = svc.run_due(plan.next_execute);
        assert_eq!(executed.len(), 1);
        assert_eq!(executed[0].1, 100.0);

        // Running again immediately does nothing; the plan advanced.
        assert!(svc.run_due(plan.next_execute).is_empty());
    }

    #[test]
    fn paused_plans_do_not_execute() {
        let svc = AutoInvestService::new();
        let id = svc.create_plan("u1", "BTC", 100.0, "daily").unwrap();
        let plan = svc.get_plan(&id).unwrap();
        svc.pause_plan(&id).unwrap();

        assert!(svc.run_due(plan.next_execute + 1).is_empty());
    }
}
