#!/usr/bin/env python3
"""Event Handler"""

class EventHandler:
    def __init__(self):
        self.handlers = {}
    
    def on(self, event, fn):
        self.handlers[event] = fn
    
    def emit(self, event, data):
        if event in self.handlers:
            self.handlers[event](data)

eh = EventHandler()
eh.on("trade", lambda d: print(f"Trade: {d}"))
eh.emit("trade", {"symbol": "BTC", "price": 50000})