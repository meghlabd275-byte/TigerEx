/**
 * Privileged Action Recording
 * 
 * Tamper-evident audit log for all privileged operations.
 * Critical for compliance and SOC2/SCM certification.
 */

export enum PrivilegeAction {
  ACCOUNT_FREEZE = 'account_freeze',
  ACCOUNT_UNFREEZE = 'account_unfreeze',
  BALANCE_ADJUSTMENT = 'balance_adjustment',
  MANUAL_SETTLEMENT = 'manual_settlement',
  PRIVILEGE_GRANT = 'privilege_grant',
  PRIVILEGE_REVOKE = 'privilege_revoke',
  CONFIG_CHANGE = 'config_change',
  RISK_LIMIT_OVERRIDE = 'risk_limit_overide',
  FEE_OVERRIDE = 'fee_override',
  WHITELIST_MODIFY = 'whitelist_modify',
  SYSTEM_CONFIG_CHANGE = 'system_config_change'
}

export class PrivilegedActionRecording {
  private actions: PrivilegedAction[] = [];
  private readonly;

  async recordAction(input: ActionInput): Promise<string> {
    const actionId = `PRIV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const action: PrivilegedAction = {
      id: actionId,
      action: input.action,
      actor: input.actor,
      targetUserId: input.targetUserId,
      details: input.details,
      permissionLevel: input.permissionLevel,
      ip: input.ip,
      userAgent: input.userAgent,
      timestamp: new Date(),
      integrityHash: ''  // Would be calculated
    };

    // Calculate integrity hash for tamper detection
    action.integrityHash = this.calculateHash(action);
    
    this.actions.push(action);
    return actionId;
  }

  async getActions(
    filters: ActionFilters
  ): Promise<PrivilegedAction[]> {
    let results = this.actions;

    if (filters.actor) {
      results = results.filter(a => a.actor === filters.actor);
    }
    if (filters.action) {
      results = results.filter(a => a.action === filters.action);
    }
    if (filters.targetUserId) {
      results = results.filter(a => a.targetUserId === filters.targetUserId);
    }
    if (filters.startDate) {
      results = results.filter(a => a.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter(a => a.timestamp <= filters.endDate!);
    }

    return results.slice(0, filters.limit || 100);
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    let invalidCount = 0;
    const verifiedActions: VerifiedAction[] = [];

    for (const action of this.actions) {
      const expectedHash = this.calculateHash(action);
      const isValid = action.integrityHash === expectedHash;
      
      verifiedActions.push({
        id: action.id,
        valid: isValid
      });

      if (!isValid) invalidCount++;
    }

    return {
      totalActions: this.actions.length,
      validActions: this.actions.length - invalidCount,
      invalidActions: invalidCount,
      lastVerifiedAt: new Date(),
      verifiedActions
    };
  }

  async exportForAuditor(
    startDate: Date,
    endDate: Date
  ): Promise<ExportedAuditLog> {
    const actions = this.actions.filter(a => 
      a.timestamp >= startDate && a.timestamp <= endDate
    );

    // In production, this would generate signed export
    return {
      exportId: `AUDIT-${Date.now()}`,
      startDate,
      endDate,
      totalActions: actions.length,
      actions,
      generatedAt: new Date(),
      // Would include cryptographic signature
      signature: ''
    };
  }

  private calculateHash(action: PrivilegedAction): string {
    // Simplified hash - in production use proper crypto
    const data = `${action.id}|${action.action}|${action.actor}|${action.timestamp.toISOString()}`;
    // Pseudo-hash for demonstration
    return btoa(data).slice(0, 32);
  }
}

interface ActionInput {
  action: PrivilegeAction;
  actor: string;
  targetUserId?: string;
  details?: Record<string, unknown>;
  permissionLevel: string;
  ip?: string;
  userAgent?: string;
}

interface PrivilegedAction {
  id: string;
  action: PrivilegeAction;
  actor: string;
  targetUserId?: string;
  details?: Record<string, unknown>;
  permissionLevel: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
  integrityHash: string;
}

interface ActionFilters {
  actor?: string;
  action?: PrivilegeAction;
  targetUserId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

interface IntegrityReport {
  totalActions: number;
  validActions: number;
  invalidActions: number;
  lastVerifiedAt: Date;
  verifiedActions: VerifiedAction[];
}

interface VerifiedAction {
  id: string;
  valid: boolean;
}

interface ExportedAuditLog {
  exportId: string;
  startDate: Date;
  endDate: Date;
  totalActions: number;
  actions: PrivilegedAction[];
  generatedAt: Date;
  signature: string;
}

export { PrivilegeAction };