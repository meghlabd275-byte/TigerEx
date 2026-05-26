//! TigerEx Price Oracle - Rust Implementation
//! 
//! Real-time price feeds from multiple sources
//! Aggregated pricing for accurate market data

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// ============================================================================
// PRICE DATA
/// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceData {
    pub symbol: String,
    pub price: f64,
    pub volume_24h: f64,
    pub change_24h: f64,
    pub change_percent_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub sources: Vec<PriceSource>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSource {
    pub name: String,
    pub price: f64,
    pub weight: f64,
    pub latency_ms: u64,
}

/// ============================================================================
// ORACLE
/// ============================================================================

pub struct PriceOracle {
    prices: HashMap<String, PriceData>,
    sources: HashMap<String, Vec<SourceConfig>>,
}

#[derive(Debug, Clone)]
struct SourceConfig {
    name: String,
    weight: f64,
    enabled: bool,
}

impl PriceOracle {
    pub fn new() -> Self {
        Self {
            prices: HashMap::new(),
            sources: HashMap::new(),
        }
    }

    /// Register price source
    pub fn register_source(&mut self, symbol: &str, name: &str, weight: f64) {
        let source = SourceConfig {
            name: name.to_string(),
            weight,
            enabled: true,
        };
        
        self.sources
            .entry(symbol.to_string())
            .or_insert_with(Vec::new)
            .push(source);
    }

    /// Update price from source
    pub fn update_price(&mut self, symbol: &str, source: &str, price: f64) {
        let entry = self.prices.entry(symbol.to_string()).or_insert_with(|| {
            PriceData {
                symbol: symbol.to_string(),
                price: 0.0,
                volume_24h: 0.0,
                change_24h: 0.0,
                change_percent_24h: 0.0,
                high_24h: 0.0,
                low_24h: f64::MAX,
                sources: Vec::new(),
                timestamp: current_timestamp(),
            }
        });

        // Update or add source
        let source_exists = entry.sources.iter_mut().find(|s| s.name == source);
        
        if let Some(s) = source_exists {
            s.price = price;
        } else {
            entry.sources.push(PriceSource {
                name: source.to_string(),
                price,
                weight: 1.0,
                latency_ms: 0,
            });
        }

        // Recalculate weighted average
        self.recalculate_price(symbol);
    }

    /// Recalculate aggregated price
    fn recalculate_price(&mut self, symbol: &str) {
        if let Some(data) = self.prices.get_mut(symbol) {
            if data.sources.is_empty() {
                return;
            }

            let total_weight: f64 = data.sources.iter().map(|s| s.weight).sum();
            let weighted_sum: f64 = data.sources.iter()
                .map(|s| s.price * s.weight)
                .sum();

            data.price = if total_weight > 0.0 {
                weighted_sum / total_weight
            } else {
                data.sources[0].price
            };
            
            data.timestamp = current_timestamp();
        }
    }

    /// Get price for symbol
    pub fn get_price(&self, symbol: &str) -> Option<&PriceData> {
        self.prices.get(symbol)
    }

    /// Get all prices
    pub fn get_all_prices(&self) -> Vec<&PriceData> {
        self.prices.values().collect()
    }

    /// Update 24h stats
    pub fn update_24h(&mut self, symbol: &str, volume: f64, high: f64, low: f64) {
        if let Some(data) = self.prices.get_mut(symbol) {
            data.volume_24h = volume;
            if high > data.high_24h {
                data.high_24h = high;
            }
            if low < data.low_24h || data.low_24h == 0.0 {
                data.low_24h = low;
            }
            
            let open_price = data.price - data.change_24h;
            if open_price > 0.0 {
                data.change_24h = data.price - open_price;
                data.change_percent_24h = (data.change_24h / open_price) * 100.0;
            }
        }
    }

    /// Health check - verify sources
    pub fn health_check(&self, symbol: &str) -> OracleHealth {
        if let Some(data) = self.prices.get(symbol) {
            if data.sources.is_empty() {
                return OracleHealth::NoSources;
            }

            let avg_latency: u64 = data.sources.iter()
                .map(|s| s.latency_ms)
                .sum::<u64>() / data.sources.len() as u64;

            if avg_latency > 1000 {
                return OracleHealth::Degraded(avg_latency);
            }
            
            OracleHealth::Healthy
        } else {
            OracleHealth::NoData
        }
    }
}

pub enum OracleHealth {
    Healthy,
    Degraded(u64),
    NoSources,
    NoData,
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oracle() {
        let mut oracle = PriceOracle::new();
        
        oracle.register_source("BTC/USDT", "binance", 1.0);
        oracle.register_source("BTC/USDT", "coinbase", 0.8);
        
        oracle.update_price("BTC/USDT", "binance", 50000.0);
        oracle.update_price("BTC/USDT", "coinbase", 50100.0);
        
        let price = oracle.get_price("BTC/USDT");
        assert!(price.is_some());
    }
}