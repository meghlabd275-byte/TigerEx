#!/usr/bin/env python3
"""TigerEx Cache System"""

from typing import Any, Optional
import time
import hashlib

class Cache:
    def __init__(self, ttl: int = 300):
        self.ttl = ttl
        self.store = {}
    
    def get(self, key: str) -> Optional[Any]:
        item = self.store.get(key)
        if not item:
            return None
        if time.time() > item['expires']:
            del self.store[key]
            return None
        return item['value']
    
    def set(self, key: str, value: Any, ttl: int = None):
        self.store[key] = {
            'value': value,
            'expires': time.time() + (ttl or self.ttl)
        }
    
    def delete(self, key: str):
        if key in self.store:
            del self.store[key]
    
    def clear(self):
        self.store.clear()

cache = Cache()

def main():
    cache.set("user:1", {"name": "John"})
    print(cache.get("user:1"))

if __name__ == "__main__":
    main()