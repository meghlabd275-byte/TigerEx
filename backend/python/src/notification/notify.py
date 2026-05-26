#!/usr/bin/env python3
"""Notification Service"""

from enum import Enum

class Channel(Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"

class Notification:
    def __init__(self):
        self.handlers = {}
    
    def register(self, channel, handler):
        self.handlers[channel] = handler
    
    def send(self, channel, msg):
        if channel in self.handlers:
            self.handlers[channel](msg)

def email_handler(msg):
    print(f"Email: {msg}")

notif = Notification()
notif.register(Channel.EMAIL.value, email_handler)
notif.send(Channel.EMAIL.value, "Test message")