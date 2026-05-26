//! Social Trading - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Post { pub id: String, pub user_id: String, pub content: String, pub likes: u32, pub timestamp: i64 }

pub struct SocialService { posts: Vec<Post>, followers: HashMap<String, Vec<String>> }

impl SocialService { pub fn new() -> Self { Self { posts: vec![], followers: HashMap::new() } }
    pub fn post(&mut self, uid: &str, content: &str) -> String {
        let id = format!("POST_{}", self.posts.len());
        self.posts.push(Post { id: id.clone(), user_id: uid.to_string(), content: content.to_string(), likes: 0, timestamp: now_ms() });
        id
    }
    pub fn follow(&mut self, who: &str, target: &str) {
        self.followers.entry(who.to_string()).or_insert_with(Vec::new).push(target.to_string());
    }
    pub fn like(&mut self, post_id: &str) {
        if let Some(p) = self.posts.iter_mut().find(|p| p.id == post_id) { p.likes += 1; }
    }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut s = SocialService::new(); let id = s.post("user1", "Hello world"); assert!(!id.is_empty()); } }
