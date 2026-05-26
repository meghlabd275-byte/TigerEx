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

alog = AuditLog()
alog.log("user1", "login", {"ip": "1.1.1.1"})
print(f"Logs: {len(alog.query())}")