#!/usr/bin/env python3
"""Cache Manager"""

import time
import threading

class Cache:
    def __init__(self, ttl=300):
        self.ttl = ttl
        self.store = {}
        self.lock = threading.Lock()
    
    def set(self, key, value, ttl=None):
        with self.lock:
            self.store[key] = {
                "value": value,
                "expires": time.time() + (ttl or self.ttl)
            }
    
    def get(self, key):
        with self.lock:
            if key not in self.store:
                return None
            
            entry = self.store[key]
            if time.time() > entry["expires"]:
                del self.store[key]
                return None
            
            return entry["value"]
    
    def delete(self, key):
        with self.lock:
            self.store.pop(key, None)
    
    def clear(self):
        with self.lock:
            self.store.clear()

c = Cache(ttl=60)
c.set("test", "value")
print(c.get("test"))