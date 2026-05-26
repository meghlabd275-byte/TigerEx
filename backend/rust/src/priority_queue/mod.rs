// Priority Queue - Order Priority Management
// Rust for order prioritization in matching engine

use std::collections::{BinaryHeap, HashMap};

// Order wrapper for priority queue
#[derive(Debug, Clone)]
pub struct PriorityOrder {
    pub order_id: String,
    pub user_id: String,
    pub price: f64,
    pub size: f64,
    pub timestamp: i64,
    pub priority: i32,
}

impl PartialOrd for PriorityOrder {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        other.priority.partial_cmp(&self.priority)
    }
}

impl Ord for PriorityOrder {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.priority.cmp(&self.priority)
    }
}

impl PartialEq for PriorityOrder {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority
    }
}

impl Eq for PriorityOrder {}

// Priority queue for bids (max-heap by price)
pub struct BidHeap {
    heap: BinaryHeap<PriorityOrder>,
    orders: HashMap<String, PriorityOrder>,
}

impl BidHeap {
    pub fn new() -> Self {
        BidHeap {
            heap: BinaryHeap::new(),
            orders: HashMap::new(),
        }
    }

    pub fn push(&mut self, order: PriorityOrder) {
        self.heap.push(order.clone());
        self.orders.insert(order.order_id.clone(), order);
    }

    pub fn pop(&mut self) -> Option<PriorityOrder> {
        self.heap.pop()
    }

    pub fn peek(&self) -> Option<&PriorityOrder> {
        self.heap.peek()
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    pub fn remove(&mut self, order_id: &str) -> Option<PriorityOrder> {
        self.orders.remove(order_id)
    }
}

// Ask heap (min-heap by price)
pub struct AskHeap {
    heap: BinaryHeap<Reverse<PriorityOrder>>,
    orders: HashMap<String, PriorityOrder>,
}

impl AskHeap {
    pub fn new() -> Self {
        AskHeap {
            heap: BinaryHeap::new(),
            orders: HashMap::new(),
        }
    }

    pub fn push(&mut self, order: PriorityOrder) {
        self.heap.push(Reverse(order.clone()));
        self.orders.insert(order.order_id.clone(), order);
    }

    pub fn pop(&mut self) -> Option<PriorityOrder> {
        self.heap.pop().map(|r| r.0)
    }

    pub fn peek(&self) -> Option<&PriorityOrder> {
        self.heap.peek().map(|r| &r.0)
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }
}

// Reverse for min-heap
#[derive(Debug, Clone)]
pub struct Reverse<T>(pub T);

impl<T: PartialOrd> PartialOrd for Reverse<T> {
    fn partial_cmp(&self, other: &Reverse<T>) -> Option<std::cmp::Ordering> {
        other.0.partial_cmp(&self.0)
    }
}

impl<T: Ord> Ord for Reverse<T> {
    fn cmp(&self, other: &Reverse<T>) -> std::cmp::Ordering {
        other.0.cmp(&self.0)
    }
}

impl<T: Eq> Eq for Reverse<T> {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority() {
        let mut bids = BidHeap::new();

        bids.push(PriorityOrder {
            order_id: "o1".to_string(),
            user_id: "u1".to_string(),
            price: 65000.0,
            size: 1.0,
            timestamp: now_ms(),
            priority: 1,
        });

        assert!(!bids.is_empty());
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}