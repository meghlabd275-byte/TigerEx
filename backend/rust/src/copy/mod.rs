// Copy Trading - Signal Following
// Rust for mirroring master trader positions

use std::collections::HashMap;

// Master signal
#[derive(Debug, Clone)]
pub struct MasterSignal {
    pub master_id: String,
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub price: f64,
    pub timestamp: i64,
}

// Follower position
#[derive(Debug, Clone)]
pub struct FollowerPos {
    pub id: String,
    pub master_id: String,
    pub follower_id: String,
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub entry_price: f64,
    pub pnl: f64,
    pub status: String,
}

// Signal router
pub struct SignalRouter {
    signals: HashMap<String, Vec<MasterSignal>>,
    positions: HashMap<String, FollowerPos>,
}

impl SignalRouter {
    pub fn new() -> Self {
        SignalRouter {
            signals: HashMap::new(),
            positions: HashMap::new(),
        }
    }

    // Receive signal from master
    pub fn receive_signal(&mut self, master_id: &str, symbol: &str, side: &str, size: f64, price: f64) {
        let signal = MasterSignal {
            master_id: master_id.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            size,
            price,
            timestamp: now_ms(),
        };

        self.signals
            .entry(master_id.to_string())
            .or_insert_with(Vec::new)
            .push(signal);
    }

    // Route signal to followers (simplified)
    pub fn route_signals(&self, master_id: &str) -> Vec<&MasterSignal> {
        self.signals.get(master_id).map(|v| v.as_slice()).unwrap_or(&[]).to_vec()
    }

    // Calculate copy size
    pub fn calculate_copy_size(&self, master_size: f64, ratio: f64, allocation: f64, master_eq: f64) -> f64 {
        let base = master_size * ratio;
        let max_allocation = allocation;
        
        if base > 0.0 && master_eq > 0.0 {
            let proportion = allocation / master_eq;
            master_size * proportion
        } else {
            base.min(max_allocation)
        }
    }

    // Create follower position
    pub fn create_position(&mut self, master_id: &str, follower_id: &str, symbol: &str, side: &str, size: f64, price: f64) -> String {
        let id = format!("fp_{}", now_ms());
        
        let pos = FollowerPos {
            id: id.clone(),
            master_id: master_id.to_string(),
            follower_id: follower_id.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            size,
            entry_price: price,
            pnl: 0.0,
            status: "open".to_string(),
        };

        self.positions.insert(id.clone(), pos);
        id
    }

    // Update PnL
    pub fn update_pnl(&mut self, position_id: &str, current_price: f64) {
        if let Some(pos) = self.positions.get_mut(position_id) {
            let pnl = if pos.side == "buy" {
                (current_price - pos.entry_price) * pos.size
            } else {
                (pos.entry_price - current_price) * pos.size
            };
            pos.pnl = pnl;
        }
    }

    // Get positions
    pub fn get_positions(&self, follower_id: &str) -> Vec<&FollowerPos> {
        self.positions
            .values()
            .filter(|p| p.follower_id == follower_id)
            .collect()
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
    fn test_copy() {
        let mut router = SignalRouter::new();
        
        router.receive_signal("m1", "BTCUSDT", "buy", 1.0, 65000.0);
        
        assert!(router.route_signals("m1").len() > 0);
    }
}