#!/usr/bin/env python3
"""Metrics Collector"""

class Metrics:
    def __init__(self):
        self.counters = {}
        self.gauges = {}
    
    def inc(self, name, val=1):
        self.counters[name] = self.counters.get(name, 0) + val
    
    def set(self, name, val):
        self.gauges[name] = val
    
    def get(self, name):
        return self.counters.get(name, 0) or self.gauges.get(name)

m = Metrics()
m.inc("requests")
m.set("cpu", 0.8)
print(m.get("requests"))