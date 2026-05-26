#!/usr/bin/env python3
"""Business Intelligence Engine"""

from collections import defaultdict
from typing import Dict, List

class BIEngine:
    def __init__(self):
        self.metrics = defaultdict(float)
        self.series = defaultdict(list)
    
    def record(self, metric: str, value: float):
        self.metrics[metric] += value
        self.series[metric].append(value)
    
    def get(self, metric: str) -> float:
        return self.metrics.get(metric, 0.0)
    
    def avg(self, metric: str) -> float:
        vals = self.series.get(metric, [])
        return sum(vals) / len(vals) if vals else 0
    
    def sum(self, metric: str) -> float:
        return sum(self.series.get(metric, []))
    
    def percentile(self, metric: str, p: float) -> float:
        vals = sorted(self.series.get(metric, []))
        if not vals:
            return 0
        idx = int((p / 100.0) * len(vals)) - 1
        return vals[min(idx, len(vals) - 1)]
    
    def generate_report(self) -> Dict[str, Dict]:
        report = {}
        for metric in self.metrics:
            report[metric] = {
                "sum": self.sum(metric),
                "avg": self.avg(metric),
                "p50": self.percentile(metric, 50),
                "p95": self.percentile(metric, 95),
                "p99": self.percentile(metric, 99)
            }
        return report

bi = BIEngine()
bi.record("volume", 1000)
bi.record("volume", 2000)
print(bi.generate_report())