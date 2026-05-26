#!/usr/bin/env python3
"""Streaming Processor"""

from collections import deque
import threading

class StreamProcessor:
    def __init__(self, maxsize=1000):
        self.buffer = deque(maxlen=maxsize)
        self.maxsize = maxsize
        self.lock = threading.Lock()
        self.handlers = []
    
    def add_handler(self, fn):
        self.handlers.append(fn)
    
    def push(self, item):
        with self.lock:
            if len(self.buffer) >= self.maxsize:
                return False
            
            self.buffer.append(item)
            
            for handler in self.handlers:
                try:
                    handler(item)
                except:
                    pass
            
            return True
    
    def pop(self):
        while True:
            with self.lock:
                if self.buffer:
                    return self.buffer.popleft()
            threading.Event().wait(0.01)
    
    def __len__(self):
        with self.lock:
            return len(self.buffer)

sp = StreamProcessor()
sp.push({"type": "trade", "price": 50000})
print(len(sp))