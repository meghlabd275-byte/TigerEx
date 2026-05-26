#!/usr/bin/env python3
"""TigerEx Risk Manager"""

from dataclasses import dataclass
from typing import Dict, List

@dataclass
class Position:
    user_id: str
    symbol: str
    side: str
    size: float
    entry: float

class RiskManager:
    def __init__(self):
        self.max_position = 1000000
        self.max_leverage = 10
        self.max_daily_loss = 50000
    
    def check_position_limit(self, user_id: str, size: float) -> bool:
        return size <= self.max_position
    
    def check_leverage(self, leverage: float) -> bool:
        return leverage <= self.max_leverage
    
    def calculate_margin(self, size: float, leverage: float) -> float:
        return size / leverage
    
    def check_daily_loss(self, pnl: float) -> bool:
        return abs(pnl) <= self.max_daily_loss

def main():
    rm = RiskManager()
    print(f"Margin: {rm.calculate_margin(10000, 5)}")

if __name__ == "__main__":
    main()