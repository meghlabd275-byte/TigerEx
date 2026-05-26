#!/usr/bin/env python3
"""Trading Limits Module"""

from datetime import datetime, timedelta

class LimitChecker:
    def __init__(self):
        self.limits = {
            "order_rate": (100, 60),      # 100 orders per minute
            "withdraw_daily": (10000, 86400),  # $10k per day
            "position_size": 50000,         # $50k max position
        }
        self.counts = {}
        self.withdraws = {}
    
    def check_order_rate(self, user_id):
        now = datetime.now()
        key = f"order_{user_id}"
        
        if key not in self.counts:
            self.counts[key] = []
        
        self.counts[key] = [t for t in self.counts[key] if now - t < timedelta(seconds=60)]
        
        limit, _ = self.limits["order_rate"]
        if len(self.counts[key]) >= limit:
            return False, "Rate limit exceeded"
        
        self.counts[key].append(now)
        return True, "OK"
    
    def check_withdraw_limit(self, user_id, amount):
        since = datetime.now() - timedelta(days=1)
        key = f"withdraw_{user_id}"
        
        total = sum(v for t, v in self.withdraws.get(key, []) if t > since)
        
        limit, _ = self.limits["withdraw_daily"]
        if total + amount > limit:
            return False, "Daily withdraw limit exceeded"
        
        return True, "OK"

lc = LimitChecker()
print(lc.check_order_rate("user1"))