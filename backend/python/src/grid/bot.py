#!/usr/bin/env python3
"""Grid Trading Bot"""

from dataclasses import dataclass
from typing import List
import math

@dataclass
class GridLevel:
    price: float
    buy_order: bool
    filled: bool = False

class GridBot:
    def __init__(self, symbol, lowest, highest, grid_count):
        self.symbol = symbol
        self.lowest = lowest
        self.highest = highest
        self.grid_count = grid_count
        self.levels = self._create_levels()
        self.orders = []
        self.profit = 0.0
    
    def _create_levels(self):
        step = (self.highest - self.lowest) / (self.grid_count + 1)
        levels = []
        for i in range(1, self.grid_count + 1):
            price = self.lowest + (step * i)
            levels.append(GridLevel(price=price, buy_order=(i % 2 == 0)))
        return levels
    
    def price_crossed(self, price):
        crossed = []
        for level in self.levels:
            if level.filled:
                continue
            if level.buy_order and price <= level.price:
                crossed.append(level)
            elif not level.buy_order and price >= level.price:
                crossed.append(level)
        return crossed
    
    def execute(self, price):
        crossed = self.price_crossed(price)
        for level in crossed:
            level.filled = True
            if level.buy_order:
                self.profit -= price
            else:
                self.profit += price
    
    def get_pending(self):
        return [l for l in self.levels if not l.filled]

bot = GridBot("BTC", 45000, 55000, 10)
print(f"Created {len(bot.levels)} grid levels")