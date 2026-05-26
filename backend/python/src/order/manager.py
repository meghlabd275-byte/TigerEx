#!/usr/bin/env python3
"""Order Management"""

from enum import Enum
from dataclasses import dataclass

class Side(Enum):
    BUY = "buy"
    SELL = "sell"

class Status(Enum):
    PENDING = "pending"
    FILLED = "filled"
    CANCELLED = "cancelled"

@dataclass
class Order:
    id: str
    symbol: str
    side: Side
    price: float
    quantity: int
    status: Status = Status.PENDING

class OrderManager:
    def __init__(self):
        self.orders = {}
    
    def add(self, order):
        self.orders[order.id] = order
    
    def get(self, oid):
        return self.orders.get(oid)
    
    def cancel(self, oid):
        if oid in self.orders:
            self.orders[oid].status = Status.CANCELLED
    
    def fill(self, oid):
        if oid in self.orders:
            self.orders[oid].status = Status.FILLED

om = OrderManager()
om.add(Order("1", "BTC", Side.BUY, 50000, 1))
print(om.get("1"))