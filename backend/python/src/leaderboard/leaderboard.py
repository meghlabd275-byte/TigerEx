#!/usr/bin/env python3
"""TigerEx Leaderboard"""

from dataclasses import dataclass
from typing import List
import time

@dataclass
class Trader:
    rank: int
    user_id: str
    pnl: float
    win_rate: float

class Leaderboard:
    def __init__(self, period: str = "monthly"):
        self.period = period
        self.traders = []
    
    def update(self, user_id: str, pnl: float, wins: int, total: int):
        win_rate = wins / total if total > 0 else 0
        self.traders.append(Trader(0, user_id, pnl, win_rate))
        self.traders.sort(key=lambda t: t.pnl, reverse=True)
        for i, t in enumerate(self.traders):
            t.rank = i + 1
    
    def get_top(self, n: int) -> List[Trader]:
        return self.traders[:n]

def main():
    lb = Leaderboard()
    lb.update("user1", 10000, 80, 100)
    lb.update("user2", 8000, 70, 90)
    top = lb.get_top(10)
    print(f"Top: {len(top)}")

if __name__ == "__main__":
    main()