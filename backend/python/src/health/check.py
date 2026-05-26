#!/usr/bin/env python3
"""Health Checker"""

class HealthCheck:
    def __init__(self):
        self.services = {}
    
    def register(self, name, check_fn):
        self.services[name] = check_fn
    
    def check(self):
        results = {}
        for name, fn in self.services.items():
            try:
                results[name] = fn()
            except:
                results[name] = False
        return results

def db_check():
    return True

hc = HealthCheck()
hc.register("db", db_check)
print(hc.check())