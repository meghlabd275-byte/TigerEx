//! TigerEx P2P Trading Service - Rust

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// P2P Advertisement
#[derive(Debug, Clone)]
pub struct Advertisement {
    pub id: String,
    pub user_id: String,
    pub side: String,
    pub asset: String,
    pub fiat: String,
    pub price_offset: f64,
    pub limits: (f64, f64),
    pub payment_methods: Vec<String>,
    pub status: String,
}

/// P2P Order
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub ad_id: String,
    pub buyer_id: String,
    pub amount: f64,
    pub price: f64,
    pub status: String,
    pub created_at: u64,
}

/// P2P Trading Service
pub struct P2PService {
    ads: RwLock<HashMap<String, Advertisement>>,
    orders: RwLock<HashMap<String, Order>>,
}

impl P2PService {
    pub fn new() -> Self { Self { ads: RwLock::new(HashMap::new()), orders: RwLock::new(HashMap::new()) } }

    pub fn create_ad(&self, ad: Advertisement) -> Result<String, String> {
        let id = ad.id.clone();
        self.ads.write().unwrap().insert(id.clone(), ad);
        Ok(id)
    }

    pub fn create_order(&self, ad_id: &str, buyer_id: &str, amount: f64) -> Result<Order, String> {
        let ads = self.ads.read().unwrap();
        let ad = ads.get(ad_id).ok_or("Ad not found")?.clone();
        drop(ads);
        
        if amount < ad.limits.0 || amount > ad.limits.1 { return Err("Outside limits".to_string()); }
        
        let price = ad.price_offset;
        let order = Order { id: generate_id(), ad_id: ad_id.to_string(), buyer_id: buyer_id.to_string(), amount, price, status: "pending".to_string(), created_at: current_timestamp() };
        
        let id = order.id.clone();
        self.orders.write().unwrap().insert(id, order.clone());
        Ok(order)
    }

    pub fn mark_paid(&self, order_id: &str) -> Result<(), String> {
        let mut orders = self.orders.write().unwrap();
        if let Some(o) = orders.get_mut(order_id) { o.status = "paid".to_string(); Ok(()) } else { Err("Order not found".to_string()) }
    }

    pub fn release(&self, order_id: &str) -> Result<(), String> {
        let mut orders = self.orders.write().unwrap();
        if let Some(o) = orders.get_mut(order_id) { o.status = "released".to_string(); Ok(()) } else { Err("Order not found".to_string()) }
    }

    pub fn cancel(&self, order_id: &str) -> Result<(), String> {
        let mut orders = self.orders.write().unwrap();
        if let Some(o) = orders.get_mut(order_id) {
            if o.status == "pending" {
                o.status = "cancelled".to_string();
                Ok(())
            } else {
                Err("Cannot cancel".to_string())
            }
        } else {
            Err("Order not found".to_string())
        }
    }
}

impl Default for P2PService { fn default() -> Self { Self::new() } }

fn current_timestamp() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }
fn generate_id() -> String { format!("p2p_{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()) }

#[cfg(test)]
mod tests {
    use super::*;

    fn ad(id: &str, side: &str) -> Advertisement {
        Advertisement {
            id: id.to_string(),
            user_id: "maker".to_string(),
            side: side.to_string(),
            asset: "USDT".to_string(),
            fiat: "USD".to_string(),
            price_offset: 1.0,
            limits: (10.0, 5_000.0),
            payment_methods: vec!["bank".to_string()],
            status: "active".to_string(),
        }
    }

    #[test]
    fn order_must_respect_ad_limits() {
        let service = P2PService::new();
        service.create_ad(ad("ad1", "sell")).unwrap();

        assert!(service.create_order("ad1", "buyer", 5.0).is_err());
        assert!(service.create_order("ad1", "buyer", 10_000.0).is_err());

        let order = service.create_order("ad1", "buyer", 100.0).unwrap();
        assert_eq!(order.status, "pending");
        assert_eq!(order.amount, 100.0);
    }

    #[test]
    fn order_lifecycle() {
        let service = P2PService::new();
        service.create_ad(ad("ad1", "sell")).unwrap();
        let order = service.create_order("ad1", "buyer", 100.0).unwrap();

        service.mark_paid(&order.id).unwrap();
        assert_eq!(service.orders.read().unwrap()[&order.id].status, "paid");

        service.release(&order.id).unwrap();
        assert_eq!(service.orders.read().unwrap()[&order.id].status, "released");

        // A released order can no longer be cancelled.
        assert!(service.cancel(&order.id).is_err());
    }

    #[test]
    fn only_pending_orders_can_be_cancelled() {
        let service = P2PService::new();
        service.create_ad(ad("ad1", "sell")).unwrap();
        let order = service.create_order("ad1", "buyer", 100.0).unwrap();

        service.cancel(&order.id).unwrap();
        assert_eq!(service.orders.read().unwrap()[&order.id].status, "cancelled");
        assert!(service.cancel(&order.id).is_err());
        assert!(service.cancel("missing").is_err());
    }

    #[test]
    fn unknown_ad_is_rejected() {
        let service = P2PService::new();
        assert!(service.create_order("nope", "buyer", 100.0).is_err());
    }
}