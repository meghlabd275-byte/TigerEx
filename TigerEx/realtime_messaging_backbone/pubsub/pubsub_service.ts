/**
 * Realtime Messaging Pub/Sub
 */

class PubSubBroker {
  private topics = new Map();
  
  publish(topic: string, message: any): number {
    const subs = this.topics.get(topic) || [];
    let delivered = 0;
    for (const sub of subs) {
      sub(message);
      delivered++;
    }
    return delivered;
  }
  
  subscribe(topic: string, callback: (msg: any) => void): () => void {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    this.topics.get(topic).push(callback);
    return () => this.unsubscribe(topic, callback);
  }
  
  unsubscribe(topic: string, callback: Function): void {
    const subs = this.topics.get(topic) || [];
    const idx = subs.indexOf(callback);
    if (idx >= 0) subs.splice(idx, 1);
  }
}

class RedisPubSub extends PubSubBroker {
  constructor(private redis) {
    super();
  }
  
  async publish(topic: string, message: any): Promise<number> {
    await this.redis.publish(topic, JSON.stringify(message));
    return super.publish(topic, message);
  }
  
  async subscribe(topics: string[]): Promise<void> {
    const sub = this.redis.duplicate();
    await sub.connect();
    sub.on('message', (ch, msg) => {
      if (topics.includes(ch)) {
        super.publish(ch, JSON.parse(msg));
      }
    });
  }
}


export { PubSubBroker, RedisPubSub };