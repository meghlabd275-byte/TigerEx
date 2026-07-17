//! Order Auction - Rust (batch auctions)
use std::collections::VecDeque;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct AuctionOrder { pub id: String, pub side: String, pub price: f64, pub qty: f64 }
pub struct OrderAuctionService { batches: RwLock<VecDeque<Vec<AuctionOrder>>>, active: RwLock<bool> }
impl OrderAuctionService {
    pub fn new() -> Self { Self { batches: RwLock::new(VecDeque::new()), active: RwLock::new(false) } }
    pub fn submit(&self, side: &str, price: f64, qty: f64) -> String { let id = format!("auct_{}", self.batches.read().unwrap().len()); id }
    pub fn execute_batch(&self) -> u32 { 0 }
    pub fn start_auction(&self) { *self.active.write().unwrap() = true; }
    pub fn end_auction(&self) { *self.active.write().unwrap() = false; }
}
impl Default for OrderAuctionService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = OrderAuctionService::new(); } }