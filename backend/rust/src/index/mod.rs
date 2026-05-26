// Index - Market Data Index
// Rust for market indices (VWAP, TWAP, Oracle)

use std::collections::HashMap;

// Price tick
#[derive(Debug, Clone)]
pub struct Tick {
    pub price: f64,
    pub size: f64,
    pub timestamp: i64,
}

// VWAP calculator
pub struct VWAPCalculator {
    ticks: Vec<Tick>,
    window_ms: i64,
}

impl VWAPCalculator {
    pub fn new(window_ms: i64) -> Self {
        VWAPCalculator {
            ticks: Vec::new(),
            window_ms,
        }
    }

    pub fn add_tick(&mut self, price: f64, size: f64) {
        let tick = Tick {
            price,
            size,
            timestamp: now_ms(),
        };
        self.ticks.push(tick);
        self.prune_old();
    }

    pub fn calculate(&self) -> f64 {
        if self.ticks.is_empty() {
            return 0.0;
        }

        let mut total_value = 0.0;
        let mut total_size = 0.0;

        for tick in &self.ticks {
            total_value += tick.price * tick.size;
            total_size += tick.size;
        }

        if total_size > 0.0 {
            total_value / total_size
        } else {
            0.0
        }
    }

    fn prune_old(&mut self) {
        let cutoff = now_ms() - self.window_ms;
        self.ticks.retain(|t| t.timestamp > cutoff);
    }

    pub fn reset(&mut self) {
        self.ticks.clear();
    }
}

// TWAP calculator
pub struct TWAPCalculator {
    prices: Vec<f64>,
    window_ms: i64,
}

impl TWAPCalculator {
    pub fn new(window_ms: i64) -> Self {
        TWAPCalculator {
            prices: Vec::new(),
            window_ms,
        }
    }

    pub fn add_price(&mut self, price: f64) {
        self.prices.push(price);
        self.prune_old();
    }

    pub fn calculate(&self) -> f64 {
        if self.prices.is_empty() {
            return 0.0;
        }

        let sum: f64 = self.prices.iter().sum();
        sum / self.prices.len() as f64
    }

    fn prune_old(&mut self) {
        // Simplified - in production use timestamps
        if self.prices.len() > 1000 {
            self.prices.drain(..self.prices.len() / 2);
        }
    }
}

// Index price feed
pub struct IndexPrice {
    pub symbol: String,
    pub price: f64,
    pub change_24h: f64,
    pub volume_24h: f64,
    pub timestamp: i64,
}

impl IndexPrice {
    pub fn new(symbol: &str, price: f64) -> Self {
        IndexPrice {
            symbol: symbol.to_string(),
            price,
            change_24h: 0.0,
            volume_24h: 0.0,
            timestamp: now_ms(),
        }
    }

    pub fn update(&mut self, price: f64, volume: f64) {
        let change = price - self.price;
        self.change_24h = (change / self.price) * 100.0;
        self.volume_24h += volume;
        self.price = price;
        self.timestamp = now_ms();
    }
}

// Index store
pub struct IndexStore {
    prices: HashMap<String, IndexPrice>,
}

impl IndexStore {
    pub fn new() -> Self {
        IndexStore {
            prices: HashMap::new(),
        }
    }

    pub fn update(&mut self, symbol: &str, price: f64, volume: f64) {
        if let Some(idx) = self.prices.get_mut(symbol) {
            idx.update(price, volume);
        } else {
            self.prices.insert(symbol.to_string(), IndexPrice::new(symbol, price));
        }
    }

    pub fn get(&self, symbol: &str) -> Option<&IndexPrice> {
        self.prices.get(symbol)
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
    fn test_vwap() {
        let mut vwap = VWAPCalculator::new(60000);
        
        vwap.add_tick(65000.0, 1.0);
        vwap.add_tick(65100.0, 2.0);
        
        assert!(vwap.calculate() > 0.0);
    }
}