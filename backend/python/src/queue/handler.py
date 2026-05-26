#!/usr/bin/env python3
"""Queue Handler - SQS-like"""

from collections import deque
import threading
import time

class Queue:
    def __init__(self, name):
        self.name = name
        self.messages = deque()
        self.lock = threading.Lock()
    
    def enqueue(self, msg):
        with self.lock:
            self.messages.append({
                "id": str(time.time()),
                "body": msg,
                "timestamp": int(time.time())
            })
    
    def dequeue(self):
        with self.lock:
            if self.messages:
                return self.messages.popleft()
        return None
    
    def size(self):
        with self.lock:
            return len(self.messages)

q = Queue("orders")
q.enqueue({"order_id": "1"})
print(q.dequeue())