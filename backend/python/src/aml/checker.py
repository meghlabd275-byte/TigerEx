#!/usr/bin/env python3
"""AML Compliance Module"""

from enum import Enum

class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    BLOCKED = "blocked"

class AMLChecker:
    def __init__(self):
        self.blocklist = set()
        self.high_risk_countries = {"KP", "IR", "SY"}
    
    def add_block(self, address):
        self.blocklist.add(address)
    
    def check_transaction(self, tx):
        if tx.get("from") in self.blocklist or tx.get("to") in self.blocklist:
            return {"risk": RiskLevel.BLOCKED}
        
        if tx.get("country") in self.high_risk_countries:
            return {"risk": RiskLevel.HIGH}
        
        if tx.get("amount", 0) > 10000:
            return {"risk": RiskLevel.MEDIUM}
        
        return {"risk": RiskLevel.LOW}

checker = AMLChecker()
result = checker.check_transaction({"from": "addr1", "to": "addr2", "amount": 5000})
print(result)