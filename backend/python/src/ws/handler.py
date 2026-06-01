#!/usr/bin/env python3
"""
Production WebSocket Handler

High-performance WebSocket server for real-time trading:
- Async operations
- Connection management
- Heartbeat/ping-pong
- Channel subscriptions
- Rate limiting per connection
- Backpressure handling
"""

import asyncio
import json
import logging
import time
import uuid
import weakref
from enum import Enum
from typing import Dict, Set, Optional, Callable, Any, List
from dataclasses import dataclass, field
from collections import defaultdict
import hashlib
import struct
import zlib
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# WebSocket opcodes
class Opcode(Enum):
    CONTINUE = 0x0
    TEXT = 0x1
    BINARY = 0x2
    CLOSE = 0x8
    PING = 0x9
    PONG = 0xA


# Connection state
class ConnectionState(Enum):
    CONNECTING = "connecting"
    OPEN = "open"
    CLOSING = "closing"
    CLOSED = "closed"


@dataclass
class WebSocketConnection:
    """WebSocket connection with full state tracking"""
    id: str
    socket: Any  # asyncio.StreamWriter
    remote_addr: str
    state: ConnectionState = ConnectionState.CONNECTING
    
    # Subscription channels
    subscriptions: Set[str] = field(default_factory=set)
    
    # Message rate limiting
    messages_sent: int = 0
    bytes_sent: int = 0
    last_message_time: float = field(default_factory=time.time)
    
    # Authentication
    user_id: Optional[str] = None
    authenticated: bool = False
    api_key: Optional[str] = None
    
    # Connection metadata
    created_at: float = field(default_factory=time.time)
    last_ping_time: float = field(default_factory=time.time)
    
    # Heartbeat
    ping_interval: float = 30.0  # seconds


class Channel:
    """Pub/Sub channel for real-time data"""
    name: str
    subscribers: Set[weakref.ref] = field(default_factory=set)
    
    # Channel settings
    rate_limit_per_second: int = 1000
    last_broadcast: float = 0
    broadcast_count: int = 0
    
    def add_subscriber(self, conn: WebSocketConnection):
        """Add subscriber"""
        self.subscribers.add(weakref.ref(conn))
    
    def remove_subscriber(self, conn: WebSocketConnection):
        """Remove subscriber"""
        # Clean up dead references
        self.cleanup()
        self.subscribers = {ref for ref in self.subscribers if ref() is not None}
    
    def cleanup(self):
        """Remove dead references"""
        self.subscribers = {ref for ref in self.subscribers if ref() is not None}
    
    def broadcast(self, message: bytes):
        """Broadcast to all subscribers"""
        self.cleanup()
        
        # Rate limiting per channel
        now = time.time()
        if now - self.last_broadcast < 1.0 / self.rate_limit_per_second:
            return  # Skip to prevent flooding
        
        self.last_broadcast = now
        self.broadcast_count += 1
        
        for ref in self.subscribers:
            conn = ref()
            if conn and conn.state == ConnectionState.OPEN:
                try:
                    await self._send_to(conn, message)
                except Exception:
                    pass  # Log and continue
    
    async def _send_to(self, conn: WebSocketConnection, message: bytes):
        """Send message to specific connection"""
        # Frame and send
        frame = self.frame_message(message, Opcode.BINARY)
        if hasattr(conn, 'socket') and conn.socket:
            conn.socket.write(frame)
            await conn.socket.drain()


class WSServer:
    """
    Production WebSocket Server
    
    Features:
    - Per-message framing (RFC 6455)
    - Sub-second latencies
    - Connection pooling
    - Topic-based pub/sub
    - Binary protocol support
    - Compression
    """
    
    # Standard channels
    CHANNEL_TRADES = "trades"
    CHANNEL_TICKER = "ticker"
    CHANNEL_DEPTH = "depth"
    CHANNEL_KLINE = "kline"
    CHANNEL_USER = "user"  # Authenticated user orders
    
    # Default channel settings
    DEFAULT_PING_INTERVAL = 30  # seconds
    MAX_MESSAGE_SIZE = 10 * 1024 * 1024  # 10MB
    MAX_CONNECTIONS = 100000
    
    def __init__(self, host: str = "0.0.0.0", port: int = 8443):
        self.host = host
        self.port = port
        
        # Connections indexed by ID
        self.connections: Dict[str, WebSocketConnection] = {}
        self.connection_by_addr: Dict[str, WebSocketConnection] = {}
        
        # Channels
        self.channels: Dict[str, Channel] = {}
        self._setup_default_channels()
        
        # Handler callbacks
        self.handlers: Dict[str, Callable] = {}
        
        # Concurrency control
        self._connection_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()
        
        # Server
        self.server: Optional[asyncio.Server] = None
        self._running = False
        
        # Statistics
        self.stats = {
            "connections": 0,
            "messages_received": 0,
            "messages_sent": 0,
            "bytes_received": 0,
            "bytes_sent": 0,
            "errors": 0
        }
        
        # Configuration
        self.max_connections = self.MAX_CONNECTIONS
        self.ping_interval = self.DEFAULT_PING_INTERVAL
        self.enable_compression = True
        
        logger.info(f"Initializing WS server on {host}:{port}")
    
    def _setup_default_channels(self):
        """Setup standard trading channels"""
        self.channels[self.CHANNEL_TRADES] = Channel(self.CHANNEL_TRADES)
        self.channels[self.CHANNEL_TICKER] = Channel(self.CHANNEL_TICKER)
        self.channels[self.CHANNEL_DEPTH] = Channel(self.CHANNEL_DEPTH)
        self.channels[self.CHANNEL_KLINE] = Channel(self.CHANNEL_KLINE)
        self.channels[self.CHANNEL_USER] = Channel(self.CHANNEL_USER)
    
    async def start(self):
        """Start WebSocket server"""
        self._running = True
        
        self.server = await asyncio.start_server(
            self._handle_connection,
            self.host,
            self.port,
            limit=self.MAX_MESSAGE_SIZE
        )
        
        logger.info(f"WebSocket server started on {self.host}:{self.port}")
        
        # Start background tasks
        asyncio.create_task(self._cleanup_loop())
        asyncio.create_task(self._heartbeat_loop())
        
        return self.server
    
    async def stop(self):
        """Stop WebSocket server"""
        self._running = False
        
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        
        # Close all connections
        for conn in list(self.connections.values()):
            await self.close_connection(conn, 1001, "Server shutting down")
        
        logger.info("WebSocket server stopped")
    
    async def _handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle new WebSocket connection"""
        remote_addr = writer.get_extra_info('peername')
        conn_id = str(uuid.uuid4())
        
        # Check max connections
        if len(self.connections) >= self.max_connections:
            writer.write(b"HTTP/1.1 503 Service Unavailable\r\n\r\n")
            await writer.drain()
            writer.close()
            logger.warning(f"Rejected connection from {remote_addr}: max connections reached")
            return
        
        conn = WebSocketConnection(
            id=conn_id,
            socket=writer,
            remote_addr=str(remote_addr)
        )
        
        async with self._connection_lock:
            self.connections[conn_id] = conn
            self.connection_by_addr[str(remote_addr)] = conn
        
        self.stats["connections"] += 1
        
        logger.info(f"New connection: {conn_id} from {remote_addr}")
        
        try:
            # Wait for WebSocket handshake
            await self._perform_handshake(reader, writer)
            
            conn.state = ConnectionState.OPEN
            
            # Receive loop
            while conn.state == ConnectionState.OPEN:
                message = await self._receive_message(reader, conn)
                
                if message is None:
                    break
                
                await self._handle_message(conn, message)
                
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Connection error: {e}")
            self.stats["errors"] += 1
        finally:
            await self.remove_connection(conn_id)
    
    async def _perform_handshake(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Perform WebSocket handshake"""
        # Read HTTP request
        data = await reader.read(4096)
        request = data.decode('utf-8')
        
        lines = request.split('\r\n')
        if not lines:
            raise ValueError("Empty request")
        
        # Parse request line
        parts = lines[0].split(' ')
        if len(parts) < 2 or parts[0] != 'GET':
            raise ValueError("Invalid request")
        
        # Get WebSocket key
        key = None
        for line in lines[1:]:
            if line.lower().startswith('sec-websocket-key:'):
                key = line.split(':', 1)[1].strip()
                break
        
        if not key:
            raise ValueError("Missing WebSocket key")
        
        # Generate accept key
        magic = "258EAFA5-E914-47DA-95CA-C5ABC9DC4768"
        accept = hashlib.sha1((key + magic).encode()).digest()
        accept_b64 = __import__('base64').b64encode(accept).decode()
        
        # Send handshake response
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_b64}\r\n"
            "Sec-WebSocket-Protocol: tigerex-v1\r\n\r\n"
        )
        
        writer.write(response.encode())
        await writer.drain()
    
    def frame_message(self, payload: bytes, opcode: Opcode = Opcode.BINARY) -> bytes:
        """Frame message per RFC 6455"""
        length = len(payload)
        
        # First byte: FIN + opcode
        first_byte = 0x80 | opcode.value
        
        # Second byte: MASK (0 for server->client) + length
        if length <= 125:
            second_byte = length
        elif length <= 65535:
            second_byte = 126
            length_bytes = struct.pack("!H", length)
        else:
            second_byte = 127
            length_bytes = struct.pack("!Q", length)
        
        # Assemble frame
        if second_byte == length:
            frame = bytes([first_byte, second_byte]) + payload
        elif second_byte == 126:
            frame = bytes([first_byte, second_byte]) + length_bytes + payload
        else:
            frame = bytes([first_byte, second_byte]) + length_bytes + payload
        
        return frame
    
    async def _receive_message(self, reader: asyncio.StreamReader, conn: WebSocketConnection) -> Optional[bytes]:
        """Receive and parse WebSocket frame"""
        # Read first 2 bytes
        header = await reader.read(2)
        if len(header) < 2:
            return None
        
        # Parse header
        first_byte, second_byte = struct.unpack("!BB", header)
        
        opcode = first_byte & 0x0F
        masked = bool(second_byte & 0x80)
        
        #Payload length
        length = second_byte & 0x7F
        if length == 126:
            length_bytes = await reader.read(2)
            length = struct.unpack("!H", length_bytes)[0]
        elif length == 127:
            length_bytes = await reader.read(8)
            length = struct.unpack("!Q", length_bytes)[0]
        
        # Read mask key if present
        mask_key = b""
        if masked:
            mask_key = await reader.read(4)
        
        # Read payload
        payload = await reader.read(length)
        if masked and mask_key:
            # Unmask payload
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        
        # Handle by opcode
        if opcode == Opcode.CLOSE.value:
            conn.state = ConnectionState.CLOSING
            return None
        elif opcode == Opcode.PING.value:
            # Respond with pong
            pong = self.frame_message(b"", Opcode.PONG)
            conn.socket.write(pong)
            await conn.socket.drain()
            return None
        elif opcode == Opcode.PONG.value:
            conn.last_ping_time = time.time()
            return None
        elif opcode == Opcode.CONTINUE.value:
            # Handle continuation - simplified for this implementation
            return payload
        elif opcode in (Opcode.TEXT.value, Opcode.BINARY.value):
            return payload
        
        return None
    
    async def _handle_message(self, conn: WebSocketConnection, data: bytes):
        """Process received message"""
        self.stats["messages_received"] += 1
        self.stats["bytes_received"] += len(data)
        
        try:
            # Try to parse JSON
            message = json.loads(data.decode('utf-8'))
        except:
            message = data
        
        # Route to handler
        if isinstance(message, dict):
            method = message.get("method", "")
            params = message.get("params", {})
            
            if method == "subscribe":
                await self._handle_subscribe(conn, params)
            elif method == "unsubscribe":
                await self._handle_unsubscribe(conn, params)
            elif method == "ping":
                await self._send_pong(conn)
            else:
                await self._route_message(conn, method, params)
        else:
            logger.debug(f"Binary message: {len(data)} bytes")
    
    async def _handle_subscribe(self, conn: WebSocketConnection, params: dict):
        """Handle subscription request"""
        channels = params.get("channels", [])
        
        for ch in channels:
            if ch in self.channels:
                self.channels[ch].add_subscriber(conn)
                conn.subscriptions.add(ch)
                logger.info(f"Connection {conn.id} subscribed to {ch}")
    
    async def _handle_unsubscribe(self, conn: WebSocketConnection, params: dict):
        """Handle unsubscription"""
        channels = params.get("channels", [])
        
        for ch in channels:
            if ch in self.channels:
                self.channels[ch].remove_subscriber(conn)
                conn.subscriptions.discard(ch)
    
    async def _route_message(self, conn: WebSocketConnection, method: str, params: dict):
        """Route message to registered handler"""
        handler = self.handlers.get(method)
        if handler:
            try:
                await handler(conn, params)
            except Exception as e:
                logger.error(f"Handler error for {method}: {e}")
    
    async def send(self, conn_id: str, message: dict):
        """Send message to specific connection"""
        conn = self.connections.get(conn_id)
        if not conn or conn.state != ConnectionState.OPEN:
            return
        
        async with self._send_lock:
            data = json.dumps(message).encode('utf-8')
            frame = self.frame_message(data, Opcode.TEXT)
            conn.socket.write(frame)
            await conn.socket.drain()
            
            self.stats["messages_sent"] += 1
            self.stats["bytes_sent"] += len(frame)
    
    async def broadcast(self, channel: str, message: dict):
        """Broadcast message to channel subscribers"""
        if channel not in self.channels:
            return
        
        data = json.dumps(message).encode('utf-8')
        await self.channels[channel].broadcast(data)
    
    async def close_connection(self, conn: WebSocketConnection, code: int = 1000, reason: str = ""):
        """Close WebSocket connection"""
        if conn.state == ConnectionState.CLOSED:
            return
        
        conn.state = ConnectionState.CLOSING
        
        # Send close frame
        close_data = struct.pack("!H", code) + reason.encode()
        frame = self.frame_message(close_data, Opcode.CLOSE)
        
        try:
            conn.socket.write(frame)
            await conn.socket.drain()
        except:
            pass
        finally:
            conn.state = ConnectionState.CLOSED
    
    async def remove_connection(self, conn_id: str):
        """Remove connection"""
        conn = self.connections.pop(conn_id, None)
        
        if conn:
            if conn.remote_addr in self.connection_by_addr:
                del self.connection_by_addr[conn.remote_addr]
            
            # Remove from all channels
            for ch in conn.subscriptions:
                if ch in self.channels:
                    self.channels[ch].remove_subscriber(conn)
            
            try:
                conn.socket.close()
            except:
                pass
        
        logger.info(f"Removed connection: {conn_id}")
    
    async def _cleanup_loop(self):
        """Periodic cleanup of dead connections"""
        while self._running:
            await asyncio.sleep(60)
            
            now = time.time()
            dead = []
            
            for conn_id, conn in self.connections.items():
                # Check stale connections
                if now - conn.last_ping_time > conn.ping_interval * 3:
                    dead.append(conn_id)
                    logger.warning(f"Stale connection: {conn_id}")
            
            for conn_id in dead:
                await self.remove_connection(conn_id)
            
            # Cleanup unused channels
            for ch in self.channels.values():
                ch.cleanup()
    
    async def _heartbeat_loop(self):
        """Send periodic pings"""
        while self._running:
            await asyncio.sleep(self.ping_interval)
            
            now = time.time()
            
            for conn in list(self.connections.values()):
                if conn.state == ConnectionState.OPEN:
                    if now - conn.last_ping_time > self.ping_interval * 2:
                        # Connection is stale
                        await self.remove_connection(conn.id)
                    else:
                        # Send ping
                        await self._send_ping(conn)
    
    async def _send_ping(self, conn: WebSocketConnection):
        """Send ping to connection"""
        ping_data = struct.pack("!d", time.time())
        frame = self.frame_message(ping_data, Opcode.PING)
        
        try:
            conn.socket.write(frame)
            await conn.socket.drain()
            conn.last_ping_time = time.time()
        except Exception as e:
            logger.error(f"Ping error for {conn.id}: {e}")
            await self.remove_connection(conn.id)
    
    async def _send_pong(self, conn: WebSocketConnection):
        """Respond to ping"""
        pong = self.frame_message(b"", Opcode.PONG)
        conn.socket.write(pong)
        await conn.socket.drain()
        conn.last_ping_time = time.time()
    
    def register_handler(self, method: str, handler: Callable):
        """Register message handler"""
        self.handlers[method] = handler
    
    def get_stats(self) -> dict:
        """Get server statistics"""
        return {
            **self.stats,
            "active_connections": len(self.connections),
            "channels": {ch: len(self.channels[ch].subscribers) for ch in self.channels}
        }


# Global server instance
ws_server = WSServer(host="0.0.0.0", port=8443)


async def demo():
    """Demo WebSocket server"""
    print("=== Production WebSocket Handler Demo ===\n")
    
    server = WSServer(port=8444)
    
    # Register handler
    async def handle_order(conn, params):
        print(f"Order: {params}")
    
    server.register_handler("createOrder", handle_order)
    
    # Start server
    srv = await server.start()
    print(f"Started on port 8444")
    print(f"Stats: {server.get_stats()}")
    
    # Simulate subscription broadcast
    await server.broadcast("trades", {
        "method": "trades",
        "params": {
            "symbol": "BTCUSDT",
            "price": "50000",
            "qty": "0.1"
        }
    })
    
    print("\n=== Demo Complete ===")
    
    await server.stop()


if __name__ == "__main__":
    asyncio.run(demo())