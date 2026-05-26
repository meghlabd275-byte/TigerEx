#!/usr/bin/env python3
"""
TigerEx Alert System - Python
Price alerts, system alerts
"""

from dataclasses import dataclass
from typing import List, Callable
import time

@dataclass
class Alert:
    id: str
    user_id: str
    symbol: str
    condition: str  # gt, lt, eq
    target: float
    triggered: bool

class AlertService:
    def __init__(self):
        self.alerts = {}
        self.handlers = []
    
    def create(self, user_id, symbol, condition, target) -> str:
        aid = f"alert_{len(self.alerts)}"
        self.alerts[aid] = Alert(aid, user_id, symbol, condition, target, False)
        return aid
    
    def check(self, symbol, price) -> List[Alert]:
        triggered = []
        for aid, alert in self.alerts.items():
            if alert.symbol != symbol or alert.triggered:
                continue
            
            if alert.condition == "gt" and price > alert.target:
                alert.triggered = True
                triggered.append(alert)
            elif alert.condition == "lt" and price < alert.target:
                alert.triggered = True
                triggered.append(alert)
        
        return triggered
    
    def on_trigger(self, handler):
        self.handlers.append(handler)
    
    def get_user_alerts(self, user_id) -> List[Alert]:
        return [a for a in self.alerts.values() if a.user_id == user_id]

def main():
    svc = AlertService()
    
    aid = svc.create("user1", "BTC/USDT", "gt", 60000)
    print(f"Alert: {aid}")
    
    triggered = svc.check("BTC/USDT", 61000)
    print(f"Triggered: {len(triggered)}")

if __name__ == "__main__":
    main()