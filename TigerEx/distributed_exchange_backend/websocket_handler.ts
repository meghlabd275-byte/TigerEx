/**
 * TigerEx WebSocket Handler
 * Real-time trading stream
 */

class WebSocketHandler {
  private connections: Map<string, any> = new Map();
  private channels: Map<string, Set<string>> = new Map();
  
  // Handle new connection
  onConnect(ws: any, query: any) {
    const clientId = this.generateId();
    this.connections.set(clientId, { ws, subscriptions: new Set() });
    return clientId;
  }
  
  // Subscribe to channels
  subscribe(clientId: string, channels: string[]) {
    const client = this.connections.get(clientId);
    if (!client) return;
    
    for (const ch of channels) {
      client.subscriptions.add(ch);
      
      if (!this.channels.has(ch)) {
        this.channels.set(ch, new Set());
      }
      this.channels.get(ch).add(clientId);
    }
  }
  
  // Unsubscribe
  unsubscribe(clientId: string, channels: string[]) {
    const client = this.connections.get(clientId);
    if (!client) return;
    
    for (const ch of channels) {
      client.subscriptions.delete(ch);
      this.channels.get(ch)?.delete(clientId);
    }
  }
  
  // Broadcast to channel
  broadcast(channel: string, message: any) {
    const clients = this.channels.get(channel) || new Set();
    const data = JSON.stringify(message);
    
    for (const clientId of clients) {
      const client = this.connections.get(clientId);
      if (client?.ws.readyState === 1) {
        client.ws.send(data);
      }
    }
  }
  
  // Handle message
  onMessage(clientId: string, data: any) {
    if (data.method === 'SUBSCRIBE') {
      this.subscribe(clientId, data.params);
    } else if (data.method === 'UNSUBSCRIBE') {
      this.unsubscribe(clientId, data.params);
    }
  }
  
  // Heartbeat
  ping() {
    for (const [id, client] of this.connections) {
      if (client.ws.readyState === 1) {
        client.ws.ping();
      }
    }
  }
  
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Stream Handlers
 */

class TickerStream {
  async subscribe(symbol: string) {
    return `${symbol}@ticker`;
  }
}

class TradeStream {
  async subscribe(symbol: string) {
    return `${symbol}@trade`;
  }
}

class DepthStream {
  async subscribe(symbol: string) {
    return `${symbol}@depth`;
  }
}

class KlineStream {
  async subscribe(symbol: string, interval: string = '1m') {
    return `${symbol}@kline_${interval}`;
  }
}


export { WebSocketHandler, TickerStream, TradeStream, DepthStream, KlineStream };