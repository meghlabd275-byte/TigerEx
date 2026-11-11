// Quant - Quantitative Trading Strategies
// Rust for algorithmic trading strategies

use std::collections::HashMap;

// Strategy backtest result
#[derive(Debug, Clone)]
pub struct BacktestResult {
    pub total_return: f64,
    pub sharpe_ratio: f64,
    pub max_drawdown: f64,
    pub win_rate: f64,
    pub trades: i32,
}

// Moving average crossover
pub struct MACrossover {
    short_period: i32,
    long_period: i32,
}

impl MACrossover {
    pub fn new(short: i32, long: i32) -> Self {
        MACrossover {
            short_period: short,
            long_period: long,
        }
    }

    pub fn signal(&self, prices: &[f64]) -> Option<String> {
        if prices.len() < self.long_period as usize {
            return None;
        }

        let short_ma = mean(&prices[(prices.len() - self.short_period as usize)..]);
        let long_ma = mean(&prices[(prices.len() - self.long_period as usize)..]);

        if short_ma > long_ma {
            Some("buy".to_string())
        } else if short_ma < long_ma {
            Some("sell".to_string())
        } else {
            None
        }
    }
}

// RSI strategy
pub struct RSIStrategy {
    period: i32,
    overbought: f64,
    oversold: f64,
}

impl RSIStrategy {
    pub fn new(period: i32) -> Self {
        RSIStrategy {
            period,
            overbought: 70.0,
            oversold: 30.0,
        }
    }

    pub fn calculate_rsi(&self, prices: &[f64]) -> f64 {
        if prices.len() < self.period as usize + 1 {
            return 50.0;
        }

        let mut gains = 0.0;
        let mut losses = 0.0;

        for i in (prices.len() - self.period as usize)..prices.len() {
            let change = prices[i] - prices[i - 1];
            if change > 0.0 {
                gains += change;
            } else {
                losses += change.abs();
            }
        }

        let avg_gain = gains / self.period as f64;
        let avg_loss = losses / self.period as f64;

        if avg_loss == 0.0 {
            return 100.0;
        }

        let rs = avg_gain / avg_loss;
        100.0 - (100.0 / (1.0 + rs))
    }

    pub fn signal(&self, prices: &[f64]) -> Option<String> {
        let rsi = self.calculate_rsi(prices);

        if rsi < self.oversold {
            Some("buy".to_string())
        } else if rsi > self.overbought {
            Some("sell".to_string())
        } else {
            None
        }
    }
}

// Mean reversion
pub struct MeanReversion {
    period: i32,
    std_dev_multiplier: f64,
}

impl MeanReversion {
    pub fn new(period: i32, std_mult: f64) -> Self {
        MeanReversion {
            period,
            std_dev_multiplier: std_mult,
        }
    }

    pub fn signal(&self, prices: &[f64]) -> Option<String> {
        if prices.len() < self.period as usize {
            return None;
        }

        let recent = &prices[prices.len() - self.period as usize..];
        let mean = mean(recent);
        let std = std_dev(recent, mean);
        let current = prices[prices.len() - 1];

        if current < mean - (std * self.std_dev_multiplier) {
            Some("buy".to_string())
        } else if current > mean + (std * self.std_dev_multiplier) {
            Some("sell".to_string())
        } else {
            None
        }
    }
}

// Backtest engine
pub struct Backtester {
    initial_capital: f64,
    results: HashMap<String, BacktestResult>,
    /// Number of bars in a year, used to annualise the Sharpe ratio (e.g. 365
    /// for daily bars, 8760 for hourly).
    periods_per_year: f64,
}

impl Backtester {
    /// Create a backtester that annualises over daily bars.
    pub fn new(capital: f64) -> Self {
        Self::with_periods_per_year(capital, 365.0)
    }

    /// Create a backtester with an explicit bar frequency for annualisation.
    pub fn with_periods_per_year(capital: f64, periods_per_year: f64) -> Self {
        Backtester {
            initial_capital: capital,
            results: HashMap::new(),
            periods_per_year: if periods_per_year > 0.0 { periods_per_year } else { 365.0 },
        }
    }

    pub fn backtest(&mut self, strategy_id: &str, prices: &[f64], signals: &[String]) -> BacktestResult {
        let mut cash = self.initial_capital;
        let mut position = 0.0;
        let mut trades = 0;
        let mut wins = 0;
        let mut peak = cash;
        let mut max_dd = 0.0;
        // Equity sampled once per bar, used to compute the Sharpe ratio from the
        // realised periodic returns rather than an assumed multiple of the total
        // return.
        let mut equity_curve: Vec<f64> = Vec::with_capacity(prices.len() + 1);
        equity_curve.push(self.initial_capital);

        for i in 0..signals.len() {
            if i >= prices.len() {
                break;
            }

            let price = prices[i];
            let signal = &signals[i];

            if signal == "buy" && position == 0.0 && price > 0.0 {
                position = cash / price;
                cash = 0.0;
                trades += 1;
            } else if signal == "sell" && position > 0.0 {
                cash = position * price;
                if cash > self.initial_capital {
                    wins += 1;
                }
                position = 0.0;
                trades += 1;
            }

            let equity = cash + position * price;
            equity_curve.push(equity);

            // Track drawdown
            if equity > peak {
                peak = equity;
            }
            if peak > 0.0 {
                let dd = (peak - equity) / peak;
                if dd > max_dd {
                    max_dd = dd;
                }
            }
        }

        let final_value = cash + position * prices.last().unwrap_or(&1.0);
        let total_return = (final_value - self.initial_capital) / self.initial_capital;
        let win_rate = if trades > 0 { wins as f64 / trades as f64 } else { 0.0 };
        let sharpe_ratio = sharpe_ratio(&equity_curve, self.periods_per_year);

        let result = BacktestResult {
            total_return: total_return * 100.0,
            sharpe_ratio,
            max_drawdown: max_dd * 100.0,
            win_rate: win_rate * 100.0,
            trades,
        };
        self.results.insert(strategy_id.to_string(), result.clone());
        result
    }

    /// The most recent result recorded for `strategy_id`, if any.
    pub fn result_for(&self, strategy_id: &str) -> Option<&BacktestResult> {
        self.results.get(strategy_id)
    }
}

// Helper functions
fn mean(arr: &[f64]) -> f64 {
    arr.iter().sum::<f64>() / arr.len() as f64
}

/// Annualised Sharpe ratio (zero risk-free rate) from a periodic equity curve.
///
/// Returns 0.0 when there are fewer than two observations or the return series
/// has no dispersion, which is the honest answer rather than an invented
/// multiple of the total return.
fn sharpe_ratio(equity_curve: &[f64], periods_per_year: f64) -> f64 {
    if equity_curve.len() < 2 {
        return 0.0;
    }

    let mut returns = Vec::with_capacity(equity_curve.len() - 1);
    for window in equity_curve.windows(2) {
        let previous = window[0];
        if previous <= 0.0 {
            return 0.0;
        }
        returns.push((window[1] - previous) / previous);
    }

    if returns.len() < 2 {
        return 0.0;
    }

    let mean_return = mean(&returns);
    let std_return = std_dev(&returns, mean_return);
    if std_return == 0.0 {
        return 0.0;
    }

    (mean_return / std_return) * periods_per_year.sqrt()
}

fn std_dev(arr: &[f64], mean_val: f64) -> f64 {
    let variance = arr.iter().map(|x| (x - mean_val).powi(2)).sum::<f64>() / arr.len() as f64;
    variance.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rsi() {
        let rsi = RSIStrategy::new(14);
        
        let prices = vec![100.0, 102.0, 101.0, 103.0, 105.0, 104.0, 106.0, 108.0, 107.0, 109.0, 111.0, 110.0, 112.0, 114.0, 113.0, 115.0];
        
        let rsi_val = rsi.calculate_rsi(&prices);
        
        assert!(rsi_val >= 0.0 && rsi_val <= 100.0);
    }

    #[test]
    fn sharpe_ratio_is_zero_without_dispersion() {
        // A flat equity curve has zero standard deviation, so the Sharpe ratio
        // is undefined; the function reports 0.0 rather than dividing by zero.
        assert_eq!(sharpe_ratio(&[100.0, 100.0, 100.0, 100.0], 365.0), 0.0);
        assert_eq!(sharpe_ratio(&[100.0], 365.0), 0.0);
        assert_eq!(sharpe_ratio(&[], 365.0), 0.0);
    }

    #[test]
    fn sharpe_ratio_reflects_realised_returns() {
        // Alternating up/down returns have a positive mean and non-zero
        // variance, so the annualised Sharpe must be finite and positive.
        let equity = vec![100.0, 101.0, 100.495, 101.5, 100.99, 102.0];
        let sharpe = sharpe_ratio(&equity, 365.0);
        assert!(sharpe.is_finite());
        assert!(sharpe > 0.0);
    }

    #[test]
    fn backtest_records_result_by_strategy() {
        let prices = vec![100.0, 101.0, 102.0, 103.0, 104.0];
        let signals = vec![
            "buy".to_string(),
            "hold".to_string(),
            "sell".to_string(),
            "hold".to_string(),
            "hold".to_string(),
        ];
        let mut backtester = Backtester::new(10_000.0);
        let result = backtester.backtest("ma-cross", &prices, &signals);
        assert_eq!(result.trades, 2);
        assert!(backtester.result_for("ma-cross").is_some());
        assert!(backtester.result_for("unknown").is_none());
    }
}
