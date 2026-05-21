/**
 * Internal Operations Platform - Main Entry Point
 * 
 * This is the command center for all exchange backoffice operations.
 * Provides unified access to admin tools, support systems, and emergency controls.
 * 
 * @domain internal_operations
 * @criticality TIER_1_CRITICAL
 */

import { AdminCaseManager } from './admin_case_management';
import { DisputeManagement } from './dispute_management';
import { EmergencyShutdownController } from './emergency_shutdown_controls';
import { TreasuryOperatorConsole } from './treasury_operator_console';
import { MarketSurveillanceConsole } from './market_surveillance_console';
import { IncidentManager } from './incident_management';
import { AccountFreezeTools } from './account_freeze_tools';
import { ManualReconciliationTools } from './manual_reconciliation_tools';
import { PrivilegedActionRecording } from './privileged_action_recording';

/**
 * Permission levels for internal operations
 */
export enum OperationPermission {
  VIEW_ONLY = 'view_only',
  OPERATOR = 'operator',
  SENIOR_OPERATOR = 'senior_operator',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
  EMERGENCY = 'emergency'
}

/**
 * Audit event types
 */
export enum AuditEventType {
  ACCOUNT_FREEZE = 'account_freeze',
  ACCOUNT_UNFREEZE = 'account_unfreeze',
  BALANCE_ADJUSTMENT = 'balance_adjustment',
  MANUAL_SETTLEMENT = 'manual_settlement',
  EMERGENCY_SHUTDOWN = 'emergency_shutdown',
  PRIVILEGED_ACTION = 'privileged_action',
  DISPUTE_RESOLUTION = 'dispute_resolution',
  CASE_ESCALATION = 'case_escalation'
}

/**
 * Main Internal Operations Platform
 */
export class InternalOperationsPlatform {
  private caseManager: AdminCaseManager;
  private disputeManager: DisputeManagement;
  private emergencyController: EmergencyShutdownController;
  private treasuryConsole: TreasuryOperatorConsole;
  private surveillanceConsole: MarketSurveillanceConsole;
  private incidentManager: IncidentManager;
  private accountTools: AccountFreezeTools;
  private reconciliation: ManualReconciliationTools;
  private privilegedRecorder: PrivilegedActionRecording;

  constructor() {
    this.caseManager = new AdminCaseManager();
    this.disputeManager = new DisputeManagement();
    this.emergencyController = new EmergencyShutdownController();
    this.treasuryConsole = new TreasuryOperatorConsole();
    this.surveillanceConsole = new MarketSurveillanceConsole();
    this.incidentManager = new IncidentManager();
    this.accountTools = new AccountFreezeTools();
    this.reconciliation = new ManualReconciliationTools();
    this.privilegedRecorder = new PrivilegedActionRecording();
  }

  /**
   * Process account freeze request with full audit trail
   */
  async freezeAccount(
    userId: string,
    reason: string,
    requestedBy: string,
    permissionLevel: OperationPermission
  ): Promise<OperationResult> {
    await this.privilegedRecorder.recordAction({
      actor: requestedBy,
      action: AuditEventType.ACCOUNT_FREEZE,
      targetUserId: userId,
      details: { reason },
      permissionLevel
    });

    return this.accountTools.freezeAccount(userId, reason, requestedBy);
  }

  /**
   * Process account unfreeze request
   */
  async unfreezeAccount(
    userId: string,
    reason: string,
    requestedBy: string,
    permissionLevel: OperationPermission
  ): Promise<OperationResult> {
    if (!this.hasPermission(permissionLevel, OperationPermission.OPERATOR)) {
      throw new InsufficientPermissionError('Cannot unfreeze account');
    }

    await this.privilegedRecorder.recordAction({
      actor: requestedBy,
      action: AuditEventType.ACCOUNT_UNFREEZE,
      targetUserId: userId,
      details: { reason },
      permissionLevel
    });

    return this.accountTools.unfreezeAccount(userId, reason, requestedBy);
  }

  /**
   * Create new support case
   */
  async createCase(caseData: SupportCaseInput): Promise<SupportCase> {
    return this.caseManager.createCase(caseData);
  }

  /**
   * Escalate case to senior support
   */
  async escalateCase(caseId: string, escalationReason: string, escalatedBy: string): Promise<void> {
    await this.caseManager.escalateCase(caseId, escalationReason, escalatedBy);
  }

  /**
   * Get dashboard summary for operations staff
   */
  async getOperationsDashboard(): Promise<OperationsDashboard> {
    return {
      activeCases: await this.caseManager.getActiveCount(),
      pendingDisputes: await this.disputeManager.getPendingCount(),
      openIncidents: await this.incidentManager.getOpenCount(),
      frozenAccounts: await this.accountTools.getFrozenCount(),
      emergencyStatus: await this.emergencyController.getStatus()
    };
  }

  /**
   * Trigger emergency shutdown (highest privilege required)
   */
  async triggerEmergencyShutdown(
    reason: string,
    initiatedBy: string,
    shutdownType: ShutdownType
  ): Promise<void> {
    if (!this.hasPermission(OperationPermission.EMERGENCY)) {
      throw new InsufficientPermissionError('Emergency shutdown requires EMERGENCY permission');
    }

    await this.emergencyController.initiateShutdown(reason, initiatedBy, shutdownType);
  }

  private hasPermission(has: OperationPermission, required: OperationPermission): boolean {
    const levels = [
      OperationPermission.VIEW_ONLY,
      OperationPermission.OPERATOR,
      OperationPermission.SENIOR_OPERATOR,
      OperationPermission.ADMIN,
      OperationPermission.SUPER_ADMIN,
      OperationPermission.EMERGENCY
    ];
    return levels.indexOf(has) >= levels.indexOf(required);
  }
}

interface OperationResult {
  success: boolean;
  transactionId?: string;
  timestamp: Date;
}

interface SupportCaseInput {
  userId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

interface SupportCase {
  caseId: string;
  userId: string;
  status: string;
  createdAt: Date;
}

interface OperationsDashboard {
  activeCases: number;
  pendingDisputes: number;
  openIncidents: number;
  frozenAccounts: number;
  emergencyStatus: EmergencyStatus;
}

class InsufficientPermissionError extends Error {}

type ShutdownType = 'partial' | 'full' | 'withdrawal_only';

type EmergencyStatus = 'normal' | 'warning' | 'partial' | 'full';

export {
  AdminCaseManager,
  DisputeManagement,
  EmergencyShutdownController,
  TreasuryOperatorConsole,
  MarketSurveillanceConsole,
  IncidentManager,
  AccountFreezeTools,
  ManualReconciliationTools,
  PrivilegedActionRecording,
  OperationPermission,
  AuditEventType
};