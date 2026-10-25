//! Predictive Analytics - deterministic forecasting from real price history.
//!
//! Every prediction is computed from the supplied close series using ordinary
//! least squares on log prices plus realised volatility. There is no random
//! component: the same input always yields the same forecast, and a forecast is
//! impossible without sufficient history (the service reports that instead of
//! inventing numbers).

use serde::{Deserialize, Serialize};

/// A single forecast produced from a concrete price series.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Prediction {
    pub asset: String,
    /// Projected price at the end of the horizon, in the input price units.
    pub predicted_price: f64,
    /// Confidence in `[0, 1]`, derived from fit quality and sample size.
    pub confidence: f64,
    pub timeframe: String,
    /// Annualised volatility estimate used for the projection band.
    pub volatility: f64,
    /// Lower and upper bounds of a one-sigma projection band.
    pub lower_bound: f64,
    pub upper_bound: f64,
}

/// Returned when a forecast cannot be produced from the given data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForecastError {
    InsufficientData { provided: usize, required: usize },
    InvalidPrice { index: usize },
    ZeroHorizon,
}

impl std::fmt::Display for ForecastError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ForecastError::InsufficientData { provided, required } => {
                write!(f, "need at least {required} price points, got {provided}")
            }
            ForecastError::InvalidPrice { index } => {
                write!(f, "price at index {index} is not a positive finite number")
            }
            ForecastError::ZeroHorizon => write!(f, "forecast horizon must be at least one period"),
        }
    }
}

impl std::error::Error for ForecastError {}

/// Minimum number of closes needed to fit a trend line with any confidence.
const MIN_OBSERVATIONS: usize = 8;
/// Trading periods per year, used to annualise volatility.
const PERIODS_PER_YEAR: f64 = 365.0;

#[derive(Debug)]
pub struct PredictiveAnalyticsService;

impl PredictiveAnalyticsService {
    pub fn new() -> Self {
        Self
    }

    /// Forecasts the price `horizon` periods ahead of the last observation.
    ///
    /// Fits `ln(price_t) = a + b*t` by ordinary least squares over the supplied
    /// closes, projects the trend forward, and widens the projection by the
    /// realised log-return volatility scaled by `sqrt(horizon)`.
    pub fn predict(
        &self,
        asset: &str,
        closes: &[f64],
        horizon: u32,
    ) -> Result<Prediction, ForecastError> {
        if horizon == 0 {
            return Err(ForecastError::ZeroHorizon);
        }
        validate_series(closes)?;

        let log_prices: Vec<f64> = closes.iter().map(|p| p.ln()).collect();
        let (intercept, slope) = linear_regression(&log_prices);
        let r_squared = r_squared(&log_prices, intercept, slope);

        let last_index = (log_prices.len() - 1) as f64;
        let projected_log = intercept + slope * (last_index + horizon as f64);
        let predicted_price = projected_log.exp();

        let volatility = annualised_volatility(&log_returns(&log_prices));

        // One-sigma band over the forecast horizon.
        let sigma = volatility * (horizon as f64).sqrt();
        let lower_bound = (projected_log - sigma).exp();
        let upper_bound = (projected_log + sigma).exp();

        Ok(Prediction {
            asset: asset.to_string(),
            predicted_price,
            confidence: confidence_score(r_squared, log_prices.len(), horizon),
            timeframe: format!("{horizon}d"),
            volatility,
            lower_bound,
            upper_bound,
        })
    }

    /// Classifies the trend of a real price series.
    ///
    /// Uses the slope of the fitted log-price trend rather than comparing only
    /// the first and last point, so a single noisy tick cannot flip the verdict.
    pub fn analyze_trends(&self, closes: &[f64]) -> Result<Trend, ForecastError> {
        validate_series(closes)?;

        let log_prices: Vec<f64> = closes.iter().map(|p| p.ln()).collect();
        let (_, slope) = linear_regression(&log_prices);
        let volatility = annualised_volatility(&log_returns(&log_prices));

        let periods = log_prices.len() as f64;
        let trend_over_series = slope * periods;
        let noise = volatility / PERIODS_PER_YEAR.sqrt() * periods.sqrt();

        let trend = if noise > 0.0 && trend_over_series.abs() < noise {
            Trend::Neutral
        } else if slope > 0.0 {
            Trend::Bullish
        } else if slope < 0.0 {
            Trend::Bearish
        } else {
            Trend::Neutral
        };

        Ok(trend)
    }
}

/// Direction of a fitted price trend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Trend {
    Bullish,
    Bearish,
    Neutral,
}

impl Trend {
    pub fn as_str(&self) -> &'static str {
        match self {
            Trend::Bullish => "bullish",
            Trend::Bearish => "bearish",
            Trend::Neutral => "neutral",
        }
    }
}

fn validate_series(closes: &[f64]) -> Result<(), ForecastError> {
    if closes.len() < MIN_OBSERVATIONS {
        return Err(ForecastError::InsufficientData {
            provided: closes.len(),
            required: MIN_OBSERVATIONS,
        });
    }
    for (index, price) in closes.iter().enumerate() {
        if !price.is_finite() || *price <= 0.0 {
            return Err(ForecastError::InvalidPrice { index });
        }
    }
    Ok(())
}

/// Ordinary least squares fit of `y = intercept + slope*x` for `x = 0..n`.
fn linear_regression(y: &[f64]) -> (f64, f64) {
    let n = y.len() as f64;
    let mean_x = (n - 1.0) / 2.0;
    let mean_y = y.iter().sum::<f64>() / n;

    let mut covariance = 0.0;
    let mut variance_x = 0.0;
    for (i, value) in y.iter().enumerate() {
        let dx = i as f64 - mean_x;
        covariance += dx * (value - mean_y);
        variance_x += dx * dx;
    }

    let slope = if variance_x == 0.0 {
        0.0
    } else {
        covariance / variance_x
    };
    let intercept = mean_y - slope * mean_x;
    (intercept, slope)
}

/// Coefficient of determination for the fitted line, in `[0, 1]`.
fn r_squared(y: &[f64], intercept: f64, slope: f64) -> f64 {
    let n = y.len() as f64;
    let mean_y = y.iter().sum::<f64>() / n;

    let mut ss_res = 0.0;
    let mut ss_tot = 0.0;
    for (i, value) in y.iter().enumerate() {
        let fitted = intercept + slope * i as f64;
        ss_res += (value - fitted).powi(2);
        ss_tot += (value - mean_y).powi(2);
    }

    if ss_tot == 0.0 {
        // A flat series is perfectly described by its mean.
        1.0
    } else {
        (1.0 - ss_res / ss_tot).clamp(0.0, 1.0)
    }
}

/// Period-over-period log returns of a log-price series.
fn log_returns(log_prices: &[f64]) -> Vec<f64> {
    log_prices.windows(2).map(|w| w[1] - w[0]).collect()
}

/// Annualised volatility (population standard deviation of log returns).
fn annualised_volatility(returns: &[f64]) -> f64 {
    if returns.len() < 2 {
        return 0.0;
    }
    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
    variance.sqrt() * PERIODS_PER_YEAR.sqrt()
}

/// Blends fit quality, sample size and horizon into a confidence in `[0, 1]`.
fn confidence_score(r_squared: f64, observations: usize, horizon: u32) -> f64 {
    let data_ratio = observations as f64 / (observations as f64 + horizon as f64);
    (r_squared * data_ratio).clamp(0.0, 1.0)
}

impl Default for PredictiveAnalyticsService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rising_series_projects_upward() {
        let closes = [100.0, 102.0, 104.0, 106.0, 108.0, 110.0, 112.0, 114.0];
        let prediction = PredictiveAnalyticsService::new()
            .predict("BTC", &closes, 3)
            .unwrap();
        assert!(prediction.predicted_price > 114.0);
        assert!(prediction.lower_bound < prediction.predicted_price);
        assert!(prediction.upper_bound > prediction.predicted_price);
        assert!((0.0..=1.0).contains(&prediction.confidence));
    }

    #[test]
    fn falling_series_projects_downward() {
        let closes = [200.0, 190.0, 180.0, 170.0, 160.0, 150.0, 140.0, 130.0];
        let prediction = PredictiveAnalyticsService::new()
            .predict("ETH", &closes, 2)
            .unwrap();
        assert!(prediction.predicted_price < 130.0);
    }

    #[test]
    fn prediction_is_deterministic() {
        let closes = [10.0, 11.0, 10.5, 12.0, 12.5, 13.0, 12.8, 13.4, 14.0];
        let service = PredictiveAnalyticsService::new();
        assert_eq!(
            service.predict("SOL", &closes, 5).unwrap(),
            service.predict("SOL", &closes, 5).unwrap()
        );
    }

    #[test]
    fn insufficient_data_is_reported_not_invented() {
        let error = PredictiveAnalyticsService::new()
            .predict("BTC", &[100.0, 101.0], 3)
            .unwrap_err();
        assert_eq!(
            error,
            ForecastError::InsufficientData {
                provided: 2,
                required: MIN_OBSERVATIONS
            }
        );
    }

    #[test]
    fn invalid_prices_are_rejected() {
        let mut closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0];
        closes[4] = -1.0;
        assert_eq!(
            PredictiveAnalyticsService::new()
                .predict("BTC", &closes, 1)
                .unwrap_err(),
            ForecastError::InvalidPrice { index: 4 }
        );
    }

    #[test]
    fn zero_horizon_is_rejected() {
        let closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0];
        assert_eq!(
            PredictiveAnalyticsService::new()
                .predict("BTC", &closes, 0)
                .unwrap_err(),
            ForecastError::ZeroHorizon
        );
    }

    #[test]
    fn trend_detection_matches_direction() {
        let service = PredictiveAnalyticsService::new();
        assert_eq!(
            service
                .analyze_trends(&[1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7])
                .unwrap(),
            Trend::Bullish
        );
        assert_eq!(
            service
                .analyze_trends(&[1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0])
                .unwrap(),
            Trend::Bearish
        );
        assert_eq!(
            service.analyze_trends(&[1.0; 8]).unwrap(),
            Trend::Neutral
        );
    }

    #[test]
    fn volatility_is_zero_for_flat_series() {
        let prediction = PredictiveAnalyticsService::new()
            .predict("USDC", &[50.0; 10], 4)
            .unwrap();
        assert_eq!(prediction.volatility, 0.0);
        assert!((prediction.predicted_price - 50.0).abs() < 1e-9);
    }
}
