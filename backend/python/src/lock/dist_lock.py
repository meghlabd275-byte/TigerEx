#!/usr/bin/env python3
"""Distributed Lock"""

import threading
import uuid

class Lock:
    def __init__(self, name):
        self.name = name
        self.held_by = None
        self.lock = threading.Lock()
    
    def acquire(self, holder, timeout=30):
        ok = self.lock.acquire(timeout=timeout)
        if ok:
            self.held_by = holder
        return ok
    
    def release(self, holder):
        if self.held_by == holder:
            self.held_by = None
            self.lock.release()

lock = Lock("resource1")
lock.acquire("client1")
lock.release("client1")