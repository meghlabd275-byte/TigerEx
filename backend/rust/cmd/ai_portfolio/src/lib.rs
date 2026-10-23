//! AI Portfolio allocation for TigerEx.
//!
//! Allocations are computed from caller-supplied volatilities and correlations
//! using a long-only inverse-volatility (risk parity) blend, scaled to the
//! target volatility of the requested risk level. Nothing is invented: missing
//! or inconsistent inputs are rejected.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct AIPosition {
    pub asset: String,
    pub allocation: f64,
    pub rebalance: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PortfolioError {
    EmptyUniverse,
    EmptyUserId,
    DimensionMismatch,
    InvalidVolatility,
    InvalidCorrelation,
    UnknownRiskLevel(String),
}

impl std::fmt::Display for PortfolioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PortfolioError::EmptyUniverse => write!(f, "asset universe must not be empty"),
            PortfolioError::EmptyUserId => write!(f, "user_id must not be empty"),
            PortfolioError::DimensionMismatch => {
                write!(f, "covariance matrix must be square and match the asset count")
            }
            PortfolioError::InvalidVolatility => {
                write!(f, "volatilities must be positive finite numbers")
            }
            PortfolioError::InvalidCorrelation => {
                write!(f, "correlations must be finite and within [-1, 1]")
            }
            PortfolioError::UnknownRiskLevel(level) => write!(f, "unknown risk level: {level}"),
        }
    }
}

impl std::error::Error for PortfolioError {}

/// Target portfolio volatility, annualised, for each risk level.
fn target_volatility(risk_level: &str) -> Result<f64, PortfolioError> {
    match risk_level {
        "low" => Ok(0.10),
        "medium" => Ok(0.25),
        "high" => Ok(0.50),
        other => Err(PortfolioError::UnknownRiskLevel(other.to_string())),
    }
}

pub struct AIPortfolioService {
    portfolios: RwLock<HashMap<String, Vec<AIPosition>>>,
}

impl Default for AIPortfolioService {
    fn default() -> Self {
        Self::new()
    }
}

impl AIPortfolioService {
    pub fn new() -> Self {
        Self {
            portfolios: RwLock::new(HashMap::new()),
        }
    }

    /// Long-only inverse-volatility allocation, scaled to the risk target.
    pub fn allocate(
        &self,
        assets: &[String],
        volatilities: &[f64],
        correlations: &[Vec<f64>],
        risk_level: &str,
    ) -> Result<Vec<AIPosition>, PortfolioError> {
        if assets.is_empty() {
            return Err(PortfolioError::EmptyUniverse);
        }
        let n = assets.len();
        if volatilities.len() != n || correlations.len() != n {
            return Err(PortfolioError::DimensionMismatch);
        }
        if correlations.iter().any(|row| row.len() != n) {
            return Err(PortfolioError::DimensionMismatch);
        }
        if volatilities.iter().any(|v| !v.is_finite() || *v <= 0.0) {
            return Err(PortfolioError::InvalidVolatility);
        }
        if correlations
            .iter()
            .flatten()
            .any(|c| !c.is_finite() || !(-1.0..=1.0).contains(c))
        {
            return Err(PortfolioError::InvalidCorrelation);
        }
        let target = target_volatility(risk_level)?;

        let inverse: Vec<f64> = volatilities.iter().map(|v| 1.0 / v).collect();
        let total: f64 = inverse.iter().sum();
        if total <= 0.0 {
            return Err(PortfolioError::InvalidVolatility);
        }
        let weights: Vec<f64> = inverse.iter().map(|w| w / total).collect();

        // Portfolio variance = wᵀ Σ w, with Σ_ij = ρ_ij σ_i σ_j.
        let mut variance = 0.0;
        for i in 0..n {
            for j in 0..n {
                variance += weights[i] * weights[j] * correlations[i][j] * volatilities[i] * volatilities[j];
            }
        }
        let portfolio_vol = variance.max(0.0).sqrt();
        let scale = if portfolio_vol > target && portfolio_vol > 0.0 {
            target / portfolio_vol
        } else {
            1.0
        };

        Ok(assets
            .iter()
            .zip(weights.iter())
            .map(|(asset, weight)| AIPosition {
                asset: asset.clone(),
                allocation: weight * scale,
                rebalance: true,
            })
            .collect())
    }

    /// Compute and persist an allocation for a user.
    pub fn optimize(
        &self,
        user_id: &str,
        assets: &[String],
        volatilities: &[f64],
        correlations: &[Vec<f64>],
        risk_level: &str,
    ) -> Result<Vec<AIPosition>, PortfolioError> {
        if user_id.trim().is_empty() {
            return Err(PortfolioError::EmptyUserId);
        }
        let positions = self.allocate(assets, volatilities, correlations, risk_level)?;
        self.portfolios
            .write()
            .unwrap()
            .insert(user_id.to_string(), positions.clone());
        Ok(positions)
    }

    pub fn rebalance(&self, user_id: &str, positions: Vec<AIPosition>) {
        self.portfolios.write().unwrap().insert(user_id.to_string(), positions);
    }

    pub fn positions(&self, user_id: &str) -> Option<Vec<AIPosition>> {
        self.portfolios.read().unwrap().get(user_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assets() -> Vec<String> {
        vec!["BTC".to_string(), "ETH".to_string()]
    }

    #[test]
    fn allocates_inverse_volatility_weights() {
        let service = AIPortfolioService::new();
        let correlations = vec![vec![1.0, 0.0], vec![0.0, 1.0]];
        let positions = service.allocate(&assets(), &[0.4, 0.8], &correlations, "high").unwrap();
        assert!((positions[0].allocation - 2.0 / 3.0).abs() < 1e-9);
        assert!((positions[1].allocation - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn scales_down_to_target_volatility() {
        let service = AIPortfolioService::new();
        let correlations = vec![vec![1.0, 1.0], vec![1.0, 1.0]];
        let volatilities = [0.8, 0.8];
        let positions = service.allocate(&assets(), &volatilities, &correlations, "low").unwrap();

        // Perfectly correlated assets: portfolio vol is the weighted sum of
        // individual volatilities, and must equal the 0.10 low-risk target.
        let portfolio_vol: f64 = positions
            .iter()
            .zip(volatilities.iter())
            .map(|(position, vol)| position.allocation * vol)
            .sum();
        assert!((portfolio_vol - 0.10).abs() < 1e-9, "portfolio vol {portfolio_vol}");
    }

    #[test]
    fn rejects_bad_input() {
        let service = AIPortfolioService::new();
        let correlations = vec![vec![1.0, 0.0], vec![0.0, 1.0]];
        assert_eq!(service.allocate(&[], &[], &[], "low").unwrap_err(), PortfolioError::EmptyUniverse);
        assert_eq!(
            service.allocate(&assets(), &[0.4], &correlations, "low").unwrap_err(),
            PortfolioError::DimensionMismatch
        );
        assert_eq!(
            service.allocate(&assets(), &[0.4, 0.0], &correlations, "low").unwrap_err(),
            PortfolioError::InvalidVolatility
        );
        assert_eq!(
            service.allocate(&assets(), &[0.4, 0.8], &correlations, "extreme").unwrap_err(),
            PortfolioError::UnknownRiskLevel("extreme".to_string())
        );
    }

    #[test]
    fn optimize_persists_positions() {
        let service = AIPortfolioService::new();
        let correlations = vec![vec![1.0, 0.2], vec![0.2, 1.0]];
        let positions = service
            .optimize("u1", &assets(), &[0.4, 0.8], &correlations, "medium")
            .unwrap();
        assert_eq!(service.positions("u1").unwrap(), positions);
    }
}
