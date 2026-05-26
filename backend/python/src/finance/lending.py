#!/usr/bin/env python3
"""
TigerEx Lending Module - Python
Lending, borrowing, and margin trading
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class LendingPool:
    asset: str
    total_supplied: float
    supply_rate: float
    borrow_rate: float
    utilization: float
    collateral_factor: float

class LendingService:
    def __init__(self):
        self.pools: Dict[str, LendingPool] = {}
        self.loans: Dict[str, dict] = {}
        self._init_pools()
    
    def _init_pools(self):
        for asset, supply_rate, collateral_factor in [("USDT", 0.05, 0.90), ("BTC", 0.02, 0.70), ("ETH", 0.03, 0.80)]:
            self.pools[asset] = LendingPool(asset=asset, total_supplied=1000000, supply_rate=supply_rate, borrow_rate=supply_rate*2, utilization=0.5, collateral_factor=collateral_factor)
    
    def supply(self, user_id: str, asset: str, amount: float) -> bool:
        if asset in self.pools:
            self.pools[asset].total_supplied += amount
            return True
        return False
    
    def borrow(self, user_id: str, asset: str, amount: float, collateral_asset: str, collateral_amount: float) -> Optional[str]:
        if asset not in self.pools:
            return None
        
        loan_id = f"loan_{user_id}_{asset}"
        self.loans[loan_id] = {"borrower": user_id, "asset": asset, "amount": amount, "status": "active"}
        return loan_id
    
    def get_pools(self) -> List[LendingPool]:
        return list(self.pools.values())

class MarginTrading:
    def __init__(self):
        self.positions: Dict[str, dict] = {}
    
    def open_position(self, user_id: str, symbol: str, side: str, amount: float, leverage: float) -> str:
        pos_id = f"margin_{user_id}_{symbol}"
        self.positions[pos_id] = {"user_id": user_id, "symbol": symbol, "side": side, "amount": amount, "leverage": leverage, "status": "open"}
        return pos_id
    
    def close_position(self, pos_id: str) -> bool:
        if pos_id in self.positions:
            self.positions[pos_id]["status"] = "closed"
            return True
        return False

if __name__ == "__main__":
    lending = LendingService()
    print("Lending Pools:", [p.asset for p in lending.get_pools()])
    
    margin = MarginTrading()
    pos_id = margin.open_position("user1", "BTC/USDT", "long", 1000, 5)
    print(f"Margin Position: {pos_id}")