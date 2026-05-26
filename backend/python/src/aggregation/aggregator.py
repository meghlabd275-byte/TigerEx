#!/usr/bin/env python3
"""Data Aggregation"""

from collections import defaultdict
from datetime import datetime

class Aggregator:
    def __init__(self):
        self.data = defaultdict(list)
    
    def add(self, metric, value, timestamp=None):
        ts = timestamp or datetime.now().timestamp()
        self.data[metric].append((ts, value))
    
    def sum(self, metric, window_seconds=None):
        vals = self.data[metric]
        if window_seconds:
            now = datetime.now().timestamp()
            vals = [(t, v) for t, v in vals if now - t <= window_seconds]
        return sum(v for _, v in vals)
    
    def avg(self, metric):
        vals = self.data[metric]
        if not vals:
            return 0
        return sum(v for _, v in vals) / len(vals)
    
    def min(self, metric):
        vals = self.data[metric]
        return min(v for _, v in vals) if vals else None
    
    def max(self, metric):
        vals = self.data[metric]
        return max(v for _, v in vals) if vals else None

agg = Aggregator()
agg.add("requests", 1)
agg.add("requests", 2)
print(agg.sum("requests"))