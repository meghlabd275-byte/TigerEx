//! AI trading signal evaluation for TigerEx.
//!
//! Signals are produced from a caller-supplied feature vector and model
//! weights. There is no random signal generation: an empty or malformed input
//! is rejected, and a signal is only actionable when its score clears the
//! configured confidence threshold.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct AISignal {
    pub id: String,
    pub asset: String,
    pub action: String,
    pub confidence: f64,
    pub model_version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BotConfig {
    pub user_id: String,
    pub strategy: String,
    pub risk_level: u8,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AITradingError {
    EmptyAsset,
    EmptyFeatures,
    DimensionMismatch,
    NonFinite,
    UnknownStrategy(String),
    InvalidRiskLevel(u8),
    LowConfidence(f64),
}

impl std::fmt::Display for AITradingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AITradingError::EmptyAsset => write!(f, "asset must not be empty"),
            AITradingError::EmptyFeatures => write!(f, "feature vector must not be empty"),
            AITradingError::DimensionMismatch => {
                write!(f, "weights must have the same length as the feature vector")
            }
            AITradingError::NonFinite => write!(f, "features and weights must be finite"),
            AITradingError::UnknownStrategy(s) => write!(f, "unknown strategy: {s}"),
            AITradingError::InvalidRiskLevel(level) => write!(f, "risk level {level} is out of range"),
            AITradingError::LowConfidence(score) => {
                write!(f, "signal confidence {score:.4} is below the execution threshold")
            }
        }
    }
}

impl std::error::Error for AITradingError {}

/// Logistic link so a linear score maps into a probability in (0, 1).
fn logistic(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

#[derive(Debug, Clone, PartialEq)]
pub struct SignalExecution {
    pub signal_id: String,
    pub asset: String,
    pub action: String,
    pub confidence: f64,
}

pub struct AITradingService {
    signals: RwLock<Vec<AISignal>>,
    bots: RwLock<HashMap<String, BotConfig>>,
    executions: RwLock<Vec<SignalExecution>>,
    model_version: String,
    next_signal_id: RwLock<u64>,
    next_bot_id: RwLock<u64>,
}

impl Default for AITradingService {
    fn default() -> Self {
        Self::new()
    }
}

impl AITradingService {
    pub fn new() -> Self {
        Self {
            signals: RwLock::new(Vec::new()),
            bots: RwLock::new(HashMap::new()),
            executions: RwLock::new(Vec::new()),
            model_version: "v2.6".to_string(),
            next_signal_id: RwLock::new(1),
            next_bot_id: RwLock::new(1),
        }
    }

    /// Evaluate a linear model over `features` and produce a signal.
    ///
    /// `weights` and `features` must be the same length. The raw score is
    /// passed through a logistic link to give a confidence in (0, 1); a
    /// positive score means buy, otherwise sell.
    pub fn generate_signal(
        &self,
        asset: &str,
        features: &[f64],
        weights: &[f64],
        bias: f64,
    ) -> Result<AISignal, AITradingError> {
        if asset.trim().is_empty() {
            return Err(AITradingError::EmptyAsset);
        }
        if features.is_empty() {
            return Err(AITradingError::EmptyFeatures);
        }
        if features.len() != weights.len() {
            return Err(AITradingError::DimensionMismatch);
        }
        if features.iter().chain(weights.iter()).chain(std::iter::once(&bias)).any(|v| !v.is_finite()) {
            return Err(AITradingError::NonFinite);
        }

        let score: f64 = features.iter().zip(weights.iter()).map(|(f, w)| f * w).sum::<f64>() + bias;
        let confidence = logistic(score);
        let action = if score >= 0.0 { "BUY" } else { "SELL" };

        let id = {
            let mut next = self.next_signal_id.write().unwrap();
            let id = format!("sig_{}", *next);
            *next += 1;
            id
        };
        let signal = AISignal {
            id,
            asset: asset.to_string(),
            action: action.to_string(),
            confidence,
            model_version: self.model_version.clone(),
        };

        self.signals.write().unwrap().push(signal.clone());
        Ok(signal)
    }

    pub fn create_bot(
        &self,
        user_id: &str,
        strategy: &str,
        risk_level: u8,
    ) -> Result<String, AITradingError> {
        if user_id.trim().is_empty() {
            return Err(AITradingError::EmptyAsset);
        }
        if !matches!(strategy, "momentum" | "mean_reversion" | "breakout") {
            return Err(AITradingError::UnknownStrategy(strategy.to_string()));
        }
        if !(1..=5).contains(&risk_level) {
            return Err(AITradingError::InvalidRiskLevel(risk_level));
        }

        let id = {
            let mut next = self.next_bot_id.write().unwrap();
            let id = format!("bot_{}", *next);
            *next += 1;
            id
        };
        let mut bots = self.bots.write().unwrap();
        bots.insert(
            id.clone(),
            BotConfig {
                user_id: user_id.to_string(),
                strategy: strategy.to_string(),
                risk_level,
                enabled: true,
            },
        );
        Ok(id)
    }

    pub fn set_bot_enabled(&self, bot_id: &str, enabled: bool) -> bool {
        let mut bots = self.bots.write().unwrap();
        match bots.get_mut(bot_id) {
            Some(bot) => {
                bot.enabled = enabled;
                true
            }
            None => false,
        }
    }

    pub fn bot(&self, bot_id: &str) -> Option<BotConfig> {
        self.bots.read().unwrap().get(bot_id).cloned()
    }

    /// Accept a signal for execution only when it clears `min_confidence`,
    /// recording the execution.
    pub fn execute_signal(
        &self,
        signal: &AISignal,
        min_confidence: f64,
    ) -> Result<SignalExecution, AITradingError> {
        if !(0.0..1.0).contains(&min_confidence) {
            return Err(AITradingError::LowConfidence(min_confidence));
        }
        if signal.confidence < min_confidence {
            return Err(AITradingError::LowConfidence(signal.confidence));
        }

        let execution = SignalExecution {
            signal_id: signal.id.clone(),
            asset: signal.asset.clone(),
            action: signal.action.clone(),
            confidence: signal.confidence,
        };
        self.executions.write().unwrap().push(execution.clone());
        Ok(execution)
    }

    /// Executions recorded so far.
    pub fn executions(&self) -> Vec<SignalExecution> {
        self.executions.read().unwrap().clone()
    }

    pub fn signal(&self, id: &str) -> Option<AISignal> {
        self.signals
            .read()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_direction_follows_score_sign() {
        let service = AITradingService::new();
        let up = service.generate_signal("BTC", &[1.0, 1.0], &[1.0, 1.0], 0.0).unwrap();
        assert_eq!(up.action, "BUY");
        assert!(up.confidence > 0.5);

        let down = service.generate_signal("BTC", &[1.0, 1.0], &[-1.0, -1.0], 0.0).unwrap();
        assert_eq!(down.action, "SELL");
        assert!(down.confidence < 0.5);
    }

    #[test]
    fn rejects_malformed_features() {
        let service = AITradingService::new();
        assert_eq!(
            service.generate_signal("BTC", &[], &[], 0.0).unwrap_err(),
            AITradingError::EmptyFeatures
        );
        assert_eq!(
            service.generate_signal("BTC", &[1.0], &[1.0, 2.0], 0.0).unwrap_err(),
            AITradingError::DimensionMismatch
        );
        assert_eq!(
            service.generate_signal("BTC", &[f64::NAN], &[1.0], 0.0).unwrap_err(),
            AITradingError::NonFinite
        );
    }

    #[test]
    fn rejects_unknown_strategy_and_risk() {
        let service = AITradingService::new();
        assert!(matches!(
            service.create_bot("u1", "telepathy", 3).unwrap_err(),
            AITradingError::UnknownStrategy(_)
        ));
        assert!(matches!(
            service.create_bot("u1", "momentum", 9).unwrap_err(),
            AITradingError::InvalidRiskLevel(9)
        ));
    }

    #[test]
    fn execution_respects_threshold() {
        let service = AITradingService::new();
        let signal = service.generate_signal("BTC", &[0.0], &[1.0], 0.0).unwrap();
        // Neutral score yields confidence 0.5.
        assert!(service.execute_signal(&signal, 0.5).is_ok());
        assert!(matches!(
            service.execute_signal(&signal, 0.6).unwrap_err(),
            AITradingError::LowConfidence(_)
        ));
    }

    #[test]
    fn signal_ids_are_unique_and_executions_are_recorded() {
        let service = AITradingService::new();
        let a = service.generate_signal("BTC", &[1.0], &[1.0], 0.0).unwrap();
        let b = service.generate_signal("BTC", &[1.0], &[1.0], 0.0).unwrap();
        // The old id embedded the signal count, so repeated signals collided.
        assert_ne!(a.id, b.id);
        assert!(service.signal(&a.id).is_some());

        let execution = service.execute_signal(&a, 0.5).unwrap();
        // The old execute_signal returned a formatted string and recorded nothing.
        assert_eq!(execution.signal_id, a.id);
        assert_eq!(service.executions().len(), 1);
    }

    #[test]
    fn bot_ids_are_unique() {
        let service = AITradingService::new();
        let a = service.create_bot("u1", "momentum", 3).unwrap();
        let b = service.create_bot("u1", "momentum", 3).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn bot_lifecycle() {
        let service = AITradingService::new();
        let id = service.create_bot("u1", "momentum", 3).unwrap();
        assert!(service.bot(&id).unwrap().enabled);
        assert!(service.set_bot_enabled(&id, false));
        assert!(!service.bot(&id).unwrap().enabled);
        assert!(!service.set_bot_enabled("missing", false));
    }
}
