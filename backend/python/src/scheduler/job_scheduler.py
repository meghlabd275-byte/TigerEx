#!/usr/bin/env python3
"""Scheduler - Job Scheduling"""

import sched
import time
import threading

class Scheduler:
    def __init__(self):
        self.s = sched.scheduler(time.time, time.sleep)
        self.running = False
        self.thread = None
    
    def schedule(self, interval, func, args=()):
        self.s.enter(interval, 1, func, args)
    
    def run(self):
        self.running = True
        self.s.run()
    
    def start_background(self):
        self.thread = threading.Thread(target=self.run)
        self.thread.start()
    
    def cancel(self):
        for event in self.s.queue:
            self.s.cancel(event)

sch = Scheduler()
sch.schedule(60, lambda: print("Running job"))
print("Scheduled")