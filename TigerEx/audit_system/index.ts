/**
 * TIGEREX AUDIT SYSTEM
 * Production - Comprehensive audit logging
 */

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  ip?: string;
  userAgent?: string;
  timestamp: number;
  result: 'success' | 'failure';
}

export interface AuditFilters {
  userId?: string;
  action?: string;
  resource?: string;
  start?: number;
  end?: number;
  result?: string;
}

export class AuditSystem {
  private logs: AuditLog[] = [];
  private counter = 0;

  log(event: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const log: AuditLog = {
      ...event,
      id: `AUDIT_${++this.counter}`,
      timestamp: Date.now()
    };
    this.logs.push(log);
    if (this.logs.length > 100000) this.logs = this.logs.slice(-50000);
    return log;
  }

  async query(filters: AuditFilters): Promise<AuditLog[]> {
    return this.logs.filter(l => 
      (!filters.userId || l.userId === filters.userId) &&
      (!filters.action || l.action === filters.action) &&
      (!filters.resource || l.resource === filters.resource) &&
      (!filters.start || l.timestamp >= filters.start) &&
      (!filters.end || l.timestamp <= filters.end) &&
      (!filters.result || l.result === filters.result)
    );
  }

  async getUserActivity(userId: string, limit: number = 100): Promise<AuditLog[]> {
    return this.logs.filter(l => l.userId === userId).slice(-limit);
  }

  async getActionHistory(action: string, limit: number = 100): Promise<AuditLog[]> {
    return this.logs.filter(l => l.action === action).slice(-limit);
  }
}

export default AuditSystem;