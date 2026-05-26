#!/usr/bin/env python3
"""WebSocket Handler"""

import asyncio

class WSHandler:
    def __init__(self):
        self.clients = set()
        self.channels = {}
    
    async def connect(self, ws):
        self.clients.add(ws)
    
    async def disconnect(self, ws):
        self.clients.discard(ws)
    
    async def broadcast(self, channel, msg):
        for client in self.clients:
            await client.send(msg)
    
    def subscribe(self, ws, channel):
        if channel not in self.channels:
            self.channels[channel] = set()
        self.channels[channel].add(ws)
    
    async def publish(self, channel, msg):
        if channel in self.channels:
            for client in self.channels[channel]:
                await client.send(msg)

handlers = WSHandler()