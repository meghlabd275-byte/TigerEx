#!/usr/bin/env python3
"""Trading Strategy Module"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List

@dataclass
class Signal:
    action: str
    symbol: str
    quantity: int
    price: float

class Strategy(ABC):
    @abstractmethod
    def analyze(self, data: dict) -> List[Signal]:
        pass
    
    @abstractmethod
    def name(self) -> str:
        pass

class MeanReversion(Strategy):
    def __init__(self, period=20, threshold=2.0):
        self.period = period
        self.threshold = threshold
    
    def name(self):
        return "mean_reversion"
    
    def analyze(self, data: dict) -> List[Signal]:
        signals = []
        prices = data.get("prices", [])
        if len(prices) < self.period:
            return signals
        
        recent = prices[-self.period:]
        mean = sum(recent) / len(recent)
        std = (sum((p - mean) ** 2 for p in recent) / len(recent)) ** 0.5
        
        current = prices[-1]
        if current < mean - self.threshold * std:
            signals.append(Signal("BUY", data["symbol"], 1, current))
        elif current > mean + self.threshold * std:
            signals.append(Signal("SELL", data["symbol"], 1, current))
        
        return signals

s = MeanReversion()
data = {"symbol": "BTC", "prices": [50000] * 25}
print(s.analyze(data))