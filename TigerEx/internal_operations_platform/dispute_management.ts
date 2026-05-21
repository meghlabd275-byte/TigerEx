/**
 * Dispute Management System
 * 
 * Structured mediation for P2P disputes with evidence tracking.
 */

export enum DisputeStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  UNDER_REVIEW = 'under_review',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  CLOSED = 'closed'
}

export enum DisputeResolution {
  RELEASE_ESCROW = 'release_escrow',
  REFUND_BUYER = 'refund_buyer',
  RELEASE_TO_SELLER = 'release_to_seller',
  PARTIAL_REFUND = 'partial_refund',
  ESCALATED_TO_ARBITRATION = 'escalated_to_arbitration'
}

export class DisputeManagement {
  private disputes: Dispute[] = [];
  private evidence: Map<string, Evidence[]> = new Map();
  private resolutionDeadline = 7 * 24 * 60 * 60 * 1000; // 7 days

  async createDispute(input: DisputeInput): Promise<Dispute> {
    const dispute: Dispute = {
      id: `DISP-${Date.now()}`,
      p2pOrderId: input.p2pOrderId,
      complainantUserId: input.complainantUserId,
      respondentUserId: input.respondentUserId,
      type: input.type,
      status: DisputeStatus.OPEN,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      createdAt: new Date(),
      deadline: new Date(Date.now() + this.resolutionDeadline),
      timeline: [{
        action: 'created',
        timestamp: new Date(),
        actor: input.complainantUserId
      }]
    };

    this.disputes.push(dispute);
    return dispute;
  }

  async addEvidence(
    disputeId: string,
    userId: string,
    evidenceType: 'screenshot' | 'receipt' | 'chat_log' | 'bank_statement' | 'other',
    description: string,
    fileUrl?: string
  ): Promise<void> {
    const dispute = this.disputes.find(d => d.id === disputeId);
    if (!dispute) throw new Error('Dispute not found');

    const evidenceEntry: Evidence = {
      id: `EV-${Date.now()}`,
      type: evidenceType,
      description,
      submittedBy: userId,
      fileUrl,
      submittedAt: new Date()
    };

    if (!this.evidence.has(disputeId)) {
      this.evidence.set(disputeId, []);
    }
    this.evidence.get(disputeId)!.push(evidenceEntry);

    dispute.timeline.push({
      action: 'evidence_added',
      timestamp: new Date(),
      actor: userId,
      details: { evidenceId: evidenceEntry.id, type: evidenceType }
    });
  }

  async resolveDispute(
    disputeId: string,
    resolution: DisputeResolution,
    resolvedBy: string,
    notes?: string
  ): Promise<void> {
    const dispute = this.disputes.find(d => d.id === disputeId);
    if (!dispute) throw new Error('Dispute not found');

    dispute.status = DisputeStatus.RESOLVED;
    dispute.resolution = resolution;
    dispute.resolvedBy = resolvedBy;
    dispute.resolvedAt = new Date();
    dispute.resolutionNotes = notes;

    dispute.timeline.push({
      action: 'resolved',
      timestamp: new Date(),
      actor: resolvedBy,
      details: { resolution, notes }
    });
  }

  async escalateToArbitration(disputeId: string, escalatedBy: string, reason: string): Promise<void> {
    const dispute = this.disputes.find(d => d.id === disputeId);
    if (!dispute) throw new Error('Dispute not found');

    dispute.status = DisputeStatus.ESCALATED;
    dispute.escalatedBy = escalatedBy;
    dispute.escalationReason = reason;

    dispute.timeline.push({
      action: 'escalated',
      timestamp: new Date(),
      actor: escalatedBy,
      details: { reason }
    });
  }

  async getPendingCount(): Promise<number> {
    return this.disputes.filter(d => 
      d.status !== DisputeStatus.RESOLVED && 
      d.status !== DisputeStatus.CLOSED
    ).length;
  }

  async getDispute(disputeId: string): Promise<Dispute | null> {
    return this.disputes.find(d => d.id === disputeId) || null;
  }

  async getDisputeEvidence(disputeId: string): Promise<Evidence[]> {
    return this.evidence.get(disputeId) || [];
  }
}

interface DisputeInput {
  p2pOrderId: string;
  complainantUserId: string;
  respondentUserId: string;
  type: 'non_payment' | 'item_not_sent' | 'item_not_as_described' | 'cancel_dispute' | 'other';
  description: string;
  amount: number;
  currency: string;
}

interface Dispute {
  id: string;
  p2pOrderId: string;
  complainantUserId: string;
  respondentUserId: string;
  type: string;
  status: DisputeStatus;
  description: string;
  amount: number;
  currency: string;
  createdAt: Date;
  deadline: Date;
  resolution?: DisputeResolution;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  escalatedBy?: string;
  escalationReason?: string;
  timeline: Array<{
    action: string;
    timestamp: Date;
    actor: string;
    details?: Record<string, unknown>;
  }>;
}

interface Evidence {
  id: string;
  type: string;
  description: string;
  submittedBy: string;
  fileUrl?: string;
  submittedAt: Date;
}

export { DisputeStatus, DisputeResolution };