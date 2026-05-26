#!/usr/bin/env python3
"""Filter Pipeline"""

from typing import List, Callable

FilterFunc = Callable[[dict], bool]

class FilterPipeline:
    def __init__(self):
        self.filters = []
    
    def add(self, fn: FilterFunc):
        self.filters.append(fn)
    
    def process(self, data: dict) -> bool:
        for f in self.filters:
            if not f(data):
                return False
        return True

def ip_filter(data):
    return "ip" in data and data["ip"]

def rate_filter(data):
    return data.get("rate", 0) < 1000

pipeline = FilterPipeline()
pipeline.add(ip_filter)
pipeline.add(rate_filter)
print(pipeline.process({"ip": "1.2.3.4", "rate": 100}))