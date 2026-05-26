#!/usr/bin/env python3
"""Webhook Handler"""

from typing import Callable
import requests

class Webhook:
    def __init__(self):
        self.handlers = {}
    
    def register(self, event: str, handler: Callable):
        self.handlers[event] = handler
    
    def trigger(self, event: str, data: dict):
        if event in self.handlers:
            self.handlers[event](data)

wh = Webhook()
wh.register("order.filled", lambda d: print(d))
wh.trigger("order.filled", {"id": "123"})