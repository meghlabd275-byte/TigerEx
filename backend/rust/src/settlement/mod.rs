// Settlement Engine - Trade Settlement and Reconciliation
// Rust for deterministic trade settlement

use std::collections::HashMap;

// Settlement side
#[derive(Debug, Clone)]
pub struct SettlementSide {
    pub user_id: String,
    pub symbol: String,
    pub amount: f64,
    pub side: String, // maker, taker
}

// Trade to settle
#[derive(Debug, Clone)]
pub struct TradeSettlement {
    pub trade_id: String,
    pub price: f64,
    pub quantity: f64,
    pub maker_side: SettlementSide,
    pub taker_side: SettlementSide,
    pub fee_maker: f64,
    pub fee_taker: f64,
    pub timestamp: i64,
    pub settled: bool,
}

// Settlement result
#[derive(Debug, Clone)]
pub struct SettlementResult {
    pub trade_id: String,
    pub maker_received: f64,
    pub taker_received: f64,
    pub maker_fee: f64,
    pub taker_fee: f64,
    pub settled_at: i64,
}

// Batch settlement
#[derive(Debug, Clone)]
pub struct BatchSettlement {
    pub batch_id: String,
    pub trades: Vec<TradeSettlement>,
    pub total_volume: f64,
    pub total_fees: f64,
    pub settled_count: usize,
    pub failed_count: usize,
}

// Fee config
#[derive(Debug, Clone)]
pub struct FeeConfig {
    pub maker_fee: f64,
    pub taker_fee: f64,
    pub volume_discount: f64,
    pub tier_discounts: HashMap<String, f64>, // VIP tier -> discount
}

impl Default for FeeConfig {
    fn default() -> Self {
        FeeConfig {
            maker_fee: 0.001,
            taker_fee: 0.001,
            volume_discount: 0.0001,
            tier_discounts: {
                let mut m = HashMap::new();
                m.insert("VIP1".to_string(), 0.1);
                m.insert("VIP2".to_string(), 0.2);
                m.insert("VIP3".to_string(), 0.3);
                m.insert("VIP4".to_string(), 0.4);
                m
            },
        }
    }
}

// Settlement engine
pub struct SettlementEngine {
    unsettled: HashMap<String, TradeSettlement>,
    settled: HashMap<String, SettlementResult>,
    batches: Vec<BatchSettlement>,
    config: FeeConfig,
}

impl SettlementEngine {
    pub fn new(config: FeeConfig) -> Self {
        SettlementEngine {
            unsettled: HashMap::new(),
            settled: HashMap::new(),
            batches: Vec::new(),
            config,
        }
    }

    // Add trade for settlement
    pub fn add_trade(&mut self, trade: TradeSettlement) {
        self.unsettled.insert(trade.trade_id.clone(), trade);
    }

    // Calculate fees
    pub fn calculate_fees(&self, side: &SettlementSide, is_maker: bool) -> f64 {
        let base_fee = if is_maker { self.config.maker_fee } else { self.config.taker_fee };
        base_fee * side.amount
    }

    // Settle single trade
    pub fn settle_trade(&mut self, trade_id: &str) -> Result<SettlementResult, String> {
        let trade = self.unsettled.remove(trade_id)
            .ok_or("trade not found")?;

        let maker_fee = self.calculate_fees(&trade.maker_side, true);
        let taker_fee = self.calculate_fees(&trade.taker_side, false);

        // Calculate received amounts
        let maker_value = trade.price * trade.quantity;
        let taker_value = trade.price * trade.quantity;

        let maker_received = maker_value - maker_fee;
        let taker_received = taker_value - taker_fee;

        let result = SettlementResult {
            trade_id: trade_id.to_string(),
            maker_received,
            taker_received,
            maker_fee,
            taker_fee,
            settled_at: now_ms(),
        };

        self.settled.insert(trade_id.to_string(), result.clone());

        Ok(result)
    }

    // Batch settle
    pub fn batch_settle(&mut self, trade_ids: &[String]) -> BatchSettlement {
        let batch_id = format!("batch_{}", now_ms());
        
        let mut settled_count = 0;
        let mut failed_count = 0;
        let mut total_volume = 0.0;
        let mut total_fees = 0.0;

        for tid in trade_ids {
            if let Ok(result) = self.settle_trade(tid) {
                settled_count += 1;
                total_volume += result.maker_received + result.taker_received;
                total_fees += result.maker_fee + result.taker_fee;
            } else {
                failed_count += 1;
            }
        }

        let batch = BatchSettlement {
            batch_id,
            trades: Vec::new(),
            total_volume,
            total_fees,
            settled_count,
            failed_count,
        };

        self.batches.push(batch);
        
        batch
    }

    // Get settlement status
    pub fn get_status(&self, trade_id: &str) -> Option<String> {
        if self.unsettled.contains_key(trade_id) {
            return Some("unsettled".to_string());
        }
        if self.settled.contains_key(trade_id) {
            return Some("settled".to_string());
        }
        None
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
    fn test_settlement() {
        let config = FeeConfig::default();
        let mut engine = SettlementEngine::new(config);

        let trade = TradeSettlement {
            trade_id: "trade_1".to_string(),
            price: 65000.0,
            quantity: 1.0,
            maker_side: SettlementSide {
                user_id: "maker".to_string(),
                symbol: "BTCUSDT".to_string(),
                amount: 1.0,
                side: "maker".to_string(),
            },
            taker_side: SettlementSide {
                user_id: "taker".to_string(),
                symbol: "BTCUSDT".to_string(),
                amount: 1.0,
                side: "taker".to_string(),
            },
            fee_maker: 0.0,
            fee_taker: 0.0,
            timestamp: now_ms(),
            settled: false,
        };

        engine.add_trade(trade);

        let result = engine.settle_trade("trade_1").unwrap();

        println!("Maker receives: {} Taker receives: {}", result.maker_received, result.taker_received);
    }
}