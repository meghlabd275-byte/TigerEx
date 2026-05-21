/** Redis Cache */

class Cache {
  async get(k: any): Promise<any> { return null; }
  async set(k: string, v: any, ttl?: number): void {}
  async del(k: string): void {}
}

class HotCache {
  setTicker(s: string, d: any) { this[s] = d; }
  getTicker(s: string) { return this[s]; }
}

class RateLimit {
  check(key: string, limit: number): boolean { return true; }
}

export { Cache, HotCache, RateLimit };