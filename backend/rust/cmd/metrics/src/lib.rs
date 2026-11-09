//! Metrics registry.
//!
//! The previous implementation accepted an empty key and any `f64` gauge,
//! including `NaN` and infinities, which then propagated into dashboards and
//! comparisons as a value that is never equal to itself. Every mutation now
//! validates its key and value and returns a typed error, and a poisoned lock
//! surfaces as an error rather than a panic.

use std::collections::HashMap;
use std::sync::RwLock;

/// Largest key length accepted; a key is an identifier, not a payload.
const MAX_KEY_LEN: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub enum MetricsError {
    EmptyKey,
    KeyTooLong { len: usize },
    NonFiniteValue,
    LockPoisoned,
}

impl std::fmt::Display for MetricsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MetricsError::EmptyKey => write!(f, "metric key must not be empty"),
            MetricsError::KeyTooLong { len } => {
                write!(f, "metric key must be at most {MAX_KEY_LEN} bytes, got {len}")
            }
            MetricsError::NonFiniteValue => write!(f, "gauge value must be finite"),
            MetricsError::LockPoisoned => write!(f, "metrics lock is poisoned"),
        }
    }
}

impl std::error::Error for MetricsError {}

fn validate_key(key: &str) -> Result<(), MetricsError> {
    if key.trim().is_empty() {
        return Err(MetricsError::EmptyKey);
    }
    if key.len() > MAX_KEY_LEN {
        return Err(MetricsError::KeyTooLong { len: key.len() });
    }
    Ok(())
}

pub struct MetricsService {
    counters: RwLock<HashMap<String, u64>>,
    gauges: RwLock<HashMap<String, f64>>,
}

impl MetricsService {
    pub fn new() -> Self {
        Self {
            counters: RwLock::new(HashMap::new()),
            gauges: RwLock::new(HashMap::new()),
        }
    }

    /// Increment a counter by `delta`, creating it at `delta` when absent.
    pub fn incr_by(&self, key: &str, delta: u64) -> Result<u64, MetricsError> {
        validate_key(key)?;
        let mut counters = self.counters.write().map_err(|_| MetricsError::LockPoisoned)?;
        let entry = counters.entry(key.to_string()).or_insert(0);
        *entry = entry.saturating_add(delta);
        Ok(*entry)
    }

    /// Increment a counter by one.
    pub fn inc(&self, key: &str) -> Result<u64, MetricsError> {
        self.incr_by(key, 1)
    }

    /// Record a gauge. A non-finite value is rejected rather than stored.
    pub fn gauge(&self, key: &str, value: f64) -> Result<(), MetricsError> {
        validate_key(key)?;
        if !value.is_finite() {
            return Err(MetricsError::NonFiniteValue);
        }
        let mut gauges = self.gauges.write().map_err(|_| MetricsError::LockPoisoned)?;
        gauges.insert(key.to_string(), value);
        Ok(())
    }

    pub fn get_counter(&self, key: &str) -> Result<u64, MetricsError> {
        let counters = self.counters.read().map_err(|_| MetricsError::LockPoisoned)?;
        Ok(counters.get(key).copied().unwrap_or(0))
    }

    pub fn get_gauge(&self, key: &str) -> Result<Option<f64>, MetricsError> {
        let gauges = self.gauges.read().map_err(|_| MetricsError::LockPoisoned)?;
        Ok(gauges.get(key).copied())
    }
}

impl Default for MetricsService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_accumulate() {
        let m = MetricsService::new();
        assert_eq!(m.inc("orders").unwrap(), 1);
        assert_eq!(m.incr_by("orders", 4).unwrap(), 5);
        assert_eq!(m.get_counter("orders").unwrap(), 5);
        assert_eq!(m.get_counter("absent").unwrap(), 0);
    }

    #[test]
    fn empty_and_oversized_keys_are_rejected() {
        let m = MetricsService::new();
        assert_eq!(m.inc(""), Err(MetricsError::EmptyKey));
        assert_eq!(m.inc("   "), Err(MetricsError::EmptyKey));
        let long = "k".repeat(MAX_KEY_LEN + 1);
        assert!(matches!(m.inc(&long), Err(MetricsError::KeyTooLong { .. })));
    }

    #[test]
    fn non_finite_gauges_are_rejected() {
        let m = MetricsService::new();
        assert_eq!(m.gauge("latency", f64::NAN), Err(MetricsError::NonFiniteValue));
        assert_eq!(m.gauge("latency", f64::INFINITY), Err(MetricsError::NonFiniteValue));
        assert_eq!(m.gauge("latency", f64::NEG_INFINITY), Err(MetricsError::NonFiniteValue));
        assert_eq!(m.get_gauge("latency").unwrap(), None);
    }

    #[test]
    fn finite_gauges_are_stored() {
        let m = MetricsService::new();
        m.gauge("latency_ms", 12.5).unwrap();
        assert_eq!(m.get_gauge("latency_ms").unwrap(), Some(12.5));
    }
}
