// P2P - Peer-to-Peer Trading Logic
// Rust for P2P matching and order management

use std::collections::HashMap;

// P2P ad
#[derive(Debug, Clone)]
pub struct P2PAd {
    pub id: String,
    pub user_id: String,
    pub ad_type: String, // buy, sell
    pub fiat: String,
    pub price_offset: f64,
    pub min_amount: f64,
    pub max_amount: f64,
    pub payment_methods: Vec<String>,
    pub status: String,
}

// P2P order
#[derive(Debug, Clone)]
pub struct P2POrder {
    pub id: String,
    pub ad_id: String,
    pub taker_id: String,
    pub symbol: String,
    pub amount: f64,
    pub price: f64,
    pub fiat_amount: f64,
    pub status: String, // pending, paying, completed, canceled, disputed
}

// Match engine
pub struct P2PEngine {
    ads: HashMap<String, P2PAd>,
    orders: HashMap<String, P2POrder>,
    user_ads: HashMap<String, Vec<String>>,
}

impl P2PEngine {
    pub fn new() -> Self {
        P2PEngine {
            ads: HashMap::new(),
            orders: HashMap::new(),
            user_ads: HashMap::new(),
        }
    }

    // Create ad
    pub fn create_ad(&mut self, user_id: &str, ad_type: &str, fiat: &str, offset: f64, min_amt: f64, max_amt: f64, payments: Vec<String>) -> String {
        let id = format!("p2p_{}", now_ms());
        
        let ad = P2PAd {
            id: id.clone(),
            user_id: user_id.to_string(),
            ad_type: ad_type.to_string(),
            fiat: fiat.to_string(),
            price_offset: offset,
            min_amount: min_amt,
            max_amount: max_amt,
            payment_methods: payments,
            status: "active".to_string(),
        };

        self.ads.insert(id.clone(), ad);
        
        // Index by user
        let user_key = user_id.to_string();
        if let Some(ads) = self.user_ads.get_mut(&user_key) {
            ads.push(id.clone());
        } else {
            self.user_ads.insert(user_key, vec![id.clone()]);
        }

        id
    }

    // Find matching ads
    pub fn find_matches(&self, ad_type: &str, fiat: &str, amount: f64) -> Vec<&P2PAd> {
        let mut matches = Vec::new();
        
        for (_, ad) in &self.ads {
            if ad.ad_type == ad_type 
                && ad.fiat == fiat 
                && ad.status == "active"
                && amount >= ad.min_amount
                && amount <= ad.max_amount 
            {
                matches.push(ad);
            }
        }

        matches
    }

    // Calculate price
    pub fn calculate_price(&self, ad: &P2PAd, market_price: f64) -> f64 {
        market_price * (1.0 + ad.price_offset)
    }

    // Create order
    pub fn create_order(&mut self, ad_id: &str, taker_id: &str, symbol: &str, amount: f64, market_price: f64) -> Result<String, String> {
        let ad = self.ads.get(ad_id)
            .ok_or("ad not found")?;

        if amount < ad.min_amount || amount > ad.max_amount {
            return Err("amount outside limits".to_string());
        }

        let price = self.calculate_price(ad, market_price);
        
        let order = P2POrder {
            id: format!("ord_{}", now_ms()),
            ad_id: ad_id.to_string(),
            taker_id: taker_id.to_string(),
            symbol: symbol.to_string(),
            amount,
            price,
            fiat_amount: price * amount,
            status: "pending".to_string(),
        };

        let order_id = order.id.clone();
        self.orders.insert(order_id.clone(), order);
        
        Ok(order_id)
    }

    // Confirm order
    pub fn confirm_order(&mut self, order_id: &str) -> Result<(), String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("order not found")?;

        order.status = "paying".to_string();
        Ok(())
    }

    // Complete order
    pub fn complete_order(&mut self, order_id: &str) -> Result<(), String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("order not found")?;

        if order.status != "paying" {
            return Err("invalid status".to_string());
        }

        order.status = "completed".to_string();
        Ok(())
    }

    // Cancel order
    pub fn cancel_order(&mut self, order_id: &str) -> Result<(), String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("order not found")?;

        order.status = "canceled".to_string();
        Ok(())
    }

    // Get user ads
    pub fn get_user_ads(&self, user_id: &str) -> Vec<&P2PAd> {
        let mut result = Vec::new();
        
        if let Some(ad_ids) = self.user_ads.get(user_id) {
            for ad_id in ad_ids {
                if let Some(ad) = self.ads.get(ad_id) {
                    result.push(ad);
                }
            }
        }

        result
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
    fn test_p2p() {
        let mut engine = P2PEngine::new();
        
        let ad_id = engine.create_ad("user1", "sell", "USD", -0.01, 100.0, 5000.0, vec!["bank".to_string()]);
        
        assert!(!ad_id.is_empty());
    }
}