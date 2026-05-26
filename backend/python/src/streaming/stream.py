#!/usr/bin/env python3
"""TigerEx Market Data Stream Handler"""

from dataclasses import dataclass
from typing import List, Callable
import json

@dataclass
class Ticker:
    symbol: str
    bid: float
    ask: float
    last: float
    volume_24h: float

@dataclass
class Trade:
    id: str
    price: float
    quantity: float
    side: str
    timestamp: int

class StreamHandler:
    def __init__(self):
        self.subs = {}
        self.cbs = []
    
    def sub(self, syms):
        for s in syms: self.subs[s] = True
    
    def on_msg(self, data):
        j = json.loads(data)
        if j.get('type') == 'ticker':
            self.cbs.append(Ticker(**j['data']))
    
    def get_cb(self):
        return self.on_msg

def main():
    sh = StreamHandler()
    sh.sub(["BTC/USDT"])
    print("Stream subscribed")

if __name__ == "__main__":
    main()