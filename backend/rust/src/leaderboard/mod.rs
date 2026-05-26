//! Leaderboard Service - Rust Implementation
//! 
//! Trading leaderboards and rankings

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Leaderboard entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub rank: u32,
    pub user_id: String,
    pub pnl: f64,
    pub win_rate: f64,
    pub trades: u32,
    pub volume: f64,
    pub tier: String,
}

/// Leaderboard type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaderboardType {
    DailyPnL,
    MonthlyPnL,
    Volume,
    WinRate,
}

pub struct LeaderboardService {
    leaderboards: HashMap<LeaderboardType, Vec<LeaderboardEntry>>,
}

impl LeaderboardService {
    pub fn new() -> Self {
        Self {
            leaderboards: HashMap::new(),
        }
    }

    /// Update rankings
    pub fn update(&mut self, ltype: LeaderboardType, entries: Vec<(String, f64, f64, u32, f64)>) {
        let mut ranked: Vec<LeaderboardEntry> = entries.into_iter()
            .enumerate()
            .map(|(i, (user_id, pnl, wr, trades, vol))| LeaderboardEntry {
                rank: (i + 1) as u32,
                user_id,
                pnl,
                win_rate: wr,
                trades,
                volume: vol,
                tier: Self::calculate_tier(pnl),
            })
            .collect();

        ranked.sort_by(|a, b| b.pnl.partial_cmp(&a.pnl).unwrap());
        
        self.leaderboards.insert(ltype, ranked);
    }

    /// Get rankings
    pub fn get_rankings(&self, ltype: LeaderboardType, limit: usize) -> Vec<&LeaderboardEntry> {
        match self.leaderboards.get(&ltype) {
            Some(entries) => entries.iter().take(limit).collect(),
            None => Vec::new(),
        }
    }

    /// Get user rank
    pub fn get_user_rank(&self, ltype: LeaderboardType, user_id: &str) -> Option<u32> {
        self.leaderboards.get(&ltype).and_then(|entries| {
            entries.iter().find(|e| e.user_id == user_id).map(|e| e.rank)
        })
    }

    fn calculate_tier(pnl: f64) -> String {
        if pnl >= 10000.0 { "Diamond".to_string() }
        else if pnl >= 1000.0 { "Gold".to_string() }
        else if pnl >= 100.0 { "Silver".to_string() }
        else { "Bronze".to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leaderboard() {
        let mut service = LeaderboardService::new();
        let entries = vec![
            ("user1".to_string(), 1000.0, 0.8, 50, 50000.0),
            ("user2".to_string(), 500.0, 0.7, 30, 30000.0),
        ];
        service.update(LeaderboardType::MonthlyPnL, entries);
        let rankings = service.get_rankings(LeaderboardType::MonthlyPnL, 10);
        assert!(!rankings.is_empty());
    }
}