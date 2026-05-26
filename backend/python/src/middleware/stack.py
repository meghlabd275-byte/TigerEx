#!/usr/bin/env python3
"""Middleware Framework"""

from typing import Callable, List

Middleware = Callable[[dict], dict]

class MiddlewareStack:
    def __init__(self):
        self.middlewares = []
    
    def use(self, mw: Middleware):
        self.middlewares.append(mw)
    
    def handle(self, ctx: dict) -> dict:
        for mw in self.middlewares:
            ctx = mw(ctx)
        return ctx

def auth_middleware(ctx):
    if 'user' not in ctx:
        ctx['error'] = 'Unauthorized'
    return ctx

def log_middleware(ctx):
    print(f"Request: {ctx.get('path')}")
    return ctx

stack = MiddlewareStack()
stack.use(log_middleware)
stack.use(auth_middleware)
print(stack.handle({"path": "/api", "user": "admin"}))