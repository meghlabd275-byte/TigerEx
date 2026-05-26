//! Scheduler - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub cron: String,
    pub enabled: bool,
}

pub struct Scheduler {
    tasks: Vec<ScheduledTask>,
}

impl Scheduler {
    pub fn new() -> Self { Self { tasks: vec![] } }
    pub fn schedule(&mut self, name: &str, cron: &str) -> String {
        let id = format!("SCHED_{}", self.tasks.len());
        self.tasks.push(ScheduledTask { id: id.clone(), name: name.to_string(), cron: cron.to_string(), enabled: true });
        id
    }
    pub fn disable(&mut self, id: &str) -> Result<(), String> {
        let t = self.tasks.iter_mut().find(|t| t.id == id).ok_or("Task not found")?;
        t.enabled = false;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = Scheduler::new(); let id = s.schedule("daily_report", "0 0 * * *"); assert!(!id.is_empty()); } }
