"""
TigerEx Margin Lending Pool
Collateral, interest rates, liquidation
"""
import time
from typing import Dict

class LendingPool:
    SUPPLY_RATE = 0.05
    BORROW_RATE = 0.10
    
    def __init__(self):
        self.pools: Dict[str, Dict] = {}
        self.borrows: Dict[str, Dict] = {}
        self.supplies: Dict[str, Dict] = {}
        
    async def supply(self, user: str, token: str, amount: float) -> Dict:
        pos_id = f"supply_{user}_{token}_{int(time.time())}"
        self.supplies[pos_id] = {"user": user, "token": token, "amount": amount, "rate": self.SUPPLY_RATE}
        if token not in self.pools:
            self.pools[token] = {"total_supplied": 0}
        self.pools[token]["total_supplied"] += amount
        return {"supplied": amount, "position_id": pos_id}
        
    async def borrow(self, user: str, token: str, amount: float, collateral: float) -> Dict:
        max_borrow = collateral * 0.8
        if amount > max_borrow:
            return {"error": f"Exceeds max borrow {max_borrow}"}
        pos_id = f"borrow_{user}_{token}_{int(time.time())}"
        self.borrows[pos_id] = {"user": user, "token": token, "amount": amount, "collateral": collateral}
        return {"borrowed": amount, "position_id": pos_id}
        
    async def repay(self, user: str, position_id: str, amount: float) -> Dict:
        pos = self.borrows.get(position_id)
        if not pos:
            return {"error": "Position not found"}
        pos["amount"] = max(0, pos["amount"] - amount)
        return {"repaid": amount, "remaining": pos["amount"]}
        
    async def liquidate(self, position_id: str, liquidator: str) -> Dict:
        pos = self.borrows.get(position_id)
        if not pos:
            return {"error": "Position not found"}
        if pos["collateral"] > pos["amount"] * 1.1:
            return {"liquidated": True, "reward": (pos["collateral"] - pos["amount"]) * 0.05}
        return {"liquidated": False}

class MarginAccount:
    def __init__(self):
        self.positions: Dict[str, Dict] = {}
        
    async def open_position(self, user: str, side: str, size: float, leverage: float) -> Dict:
        pos_id = f"margin_{user}_{int(time.time())}"
        self.positions[pos_id] = {"user": user, "side": side, "size": size, "leverage": leverage}
        return {"position_id": pos_id, "margin_required": size / leverage}
        
    async def get_ratio(self, user: str) -> float:
        return 3.0
        
    async def check_liquidation(self, position_id: str, current_price: float) -> Dict:
        pos = self.positions.get(position_id)
        if not pos:
            return {"error": "Position not found"}
        return {"liquidated": False}

if __name__ == '__main__':
    print("Margin Lending Ready")