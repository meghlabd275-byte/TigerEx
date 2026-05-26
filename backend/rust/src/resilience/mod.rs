// Resilience - Circuit Breaker and Fault Tolerance
// Rust for resilient distributed systems

use std::collections::HashMap;

// Circuit state
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

// Failure info
#[derive(Debug, Clone)]
pub struct FailureData {
    pub failures: u32,
    pub last_failure: i64,
    pub last_success: i64,
}

// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    pub failure_threshold: u32,
    pub recovery_timeout: i64, // ms
    pub half_open_requests: u32,
}

// Circuit breaker
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    pub name: String,
    pub state: CircuitState,
    pub config: CircuitConfig,
    pub failures: u32,
    pub successes: u32,
    pub last_failure: i64,
    pub last_success: i64,
    pub next_attempt: i64,
}

impl CircuitBreaker {
    pub fn new(name: &str, config: CircuitConfig) -> Self {
        CircuitBreaker {
            name: name.to_string(),
            state: CircuitState::Closed,
            config,
            failures: 0,
            successes: 0,
            last_failure: 0,
            last_success: 0,
            next_attempt: 0,
        }
    }

    // Call wrapped function
    pub fn call<F, R>(&mut self, f: F) -> Result<R, String>
    where
        F: FnOnce() -> Result<R, String>,
    {
        // Check if circuit is open
        if self.state == CircuitState::Open {
            if now_ms() < self.next_attempt {
                return Err("circuit is open".to_string());
            }
            // Try half-open
            self.state = CircuitState::HalfOpen;
        }

        // Attempt call
        match f() {
            Ok(result) => {
                self.successes += 1;
                self.last_success = now_ms();

                if self.state == CircuitState::HalfOpen {
                    self.state = CircuitState::Closed;
                    self.failures = 0;
                }

                Ok(result)
            }
            Err(e) => {
                self.failures += 1;
                self.last_failure = now_ms();

                if self.failures >= self.config.failure_threshold {
                    self.state = CircuitState::Open;
                    self.next_attempt = now_ms() + self.config.recovery_timeout;
                }

                Err(e)
            }
        }
    }

    // Record success explicitly
    pub fn record_success(&mut self) {
        self.successes += 1;
        self.last_success = now_ms();

        if self.state == CircuitState::HalfOpen {
            self.state = CircuitState::Closed;
            self.failures = 0;
        }
    }

    // Record failure explicitly  
    pub fn record_failure(&mut self) {
        self.failures += 1;
        self.last_failure = now_ms();

        if self.failures >= self.config.failure_threshold {
            self.state = CircuitState::Open;
            self.next_attempt = now_ms() + self.config.recovery_timeout;
        }
    }

    // Get state
    pub fn get_state(&self) -> &CircuitState {
        &self.state
    }

    // Is available
    pub fn is_available(&self) -> bool {
        self.state != CircuitState::Open || now_ms() >= self.next_attempt
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit() {
        let config = CircuitConfig {
            failure_threshold: 3,
            recovery_timeout: 5000,
            half_open_requests: 1,
        };

        let mut cb = CircuitBreaker::new("test", config);
        
        // Fail threshold times
        for _ in 0..3 {
            cb.record_failure();
        }
        
        assert_eq!(cb.state, CircuitState::Open);
    }
}