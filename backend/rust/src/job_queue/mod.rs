//! Job Queue - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub task: String,
    pub payload: String,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Queued, Running, Completed, Failed }

pub struct JobQueue {
    jobs: Vec<Job>,
}

impl JobQueue {
    pub fn new() -> Self { Self { jobs: vec![] } }
    pub fn enqueue(&mut self, task: &str, payload: &str) -> String {
        let id = format!("JOB_{}", self.jobs.len());
        self.jobs.push(Job { id: id.clone(), task: task.to_string(), payload: payload.to_string(), status: Status::Queued });
        id
    }
    pub fn process(&mut self, id: &str) -> Result<(), String> {
        let j = self.jobs.iter_mut().find(|j| j.id == id).ok_or("Job not found")?;
        j.status = Status::Running;
        Ok(())
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut q = JobQueue::new(); let id = q.enqueue("send_email", "{}"); assert!(!id.is_empty()); } }
