#!/usr/bin/env python3
"""Audit logger"""

from datetime import datetime
import json
import time

class AuditLog:
    def __init__(self):
        self.logs = []
    
    def log(self, user_id, action, details):
        self.logs.append({
            'timestamp': int(time.time()),
            'user_id': user_id,
            'action': action,
            'details': details
        })
    
    def query(self, user_id=None, action=None):
        res = self.logs
        if user_id:
            res = [l for l in res if l['user_id'] == user_id]
        if action:
            res = [l for l in res if l['action'] == action]
        return res

def _self_test() -> None:
    log = AuditLog()
    log.log("user1", "login", {"ip": "1.1.1.1"})
    assert len(log.query()) == 1
    assert len(log.query(user_id="user1")) == 1
    assert len(log.query(action="login")) == 1
    assert len(log.query(action="logout")) == 0
    print("audit logger self-test passed")


if __name__ == "__main__":
    _self_test()