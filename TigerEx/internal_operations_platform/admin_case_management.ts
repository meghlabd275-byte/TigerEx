/**
 * Admin Case Management System
 * 
 * Handles all internal support cases with full audit trails.
 * Required for operational compliance.
 */

export class AdminCaseManager {
  private cases: Map<string, SupportCase> = new Map();
  private caseCounter = 0;

  async createCase(input: SupportCaseInput): Promise<SupportCase> {
    const caseId = `CASE-${Date.now()}-${++this.caseCounter}`;
    
    const supportCase: SupportCase = {
      caseId,
      userId: input.userId,
      type: input.type,
      severity: input.severity,
      status: 'open',
      description: input.description,
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      timeline: [{
        action: 'created',
        timestamp: new Date(),
        actor: input.createdBy || 'system'
      }]
    };

    this.cases.set(caseId, supportCase);
    return supportCase;
  }

  async assignCase(caseId: string, assignedTo: string, assignedBy: string): Promise<void> {
    const supportCase = this.cases.get(caseId);
    if (!supportCase) throw new Error('Case not found');
    
    supportCase.assignedTo = assignedTo;
    supportCase.status = 'assigned';
    supportCase.timeline.push({
      action: 'assigned',
      timestamp: new Date(),
      actor: assignedBy,
      details: { assignedTo }
    });
  }

  async resolveCase(caseId: string, resolution: string, resolvedBy: string): Promise<void> {
    const supportCase = this.cases.get(caseId);
    if (!supportCase) throw new Error('Case not found');
    
    supportCase.status = 'resolved';
    supportCase.resolution = resolution;
    supportCase.timeline.push({
      action: 'resolved',
      timestamp: new Date(),
      actor: resolvedBy,
      details: { resolution }
    });
  }

  async escalateCase(caseId: string, escalationReason: string, escalatedBy: string): Promise<void> {
    const supportCase = this.cases.get(caseId);
    if (!supportCase) throw new Error('Case not found');
    
    supportCase.status = 'escalated';
    supportCase.severity = 'high';
    supportCase.timeline.push({
      action: 'escalated',
      timestamp: new Date(),
      actor: escalatedBy,
      details: { reason: escalationReason }
    });
  }

  async getActiveCount(): Promise<number> {
    let count = 0;
    for (const c of this.cases.values()) {
      if (c.status !== 'resolved' && c.status !== 'closed') count++;
    }
    return count;
  }

  async getCasesByStatus(status: string): Promise<SupportCase[]> {
    return Array.from(this.cases.values()).filter(c => c.status === status);
  }

  async getCasesByUser(userId: string): Promise<SupportCase[]> {
    return Array.from(this.cases.values()).filter(c => c.userId === userId);
  }
}

interface SupportCaseInput {
  userId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  createdBy?: string;
}

interface SupportCase {
  caseId: string;
  userId: string;
  type: string;
  severity: string;
  status: string;
  description: string;
  assignedTo: string | null;
  resolution?: string;
  createdAt: Date;
  updatedAt: Date;
  timeline: CaseTimelineEntry[];
}

interface CaseTimelineEntry {
  action: string;
  timestamp: Date;
  actor: string;
  details?: Record<string, unknown>;
}