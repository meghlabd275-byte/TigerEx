//! Copy trading.
//!
//! The previous implementation ignored the allocation entirely, allowed the
//! same user to follow the same leader repeatedly (each time pushing a
//! duplicate follower record), never incremented or decremented the leader's
//! follower count, and accepted any allocation including negative and NaN.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Leader {
    pub user_id: String,
    pub returns: f64,
    pub followers: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Follower {
    pub user_id: String,
    pub leader_id: String,
    pub allocation: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CopyError {
    LeaderNotFound(String),
    SelfFollow,
    AlreadyFollowing(String),
    NotFollowing(String),
    InvalidAllocation(f64),
}

impl std::fmt::Display for CopyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CopyError::LeaderNotFound(l) => write!(f, "unknown leader: {l}"),
            CopyError::SelfFollow => write!(f, "a user cannot copy themselves"),
            CopyError::AlreadyFollowing(l) => write!(f, "already following {l}"),
            CopyError::NotFollowing(l) => write!(f, "not following {l}"),
            CopyError::InvalidAllocation(a) => {
                write!(f, "allocation {a} must be finite and positive")
            }
        }
    }
}

impl std::error::Error for CopyError {}

pub struct CopyTradingService {
    leaders: RwLock<HashMap<String, Leader>>,
    /// follower user id -> the leaders they copy.
    followers: RwLock<HashMap<String, Vec<Follower>>>,
}

impl CopyTradingService {
    pub fn new() -> Self {
        Self {
            leaders: RwLock::new(HashMap::new()),
            followers: RwLock::new(HashMap::new()),
        }
    }

    pub fn add_leader(&self, user_id: &str) {
        self.leaders.write().unwrap().insert(
            user_id.to_string(),
            Leader {
                user_id: user_id.to_string(),
                returns: 0.0,
                followers: 0,
            },
        );
    }

    /// Follow a leader with the given allocation.
    pub fn follow(
        &self,
        user_id: &str,
        leader_id: &str,
        allocation: f64,
    ) -> Result<(), CopyError> {
        if user_id == leader_id {
            return Err(CopyError::SelfFollow);
        }
        if !allocation.is_finite() || allocation <= 0.0 {
            return Err(CopyError::InvalidAllocation(allocation));
        }
        if !self.leaders.read().unwrap().contains_key(leader_id) {
            return Err(CopyError::LeaderNotFound(leader_id.to_string()));
        }

        let mut followers = self.followers.write().unwrap();
        let entry = followers.entry(user_id.to_string()).or_default();
        if entry.iter().any(|f| f.leader_id == leader_id) {
            return Err(CopyError::AlreadyFollowing(leader_id.to_string()));
        }
        entry.push(Follower {
            user_id: user_id.to_string(),
            leader_id: leader_id.to_string(),
            allocation,
        });
        drop(followers);

        if let Some(leader) = self.leaders.write().unwrap().get_mut(leader_id) {
            leader.followers += 1;
        }
        Ok(())
    }

    /// Stop copying a leader.
    pub fn unfollow(&self, user_id: &str, leader_id: &str) -> Result<(), CopyError> {
        let mut followers = self.followers.write().unwrap();
        let entry = followers
            .get_mut(user_id)
            .ok_or_else(|| CopyError::NotFollowing(leader_id.to_string()))?;

        let before = entry.len();
        entry.retain(|f| f.leader_id != leader_id);
        if entry.len() == before {
            return Err(CopyError::NotFollowing(leader_id.to_string()));
        }
        drop(followers);

        if let Some(leader) = self.leaders.write().unwrap().get_mut(leader_id) {
            leader.followers = leader.followers.saturating_sub(1);
        }
        Ok(())
    }

    /// Total allocation a user has committed to copying.
    pub fn total_allocation(&self, user_id: &str) -> f64 {
        self.followers
            .read()
            .unwrap()
            .get(user_id)
            .map(|f| f.allocation_sum())
            .unwrap_or(0.0)
    }

    pub fn leader(&self, leader_id: &str) -> Option<Leader> {
        self.leaders.read().unwrap().get(leader_id).cloned()
    }

    pub fn following(&self, user_id: &str) -> Vec<Follower> {
        self.followers
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for CopyTradingService {
    fn default() -> Self {
        Self::new()
    }
}

trait AllocationSum {
    fn allocation_sum(&self) -> f64;
}

impl AllocationSum for Vec<Follower> {
    fn allocation_sum(&self) -> f64 {
        self.iter().map(|f| f.allocation).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> CopyTradingService {
        let svc = CopyTradingService::new();
        svc.add_leader("alice");
        svc
    }

    #[test]
    fn follow_records_the_allocation_and_counts_the_follower() {
        let svc = service();
        svc.follow("bob", "alice", 5_000.0).unwrap();

        assert_eq!(svc.total_allocation("bob"), 5_000.0);
        assert_eq!(svc.leader("alice").unwrap().followers, 1);
    }

    #[test]
    fn invalid_allocations_are_rejected() {
        let svc = service();
        // The old implementation accepted any allocation value.
        assert!(svc.follow("bob", "alice", -100.0).is_err());
        assert!(svc.follow("bob", "alice", f64::NAN).is_err());
        assert!(svc.follow("bob", "alice", 0.0).is_err());
        assert_eq!(svc.leader("alice").unwrap().followers, 0);
    }

    #[test]
    fn a_user_cannot_follow_the_same_leader_twice() {
        let svc = service();
        svc.follow("bob", "alice", 100.0).unwrap();

        // The old implementation pushed a duplicate record each time.
        assert_eq!(
            svc.follow("bob", "alice", 100.0).unwrap_err(),
            CopyError::AlreadyFollowing("alice".to_string())
        );
        assert_eq!(svc.following("bob").len(), 1);
        assert_eq!(svc.leader("alice").unwrap().followers, 1);
    }

    #[test]
    fn unfollow_decrements_the_leader_count() {
        let svc = service();
        svc.follow("bob", "alice", 100.0).unwrap();
        svc.unfollow("bob", "alice").unwrap();

        assert_eq!(svc.leader("alice").unwrap().followers, 0);
        assert!(svc.following("bob").is_empty());
        assert_eq!(
            svc.unfollow("bob", "alice").unwrap_err(),
            CopyError::NotFollowing("alice".to_string())
        );
    }

    #[test]
    fn self_follow_and_unknown_leaders_are_rejected() {
        let svc = service();
        assert_eq!(svc.follow("alice", "alice", 100.0).unwrap_err(), CopyError::SelfFollow);
        assert!(matches!(
            svc.follow("bob", "ghost", 100.0).unwrap_err(),
            CopyError::LeaderNotFound(_)
        ));
    }
}
