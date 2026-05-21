/**
 * Audit System
 * 
 * Comprehensive audit logging for compliance
 */

export class AuditSystem {
  private logs: AuditLog[] = [];

  log(event: AuditEvent): void {
    this.logs.push({
      ...event,
      id: `AUDIT-${Date.now()}`,
      timestamp: new Date()
    });
  }

  async query(filters: AuditFilters): Promise<AuditLog[]> {
    return this.logs.filter(l => 
      (!filters.userId || l.userId === filters.userId) &&
      (!filters.action || l.action === filters.action) &&
      (!filters.start || l.timestamp! > filters.start) &&
      (!filters.end || l.timestamp! < filters.end)
    );
  }
}

interface AuditEvent { userId: string; action: string; details: Record<string, unknown>; ip?: string; }
interface AuditLog extends AuditEvent { id: string; timestamp: Date; }
interface AuditFilters { userId?: string; action?: string; start?: Date; end?: Date; }