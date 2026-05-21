"""
TigerEx Trading Contests & Leaderboards
"""

from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta


# ============================================================================
# Competition Types
# ============================================================================

@dataclass
class TradingContest:
    contest_id: str
    name: str
    start_time: datetime
    end_time: datetime
    prizes: List[Prize]
    rules: ContestRules
    status: str  # upcoming, active, completed


@dataclass
class Prize:
    rank_from: int
    rank_to: int
    reward_amount: float
    reward_type: str  # USDT, NFT, badge


@dataclass
class ContestRules:
    min_trades: int = 100
    min_volume: float = 10000
    allowed_markets: List[str] = None
    score_metric: str = 'pnl_percentage'


@dataclass
class Participant:
    user_id: str
    rank: int
    pnl: float
    pnl_pct: float
    volume: float
    trades: int
    win_rate: float


# ============================================================================
# Contest Manager
# ============================================================================

class CompetitionManager:
    ACTIVE_CONTESTS = [
        {
            'id': 'weekly-1',
            'name': 'Weekly Trading Championship',
            'prizes': [
                {'rank': 1, 'reward': 1000, 'type': 'USDT'},
                {'rank': 2, 'reward': 500, 'type': 'USDT'},
                {'rank': 3, 'reward': 250, 'type': 'USDT'},
                {'rank': '4-10', 'reward': 100, 'type': 'USDT'},
            ]
        }
    ]
    
    def __init__(self, db):
        self.db = db
    
    async def get_active_contests(self) -> List[TradingContest]:
        return []  # Query from DB
    
    async def join_contest(self, user_id: str, contest_id: str) -> Dict:
        # Check eligibility
        # Join request
        return {'status': 'joined'}
    
    async def calculate_rankings(self, contest_id: str) -> List[Participant]:
        # Query all participants
        # Sort by PnL %
        # Assign ranks
        return []


# ============================================================================
# Leaderboard Service
# ============================================================================

class LeaderboardService:
    PERIODS = ['daily', 'weekly', 'monthly', 'all_time']
    
    async def get_leaderboard(
        self,
        leaderboard_type: str = 'traders',
        period: str = 'daily',
        limit: int = 100
    ) -> List[Dict]:
        """Get top traders"""
        leaders = []
        
        for i in range(min(limit, 10)):
            leaders.append({
                'rank': i + 1,
                'user_id': f't{i+1}',
                'pnl': (100 - i) * 1000,
                'volume': (100 - i) * 100000,
                'win_rate': 0.5 + (i * 0.02),
                'trades': 1000 + i * 100,
            })
        
        return leaders
    
    async def get_user_rank(
        self,
        user_id: str,
        leaderboard_type: str = 'traders'
    ) -> Optional[Dict]:
        """Get user's position"""
        return {
            'rank': 150,
            'user_id': user_id,
            'pnl': 50000,
            'total_users': 10000,
        }


# ============================================================================
# Achievements System
# ============================================================================

class AchievementService:
    ACHIEVEMENTS = [
        {'id': 'first_deposit', 'name': 'First Deposit', 'desc': 'Make your first deposit'},
        {'id': 'first_trade', 'name': 'First Trade', 'desc': 'Place your first order'},
        {'id': 'profit_100', 'name': 'Profit Maker', 'desc': 'Earn 100 USDT profit'},
        {'id': 'profit_1000', 'name': 'Profit Master', 'desc': 'Earn 1000 USDT profit'},
        {'id': 'trader_100', 'name': 'Active Trader', 'desc': 'Complete 100 trades'},
        {'id': 'trader_1000', 'name': 'Pro Trader', 'desc': 'Complete 1000 trades'},
        {'id': 'winning_streak_10', 'name': 'Hot Streak', 'desc': 'Win 10 trades in a row'},
        {'id': 'vip_1', 'name': 'VIP', 'desc': 'Reach VIP level'},
        {'id': 'referrer', 'name': 'Referrer', 'desc': 'Invite 10 friends'},
    ]
    
    async def get_user_achievements(self, user_id: str) -> List[Dict]:
        """Get earned achievements"""
        return []
    
    async def check_achievements(self, user_id: str):
        """Check and award new achievements"""
        awarded = []
        # Check each achievement criteria
        return awarded


# ============================================================================
# Badge System
# ============================================================================

class BadgeService:
    BADGES = [
        {'id': 'diamond', 'name': 'Diamond', 'color': '#B9F2FF'},
        {'id': 'gold', 'name': 'Gold', 'color': '#FFD700'},
        {'id': 'silver', 'name': 'Silver', 'color': '#C0C0C0'},
        {'id': 'bronze', 'name': 'Bronze', 'color': '#CD7F32'},
        {'id': 'legendary', 'name': 'Legendary', 'color': '#9B111E'},
        {'id': 'early_adopter', 'name': 'Early Adopter', 'color': '#4169E1'},
    ]
    
    async def assign_badge(self, user_id: str, badge_id: str):
        """Assign badge to user"""
        pass
    
    async def get_user_badges(self, user_id: str) -> List[Dict]:
        return [{'id': 'gold', 'name': 'Gold'}]


if __name__ == '__main__':
    print("TigerEx Competitions & Achievements")
    
    for ach in AchievementService.ACHIEVEMENTS[:5]:
        print(f"- {ach['name']}: {ach['desc']}")