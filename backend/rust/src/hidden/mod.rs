// Hidden Order - Iceberg and Dark Pool
// Rust for hidden orders and iceberg routing

use std::collections::HashMap;

// Iceberg order (display partial size)
#[derive(Debug, Clone)]
pub struct IcebergOrder {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub total_size: f64,
    pub displayed_size: f64,
    pub price: f64,
    pub filled: f64,
    pub status: String,
}

impl IcebergOrder {
    pub fn new(id: &str, user_id: &str, symbol: &str, side: &str, total: f64, displayed: f64, price: f64) -> Self {
        IcebergOrder {
            id: id.to_string(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            total_size: total,
            displayed_size: displayed,
            price,
            filled: 0.0,
            status: "open".to_string(),
        }
    }

    pub fn update_display(&mut self) -> f64 {
        let remaining = self.total_size - self.filled;
        
        if remaining <= 0.0 {
            self.displayed_size = 0.0;
            self.status = "filled";
        } else if remaining < self.displayed_size {
            self.displayed_size = remaining;
        }
        
        self.displayed_size
    }

    pub fn fill(&mut self, size: f64) {
        self.filled += size;
        
        if self.filled >= self.total_size {
            self.status = "filled";
            self.displayed_size = 0.0;
        } else {
            self.update_display();
        }
    }
}

// Dark pool matcher
pub struct DarkMatcher {
    buy_orders: HashMap<String, IcebergOrder>,
    sell_orders: HashMap<String, IcebergOrder>,
}

impl DarkMatcher {
    pub fn new() -> Self {
        DarkMatcher {
            buy_orders: HashMap::new(),
            sell_orders: HashMap::new(),
        }
    }

    // Submit order
    pub fn submit(&mut self, user_id: &str, symbol: &str, side: &str, total: f64, displayed: f64, price: f64) -> String {
        let id = format!("ice_{}", now_ms());
        
        let order = IcebergOrder::new(&id, user_id, symbol, side, total, displayed, price);
        
        if side == "buy" {
            self.buy_orders.insert(id.clone(), order);
        } else {
            self.sell_orders.insert(id.clone(), order);
        }
        
        id
    }

    // Match orders
    pub fn match_orders(&mut self, symbol: &str) -> Vec<(String, String, f64, f64)> {
        // Sort buys descending by price, sells ascending
        let mut matches = Vec::new();
        
        for (_, buy) in &self.buy_orders {
            if buy.symbol != symbol || buy.status == "filled" || buy.status == "cancelled" {
                continue;
            }
            
            for (_, sell) in &self.sell_orders {
                if sell.symbol != symbol || sell.status == "filled" || sell.status == "cancelled" {
                    continue;
                }
                
                if buy.price >= sell.price {
                    let qty = sell.total_size.min(buy.total_size - buy.filled);
                    
                    matches.push((buy.id.clone(), sell.id.clone(), qty, (buy.price + sell.price) / 2.0));
                    
                    // Update fills
                    self.buy_orders.get_mut(&buy.id).map(|o| o.fill(qty));
                    self.sell_orders.get_mut(&sell.id).map(|o| o.fill(qty));
                }
            }
        }
        
        matches
    }

    // Get displayed orders (whatpublic sees)
    pub fn get_displayed(&self, symbol: &str) -> Vec<(&String, f64, f64)> {
        let mut displayed = Vec::new();
        
        for (_, buy) in &self.buy_orders {
            if buy.symbol == symbol && buy.status != "filled" {
                displayed.push((&buy.id, buy.displayed_size, buy.price));
            }
        }
        
        for (_, sell) in &self.sell_orders {
            if sell.symbol == symbol && sell.status != "filled" {
                displayed.push((&sell.id, sell.displayed_size, sell.price));
            }
        }
        
        displayed
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
    fn test_iceberg() {
        let mut matcher = DarkMatcher::new();
        
        matcher.submit("u1", "BTCUSDT", "buy", 100.0, 10.0, 65000.0);
        matcher.submit("u2", "BTCUSDT", "sell", 100.0, 10.0, 64900.0);
        
        let matches = matcher.match_orders("BTCUSDT");
        
        assert!(matches.len() > 0);
    }
}