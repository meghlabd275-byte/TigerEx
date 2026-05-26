// Price - Price Feed Aggregation
// Rust for robust price aggregation and anomaly detection

use std::collections::HashMap;

// Price point
#[derive(Debug, Clone)]
pub struct PricePoint {
    pub source: String,
    pub price: f64,
    pub bid: f64,
    pub ask: f64,
    pub volume: f64,
    pub timestamp: i64,
}

// Aggregated price result
#[derive(Debug, Clone)]
pub struct PriceResult {
    pub symbol: String,
    pub price: f64,
    pub confidence: f64,
    pub sources: i32,
    pub deviation: f64,
}

// Price feed aggregator
pub struct PriceAggregator {
    feeds: HashMap<String, Vec<PricePoint>>,
    weights: HashMap<String, f64>,
}

impl PriceAggregator {
    pub fn new() -> Self {
        PriceAggregator {
            feeds: HashMap::new(),
            weights: HashMap::new(),
        }
    }

    // Set source weight
    pub fn set_weight(&mut self, source: &str, weight: f64) {
        self.weights.insert(source.to_string(), weight);
    }

    // Add feed
    pub fn add_feed(&mut self, symbol: &str, source: &str, price: f64, bid: f64, ask: f64, volume: f64) {
        let point = PricePoint {
            source: source.to_string(),
            price,
            bid,
            ask,
            volume,
            timestamp: now_ms(),
        };

        self.feeds
            .entry(symbol.to_string())
            .or_insert_with(Vec::new)
            .push(point);
    }

    // Aggregate (trimmed mean)
    pub fn aggregate(&self, symbol: &str, max_deviation: f64) -> Option<PriceResult> {
        let feeds = self.feeds.get(symbol)?;

        if feeds.is_empty() {
            return None;
        }

        // Calculate median
        let mut prices: Vec<f64> = feeds.iter().map(|f| f.price).collect();
        prices.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let median = if prices.len() % 2 == 0 {
            (prices[prices.len() / 2 - 1] + prices[prices.len() / 2]) / 2.0
        } else {
            prices[prices.len() / 2]
        };

        // Filter outliers
        let valid: Vec<_> = feeds
            .iter()
            .filter(|f| {
                let dev = (f.price - median).abs() / median;
                dev < max_deviation
            })
            .collect();

        if valid.is_empty() {
            return None;
        }

        // Weighted average
        let mut total_weight = 0.0;
        let mut weighted_sum = 0.0;

        for f in &valid {
            let w = self.weights.get(&f.source).copied().unwrap_or(0.25);
            weighted_sum += f.price * w;
            total_weight += w;
        }

        let price = if total_weight > 0.0 {
            weighted_sum / total_weight
        } else {
            median
        };

        // Calculate deviation
        let deviation = if valid.len() > 1 {
            let variance: f64 = valid
                .iter()
                .map(|f| (f.price - price).powi(2))
                .sum::<f64>()
                / valid.len() as f64;
            variance.sqrt()
        } else {
            0.0
        };

        Some(PriceResult {
            symbol: symbol.to_string(),
            price,
            confidence: total_weight,
            sources: valid.len() as i32,
            deviation,
        })
    }

    // Detect manipulation attempt
    pub fn detect_anomaly(&self, symbol: &str) -> Option<String> {
        let feeds = self.feeds.get(symbol)?;

        if feeds.len() < 3 {
            return None;
        }

        let prices: Vec<f64> = feeds.iter().map(|f| f.price).collect();
        let mean = prices.iter().sum::<f64>() / prices.len() as f64;

        // Check for sudden large moves
        for f in feeds {
            let change = (f.price - mean) / mean;
            if change.abs() > 0.1 {
                // >10% move - potential manipulation
                return Some(format!(
                    "{} moved {:.1}% from median",
                    f.source,
                    change * 100.0
                ));
            }
        }

        None
    }

    // Get best bid/ask
    pub fn get_best_bid_ask(&self, symbol: &str) -> Option<(f64, f64)> {
        let feeds = self.feeds.get(symbol)?;

        let mut best_bid = 0.0;
        let mut best_ask = f64::MAX;

        for f in feeds {
            if f.bid > best_bid {
                best_bid = f.bid;
            }
            if f.ask < best_ask {
                best_ask = f.ask;
            }
        }

        if best_bid > 0.0 && best_ask < f64::MAX {
            Some((best_bid, best_ask))
        } else {
            None
        }
    }

    // Cleanup stale feeds
    pub fn cleanup(&mut self, max_age_ms: i64) {
        let cutoff = now_ms() - max_age_ms;

        for feeds in self.feeds.values_mut() {
            feeds.retain(|f| f.timestamp > cutoff);
        }
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
    fn test_aggregate() {
        let mut agg = PriceAggregator::new();

        agg.set_weight("A", 0.5);
        agg.set_weight("B", 0.5);

        agg.add_feed("BTC", "A", 65000.0, 64995.0, 65005.0, 100.0);
        agg.add_feed("BTC", "B", 65100.0, 65095.0, 65105.0, 100.0);

        let result = agg.aggregate("BTC", 0.05);

        assert!(result.is_some());
    }
}