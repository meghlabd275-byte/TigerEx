#!/usr/bin/env python3
"""TigerEx Task Scheduler"""

from dataclasses import dataclass
from typing import Callable
import time
import threading

@dataclass
class Task:
    id: str
    name: str
    interval: int  # seconds
    handler: Callable
    last_run: float
    enabled: bool

class Scheduler:
    def __init__(self):
        self.tasks = {}
        self.running = True
    
    def schedule(self, name: str, interval: int, handler: Callable) -> str:
        tid = f"task_{len(self.tasks)}"
        self.tasks[tid] = Task(tid, name, interval, handler, 0, True)
        return tid
    
    def run(self):
        while self.running:
            now = time.time()
            for tid, task in self.tasks.items():
                if not task.enabled:
                    continue
                if now - task.last_run >= task.interval:
                    try:
                        task.handler()
                    except Exception as e:
                        print(f"Error: {e}")
                    task.last_run = now
            time.sleep(1)
    
    def stop(self):
        self.running = False

def job():
    print(f"Task ran at {time.time()}")

def main():
    sched = Scheduler()
    sched.schedule("cleanup", 60, job)
    print("Scheduler started")

if __name__ == "__main__":
    main()