//! P2P Trading - Rust Implementation
//! 
//! Peer-to-peer trading with escrow

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// P2P offer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2POffer {
    pub id: String,
    pub maker_id: String,
    pub side: String,  // "buy" or "sell"
    pub asset: String,
    pub amount: f64,
    pub price: f64,
    pub payment_method: String,
    pub status: OfferStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OfferStatus { Active, InProgress, Completed, Cancelled }

/// P2P order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2POrder {
    pub id: String,
    pub offer_id: String,
    pub maker_id: String,
    pub taker_id: String,
    pub amount: f64,
    pub price: f64,
    pub status: OrderStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus { Created, Paying, Paid, Released, Cancelled, Disputed }

/// Escrow state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Escrow {
    pub order_id: String,
    pub seller_id: String,
    pub buyer_id: String,
    pub asset: String,
    pub amount: f64,
    pub price: f64,
    pub status: EscrowStatus,
    pub locked_at: i64,
    pub released_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EscrowStatus { Locked, Released, Disputed, Cancelled }

pub struct P2PService {
    offers: HashMap<String, P2POffer>,
    orders: HashMap<String, P2POrder>,
    escrow: HashMap<String, Escrow>,
    offer_counter: u64,
}

impl P2PService {
    pub fn new() -> Self {
        Self {
            offers: HashMap::new(),
            orders: HashMap::new(),
            escrow: HashMap::new(),
            offer_counter: 0,
        }
    }

    /// Create offer
    pub fn create_offer(&mut self, maker_id: &str, side: &str, asset: &str,
                       amount: f64, price: f64, payment_method: &str) -> P2POffer {
        self.offer_counter += 1;
        
        let offer = P2POffer {
            id: format!("OFFER{}", self.offer_counter),
            maker_id: maker_id.to_string(),
            side: side.to_string(),
            asset: asset.to_string(),
            amount,
            price,
            payment_method: payment_method.to_string(),
            status: OfferStatus::Active,
        };

        self.offers.insert(offer.id.clone(), offer.clone());
        offer
    }

    /// Take offer
    pub fn take_offer(&mut self, offer_id: &str, taker_id: &str) -> Result<P2POrder, String> {
        let offer = self.offers.get_mut(offer_id)
            .ok_or("Offer not found")?;

        if offer.status != OfferStatus::Active {
            return Err("Offer not available".to_string());
        }

        let order = P2POrder {
            id: format!("ORDER{}", current_timestamp_ms()),
            offer_id: offer_id.to_string(),
            maker_id: offer.maker_id.clone(),
            taker_id: taker_id.to_string(),
            amount: offer.amount,
            price: offer.price,
            status: OrderStatus::Created,
            created_at: current_timestamp_ms(),
        };

        offer.status = OfferStatus::InProgress;
        self.orders.insert(order.id.clone(), order.clone());

        // Lock in escrow
        let escrow = Escrow {
            order_id: order.id.clone(),
            seller_id: offer.maker_id.clone(),
            buyer_id: taker_id.to_string(),
            asset: offer.asset.clone(),
            amount: offer.amount,
            price: offer.price,
            status: EscrowStatus::Locked,
            locked_at: current_timestamp_ms(),
            released_at: None,
        };
        self.escrow.insert(order.id.clone(), escrow);

        Ok(order)
    }

    /// Release escrow
    pub fn release(&mut self, order_id: &str) -> Result<(), String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("Order not found")?;
        order.status = OrderStatus::Released;

        let escrow = self.escrow.get_mut(order_id)
            .ok_or("Escrow not found")?;
        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(current_timestamp_ms());

        let offer = self.offers.get_mut(&order.offer_id)
            .ok_or("Offer not found")?;
        offer.status = OfferStatus::Completed;

        Ok(())
    }

    /// Get offers
    pub fn get_offers(&self, asset: &str, side: &str) -> Vec<&P2POffer> {
        self.offers.values()
            .filter(|o| o.asset == asset && o.side == side && o.status == OfferStatus::Active)
            .collect()
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_offer() {
        let mut service = P2PService::new();
        let offer = service.create_offer("user1", "sell", "USDT", 1000.0, 1.0, "bank");
        assert_eq!(offer.side, "sell");
    }
}