#!/usr/bin/env python3
"""Dollar Cost Averaging Bot"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List

@dataclass
class DCAPlan:
    id: str
    user_id: str
    symbol: str
    amount: float
    interval_hours: int
    last_buy: datetime
    enabled: bool = True

class DCABot:
    def __init__(self):
        self.plans = {}
    
    def add_plan(self, plan: DCAPlan):
        self.plans[plan.id] = plan
    
    def run(self) -> List[dict]:
        now = datetime.now()
        executions = []
        
        for plan_id, plan in self.plans.items():
            if not plan.enabled:
                continue
            
            interval = timedelta(hours=plan.interval_hours)
            if now - plan.last_buy >= interval:
                executions.append({
                    "plan_id": plan_id,
                    "symbol": plan.symbol,
                    "amount": plan.amount,
                    "time": now.isoformat()
                })
                plan.last_buy = now
        
        return executions
    
    def get_plan(self, plan_id):
        return self.plans.get(plan_id)
    
    def disable(self, plan_id):
        if plan_id in self.plans:
            self.plans[plan_id].enabled = False

bot = DCABot()
bot.add_plan(DCAPlan("dca-btc", "user1", "BTC", 100, 24, datetime.now()))
print(bot.run())