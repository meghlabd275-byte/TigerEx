#!/usr/bin/env python3
"""Object Pool"""

import queue
import threading
import time

class Pool:
    def __init__(self, factory, size=10):
        self.factory = factory
        self.pool = queue.Queue(size)
        
        for _ in range(size):
            self.pool.put(factory())
    
    def acquire(self, timeout=None):
        return self.pool.get(timeout=timeout)
    
    def release(self, obj):
        self.pool.put(obj)
    
    def with_connection(self, fn):
        conn = self.acquire()
        try:
            return fn(conn)
        finally:
            self.release(conn)

class Resource:
    def health(self):
        return True
    
    def close(self):
        pass

pool = Pool(lambda: Resource(), 5)
print(pool)