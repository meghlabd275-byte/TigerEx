//! Circuit Breaker - Rust Implementation

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum State { Closed, Open, HalfOpen }

pub struct CircuitBreaker {
    pub failures: u32,
    pub threshold: u32,
    pub state: State,
}

impl CircuitBreaker {
    pub fn new(threshold: u32) -> Self { Self { failures: 0, threshold, state: State::Closed } }
    pub fn record_failure(&mut self) {
        self.failures += 1;
        if self.failures >= self.threshold { self.state = State::Open; }
    }
    pub fn is_open(&self) -> bool { self.state == State::Open }
    pub fn reset(&mut self) { self.failures = 0; self.state = State::Closed; }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut c = CircuitBreaker::new(3); c.record_failure(); assert!(!c.is_open()); } }
