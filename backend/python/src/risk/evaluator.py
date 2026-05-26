#!/usr/bin/env python3
"""Risk Management"""

class RiskEvaluator:
    def __init__(self, limits):
        self.limits = limits
    
    def evaluate(self, user_id, amount):
        if user_id in self.limits:
            limit = self.limits[user_id]["daily"]
            if amount > limit:
                return {"approved": False, "reason": "Daily limit exceeded"}
        return {"approved": True}
    
    def check_position(self, user_id, positions):
        if user_id in self.limits:
            limit = self.limits[user_id]["position"]
            total = sum(p.get("value", 0) for p in positions)
            if total > limit:
                return {"approved": False, "reason": "Position limit exceeded"}
        return {"approved": True}

limits = {"user1": {"daily": 10000, "position": 50000}}
evaluator = RiskEvaluator(limits)
print(evaluator.evaluate("user1", 5000))