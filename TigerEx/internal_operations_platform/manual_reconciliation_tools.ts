/**
 * Manual Reconciliation Tools
 * 
 * Manual adjustments with dual approval and complete audit trail.
 */

export class ManualReconciliationTools {
  private adjustments: BalanceAdjustment[] = [];

  async requestAdjustment(input: AdjustmentInput): Promise<string> {
    const adjustmentId = `ADJ-${Date.now()}`;
    
    const adjustment: BalanceAdjustment = {
      id: adjustmentId,
      userId: input.userId,
      currency: input.currency,
      amount: input.amount,
      type: input.type,
      reason: input.reason,
      status: 'pending_approval',
      requestedBy: input.requestedBy,
      createdAt: new Date(),
      approvers: []
    };

    this.adjustments.push(adjustment);
    return adjustmentId;
  }

  async approveAdjustment(
    adjustmentId: string,
    approvedBy: string,
    notes?: string
  ): Promise<ApprovalResult> {
    const adjustment = this.adjustments.find(a => a.id === adjustmentId);
    if (!adjustment) throw new Error('Adjustment not found');

    const existingApproval = adjustment.approvers.find(a => a.approvedBy === approvedBy);
    if (existingApproval) throw new Error('Already approved by this user');

    adjustment.approvers.push({
      approvedBy,
      approvedAt: new Date(),
      notes
    });

    if (adjustment.approvers.length >= 2) {
      adjustment.status = 'approved';
      adjustment.approvedAt = new Date();
    }

    return {
      success: adjustment.approvers.length >= 2,
      approvals: adjustment.approvers.length,
      required: 2
    };
  }

  async rejectAdjustment(
    adjustmentId: string,
    rejectedBy: string,
    reason: string
  ): Promise<void> {
    const adjustment = this.adjustments.find(a => a.id === adjustmentId);
    if (!adjustment) throw new Error('Adjustment not found');

    adjustment.status = 'rejected';
    adjustment.rejectedBy = rejectedBy;
    adjustment.rejectionReason = reason;
    adjustment.rejectedAt = new Date();
  }

  async executeAdjustment(adjustmentId: string): Promise<AdjustmentResult> {
    const adjustment = this.adjustments.find(a => a.id === adjustmentId);
    if (!adjustment) throw new Error('Adjustment not found');
    
    if (adjustment.status !== 'approved') {
      throw new Error('Adjustment not approved');
    }

    adjustment.status = 'executed';
    adjustment.executedAt = new Date();

    // Here we'd call the ledger system
    return {
      id: adjustment.id,
      executedAt: adjustment.executedAt!
    };
  }

  async getPendingCount(): Promise<number> {
    return this.adjustments.filter(a => 
      a.status === 'pending_approval'
    ).length;
  }
}

interface AdjustmentInput {
  userId: string;
  currency: string;
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  requestedBy: string;
}

interface BalanceAdjustment {
  id: string;
  userId: string;
  currency: string;
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  status: string;
  requestedBy: string;
  createdAt: Date;
  approvers: Array<{
    approvedBy: string;
    approvedAt: Date;
    notes?: string;
  }>;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectionReason?: string;
  rejectedAt?: Date;
  executedAt?: Date;
}

interface ApprovalResult {
  success: boolean;
  approvals: number;
  required: number;
}

interface AdjustmentResult {
  id: string;
  executedAt: Date;
}