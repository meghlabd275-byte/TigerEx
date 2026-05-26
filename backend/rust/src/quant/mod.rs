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
            if change > 0 {
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
}

impl Backtester {
    pub fn new(capital: f64) -> Self {
        Backtester {
            initial_capital: capital,
            results: HashMap::new(),
        }
    }

    pub fn backtest(&mut self, strategy_id: &str, prices: &[f64], signals: &[String]) -> BacktestResult {
        let mut cash = self.initial_capital;
        let mut position = 0.0;
        let mut trades = 0;
        let mut wins = 0;
        let mut peak = cash;
        let mut max_dd = 0.0;

        for i in 0..signals.len() {
            if i >= prices.len() {
                break;
            }

            let price = prices[i];
            let signal = &signals[i];

            if signal == "buy" && position == 0.0 {
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

            // Track drawdown
            if cash + position * price > peak {
                peak = cash + position * price;
            }
            let dd = (peak - (cash + position * price)) / peak;
            if dd > max_dd {
                max_dd = dd;
            }
        }

        let finalValue = cash + position * prices.last().unwrap_or(&1.0);
        let totalReturn = (finalValue - self.initial_capital) / self.initial_capital;
        let winRate = if trades > 0 { wins as f64 / trades as f64 } else { 0.0 };

        BacktestResult {
            total_return: totalReturn * 100.0,
            sharpe_ratio: totalReturn * 2.0, // Simplified
            max_drawdown: max_dd * 100.0,
            win_rate: winRate * 100.0,
            trades,
        }
    }
}

// Helper functions
fn mean(arr: &[f64]) -> f64 {
    arr.iter().sum::<f64>() / arr.len() as f64
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
}