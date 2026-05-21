/**
 * Middleware
 * 
 * Auth, logging, rate limiting middleware
 */

// Auth Middleware
export interface AuthRequest {
  userId?: string;
  apiKey?: string;
  role?: string;
}

export async function authMiddleware(req: AuthRequest): Promise<boolean> {
  if (!req.userId && !req.apiKey) {
    throw new Error('Unauthorized');
  }
  return true;
}

// API Key Middleware
export async function apiKeyMiddleware(req: AuthRequest, validKeys: string[]): Promise<boolean> {
  if (!req.apiKey || !validKeys.includes(req.apiKey)) {
    throw new Error('Invalid API key');
  }
  return true;
}

// Rate Limiter
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  
  constructor(private limit: number = 100, private windowMs: number = 60000) {}
  
  check(key: string): boolean {
    const now = Date.now();
    const window = this.requests.get(key) || [];
    const valid = window.filter(t => now - t < this.windowMs);
    
    if (valid.length >= this.limit) {
      return false;
    }
    
    valid.push(now);
    this.requests.set(key, valid);
    return true;
  }
  
  reset(key: string): void {
    this.requests.delete(key);
  }
}

// Logger Middleware
export interface LogEntry {
  timestamp: Date;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  userId?: string;
  error?: string;
}

class Logger {
  private logs: LogEntry[] = [];
  
  log(entry: Omit<LogEntry, 'timestamp'>): void {
    this.logs.push({ ...entry, timestamp: new Date() });
    
    // Keep only last 10000 logs
    if (this.logs.length > 10000) {
      this.logs.shift();
    }
  }
  
  getLogs(filters?: Partial<LogEntry>): LogEntry[] {
    return this.logs.filter(l => {
      if (filters?.method && l.method !== filters.method) return false;
      if (filters?.path && !l.path.includes(filters.path)) return false;
      return true;
    });
  }
}

export const logger = new Logger();

// Request logger
export function loggingMiddleware(req: AuthRequest, res: { statusCode: number }, next: () => void): void {
  const start = Date.now();
  
  next();
  
  logger.log({
    method: req.method || 'GET',
    path: req.path || '/',
    statusCode: res.statusCode,
    duration: Date.now() - start,
    userId: req.userId
  });
}

// CORS Middleware
export function corsMiddleware(req: AuthRequest, origins: string[]): void {
  // Simplified - in production use proper CORS handling
  req; // Just acknowledging the params
}

// Compression Middleware  
export function compressionMiddleware(data: unknown): Buffer {
  // Simplified - in production use compression
  return Buffer.from(JSON.stringify(data));
}

export { RateLimiter, Logger };