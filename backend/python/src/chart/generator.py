#!/usr/bin/env python3
"""Chart Generator"""

from dataclasses import dataclass
from datetime import datetime
from typing import List

@dataclass
class Candle:
    open: float
    high: float
    low: float
    close: float
    volume: float
    time: datetime

class ChartGenerator:
    def __init__(self, interval_sec=60):
        self.interval = interval_sec
        self.candles = []
        self.current = None
    
    def add(self, price, volume):
        now = datetime.now()
        
        if self.current is None or (now - self.current.time).total_seconds() >= self.interval:
            if self.current:
                self.candles.append(self.current)
            self.current = Candle(price, price, price, price, volume, now)
        else:
            if price > self.current.high:
                self.current.high = price
            if price < self.current.low:
                self.current.low = price
            self.current.close = price
            self.current.volume += volume
    
    def get_all(self):
        if self.current:
            return self.candles + [self.current]
        return self.candles

cg = ChartGenerator(60)
cg.add(50000, 1.0)
cg.add(50100, 0.5)
print(len(cg.get_all()))