// Resilience - Circuit Breaker for Fault Tolerance
// Critical safety component in Rust for memory safety

use std::time::{Duration, Instant};

/// Circuit state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,   // Normal operation
    Open,    // Failing, reject calls
    HalfOpen, // Testing recovery
}

/// Circuit configuration
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    pub failure_threshold: u32,
    pub success_threshold: u32,
    pub timeout: Duration,
    pub max_requests: u32,
}

impl Default for CircuitConfig {
    fn default() -> Self {
        CircuitConfig {
            failure_threshold: 3,
            success_threshold: 2,
            timeout: Duration::from_secs(30),
            max_requests: 3,
        }
    }
}

/// Circuit breaker for fault tolerance
#[derive(Debug)]
pub struct CircuitBreaker {
    config: CircuitConfig,
    state: CircuitState,
    failures: u32,
    successes: u32,
    last_failure_time: Option<Instant>,
    half_open_requests: u32,
    total_calls: u64,
    successful_calls: u64,
    failed_calls: u64,
    rejected_calls: u64,
}

impl CircuitBreaker {
    pub fn new(config: CircuitConfig) -> Self {
        CircuitBreaker {
            config,
            state: CircuitState::Closed,
            failures: 0,
            successes: 0,
            last_failure_time: None,
            half_open_requests: 0,
            total_calls: 0,
            successful_calls: 0,
            failed_calls: 0,
            rejected_calls: 0,
        }
    }

    /// Whether a call would be admitted right now, without consuming a slot.
    pub fn is_available(&self) -> bool {
        match self.state {
            CircuitState::Closed => true,
            CircuitState::Open => self.open_timeout_elapsed(),
            CircuitState::HalfOpen => self.half_open_requests < self.config.max_requests,
        }
    }

    fn open_timeout_elapsed(&self) -> bool {
        matches!(self.last_failure_time, Some(t) if t.elapsed() >= self.config.timeout)
    }

    /// Admit a call and account for it. Transitions an expired Open circuit to
    /// HalfOpen, admits up to `max_requests` probe calls there, and rejects the
    /// rest. This is the entry point the caller should use.
    pub fn try_request(&mut self) -> bool {
        match self.state {
            CircuitState::Closed => {
                self.total_calls += 1;
                true
            }
            CircuitState::Open => {
                if self.open_timeout_elapsed() {
                    // Move to half-open and admit this probe.
                    self.state = CircuitState::HalfOpen;
                    self.successes = 0;
                    self.half_open_requests = 1;
                    self.total_calls += 1;
                    true
                } else {
                    self.rejected_calls += 1;
                    false
                }
            }
            CircuitState::HalfOpen => {
                if self.half_open_requests < self.config.max_requests {
                    self.half_open_requests += 1;
                    self.total_calls += 1;
                    true
                } else {
                    self.rejected_calls += 1;
                    false
                }
            }
        }
    }

    pub fn record_success(&mut self) {
        self.successful_calls += 1;

        match self.state {
            CircuitState::Closed => {
                self.failures = 0;
            },
            CircuitState::HalfOpen => {
                self.successes += 1;
                if self.successes >= self.config.success_threshold {
                    self.state = CircuitState::Closed;
                    self.failures = 0;
                    self.successes = 0;
                    self.half_open_requests = 0;
                }
            },
            _ => {},
        }
    }

    pub fn record_failure(&mut self) {
        self.failed_calls += 1;
        self.failures += 1;
        self.last_failure_time = Some(Instant::now());

        match self.state {
            CircuitState::Closed => {
                if self.failures >= self.config.failure_threshold {
                    self.state = CircuitState::Open;
                }
            },
            CircuitState::HalfOpen => {
                self.state = CircuitState::Open;
                self.half_open_requests = 0;
            },
            _ => {},
        }
    }

    pub fn state(&self) -> CircuitState {
        self.state
    }

    pub fn stats(&self) -> CircuitStats {
        CircuitStats {
            state: self.state,
            total_calls: self.total_calls,
            successful_calls: self.successful_calls,
            failed_calls: self.failed_calls,
            rejected_calls: self.rejected_calls,
            failures_in_sequence: self.failures,
            successes_in_sequence: self.successes,
        }
    }

    pub fn reset(&mut self) {
        self.state = CircuitState::Closed;
        self.failures = 0;
        self.successes = 0;
        self.half_open_requests = 0;
        self.last_failure_time = None;
    }
}

#[derive(Debug, Clone)]
pub struct CircuitStats {
    pub state: CircuitState,
    pub total_calls: u64,
    pub successful_calls: u64,
    pub failed_calls: u64,
    pub rejected_calls: u64,
    pub failures_in_sequence: u32,
    pub successes_in_sequence: u32,
}

impl Default for CircuitStats {
    fn default() -> Self {
        CircuitStats {
            state: CircuitState::Closed,
            total_calls: 0,
            successful_calls: 0,
            failed_calls: 0,
            rejected_calls: 0,
            failures_in_sequence: 0,
            successes_in_sequence: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit() {
        let config = CircuitConfig {
            failure_threshold: 2,
            ..Default::default()
        };
        let mut cb = CircuitBreaker::new(config);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }

    #[test]
    fn an_open_circuit_rejects_until_the_timeout_then_half_opens() {
        let config = CircuitConfig {
            failure_threshold: 1,
            success_threshold: 1,
            timeout: Duration::from_millis(0),
            max_requests: 1,
        };
        let mut cb = CircuitBreaker::new(config);
        assert!(cb.try_request());
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Timeout is zero, so the next request half-opens and is admitted.
        assert!(cb.try_request());
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        // The half-open budget is one probe; a second is rejected and counted.
        assert!(!cb.try_request());
        assert_eq!(cb.stats().rejected_calls, 1);

        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn a_closed_circuit_rejects_nothing_and_counts_calls() {
        let mut cb = CircuitBreaker::new(CircuitConfig::default());
        assert!(cb.try_request());
        cb.record_success();
        let s = cb.stats();
        assert_eq!(s.total_calls, 1);
        assert_eq!(s.successful_calls, 1);
        assert_eq!(s.rejected_calls, 0);
    }
}