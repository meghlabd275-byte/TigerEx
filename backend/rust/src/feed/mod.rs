// Feed - Social Trading Signals
// Rust for social trading feed and engagement

use std::collections::HashMap;

// Post/ignal
#[derive(Debug, Clone)]
pub struct Signal {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: String,
    pub entry: f64,
    pub stop_loss: f64,
    pub target: f64,
    pub likes: i32,
    pub shares: i32,
    pub comments: i32,
    pub timestamp: i64,
    pub status: String,
}

// User profile
#[derive(Debug, Clone)]
pub struct Profile {
    pub user_id: String,
    pub username: String,
    pub bio: String,
    pub followers: i32,
    pub following: i32,
    pub rank: String,
    pub win_rate: f64,
    pub pnl_30d: f64,
}

// Feed aggregator
pub struct FeedAggregator {
    posts: HashMap<String, Signal>,
    user_feeds: HashMap<String, Vec<String>>,
}

impl FeedAggregator {
    pub fn new() -> Self {
        FeedAggregator {
            posts: HashMap::new(),
            user_feeds: HashMap::new(),
        }
    }

    // Create post
    pub fn create_post(&mut self, user_id: &str, symbol: &str, side: &str, entry: f64, stop_loss: f64, target: f64) -> String {
        let id = format!("sig_{}", now_ms());
        
        let signal = Signal {
            id: id.clone(),
            user_id: user_id.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            entry,
            stop_loss,
            target,
            likes: 0,
            shares: 0,
            comments: 0,
            timestamp: now_ms(),
            status: "active".to_string(),
        };

        self.posts.insert(id.clone(), signal);
        
        // Add to user feed
        self.user_feeds
            .entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(id.clone());

        id
    }

    // Like
    pub fn like_post(&mut self, post_id: &str) {
        if let Some(post) = self.posts.get_mut(post_id) {
            post.likes += 1;
        }
    }

    // Get user feed
    pub fn get_user_feed(&self, user_id: &str) -> Vec<&Signal> {
        let mut feed = Vec::new();
        
        if let Some(post_ids) = self.user_feeds.get(user_id) {
            for pid in post_ids {
                if let Some(post) = self.posts.get(pid) {
                    feed.push(post);
                }
            }
        }
        
        feed.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        feed
    }

    // Get trending symbols
    pub fn get_trending(&self, limit: usize) -> Vec<(&String, i32)> {
        let mut counts: HashMap<String, i32> = HashMap::new();
        
        for (_, post) in &self.posts {
            *counts.entry(&post.symbol).or_insert(0) += post.likes;
        }
        
        let mut sorted: Vec<_> = counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        
        sorted.into_iter().take(limit).collect()
    }

    // Verify signal (check if hit target or stop)
    pub fn verify_signal(&self, post_id: &str, current_price: f64) -> Option<String> {
        if let Some(post) = self.posts.get(post_id) {
            if post.status != "active" {
                return None;
            }
            
            if current_price >= post.target {
                return Some("win".to_string());
            } else if current_price <= post.stop_loss {
                return Some("loss".to_string());
            }
        }
        
        None
    }

    // Get leaderboard
    pub fn get_leaderboard(&self, limit: usize) -> Vec<(&String, f64)> {
        // Simplified - return mock data
        // In production, aggregate from user stats
        vec![
            ("trader1".to_string(), 15000.0),
            ("trader2".to_string(), 12000.0),
        ]
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
    fn test_feed() {
        let mut feed = FeedAggregator::new();
        
        feed.create_post("u1", "BTCUSDT", "long", 65000, 64000, 70000);
        
        assert!(feed.get_trending(5).len() > 0);
    }
}