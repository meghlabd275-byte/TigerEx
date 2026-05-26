#!/usr/bin/env python3
"""Resilience - Retry & Circuit Breaker"""

import time
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, threshold=3, timeout=30):
        self.threshold = threshold
        self.timeout = timeout
        self.state = CircuitState.CLOSED
        self.failures = 0
        self.last_failure = 0
    
    def allow(self):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure > self.timeout:
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        return True
    
    def success(self):
        self.state = CircuitState.CLOSED
        self.failures = 0
    
    def failure(self):
        self.failures += 1
        if self.failures >= self.threshold:
            self.state = CircuitState.OPEN
            self.last_failure = time.time()

cb = CircuitBreaker()
for i in range(5):
    print(f"Attempt {i+1}: {cb.allow()}")