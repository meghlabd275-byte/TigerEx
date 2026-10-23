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

if __name__ == "__main__":
    checker = AMLChecker()
    assert checker.check_transaction({"from": "addr1", "to": "addr2", "amount": 5000})["risk"] is RiskLevel.LOW
    checker.add_block("addr1")
    assert checker.check_transaction({"from": "addr1", "to": "addr2"})["risk"] is RiskLevel.BLOCKED
    assert checker.check_transaction({"from": "a", "to": "b", "country": "KP"})["risk"] is RiskLevel.HIGH
    assert checker.check_transaction({"from": "a", "to": "b", "amount": 20000})["risk"] is RiskLevel.MEDIUM
    print("aml checker self-test passed")