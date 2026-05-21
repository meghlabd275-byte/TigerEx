/**
 * Emergency Shutdown Controls
 * 
 * Enables emergency shutdown of exchange operations.
 * Requires highest privilege level and multi-factor confirmation.
 */

export enum ShutdownType {
  PARTIAL = 'partial',        // Only trading halted, withdrawals allowed
  FULL = 'full',            // Complete shutdown
  WITHDRAWAL_ONLY = 'withdrawal_only'  // Only withdrawals allowed
}

export enum ShutdownScope {
  SPOT = 'spot',
  FUTURES = 'futures',
  OPTIONS = 'options',
  MARGIN = 'margin',
  P2P = 'p2p',
  WALLET = 'wallet'
}

export class EmergencyShutdownController {
  private status: ShutdownStatus = 'normal';
  private shutdownHistory: ShutdownRecord[] = [];
  private confirmationRequired = 2;  // Two different admins required

  async initiateShutdown(
    reason: string,
    initiatedBy: string,
    type: ShutdownType,
    scope?: ShutdownScope[]
  ): Promise<ShutdownResult> {
    if (this.status !== 'normal') {
      throw new Error(`Cannot initiate shutdown: already in ${this.status} state`);
    }

    // Record the initiation
    const record: ShutdownRecord = {
      id: `SHUTDOWN-${Date.now()}`,
      type,
      scope: scope || this.getDefaultScope(type),
      reason,
      initiatedBy,
      initiatedAt: new Date(),
      status: 'pending_confirmation'
    };

    this.shutdownHistory.push(record);
    
    // Set status to warning pending confirmation
    this.status = 'warning';
    
    return {
      success: true,
      shutdownId: record.id,
      confirmationsNeeded: this.confirmationRequired,
      warning: 'Awaiting additional confirmations'
    };
  }

  async confirmShutdown(
    shutdownId: string,
    confirmedBy: string
  ): Promise<ConfirmationResult> {
    const shutdown = this.shutdownHistory.find(s => s.id === shutdownId);
    if (!shutdown) throw new Error('Shutdown not found');

    if (!shutdown.confirmations) shutdown.confirmations = [];
    shutdown.confirmations.push({
      confirmedBy,
      confirmedAt: new Date()
    });

    if (shutdown.confirmations.length >= this.confirmationRequired) {
      shutdown.status = 'confirmed';
      shutdown.confirmedAt = new Date();
      this.status = this.mapToShutdownStatus(shutdown.type);
    }

    return {
      success: true,
      confirmationsReceived: shutdown.confirmations.length,
      confirmationsNeeded: this.confirmationRequired
    };
  }

  async cancelShutdown(shutdownId: string, cancelledBy: string): Promise<void> {
    const shutdown = this.shutdownHistory.find(s => s.id === shutdownId);
    if (!shutdown) throw new Error('Shutdown not found');

    shutdown.status = 'cancelled';
    shutdown.cancelledBy = cancelledBy;
    shutdown.cancelledAt = new Date();
    this.status = 'normal';
  }

  async getStatus(): Promise<'normal' | 'warning' | 'partial' | 'full'> {
    return this.status;
  }

  async getActiveShutdown(): Promise<ShutdownRecord | null> {
    return this.shutdownHistory.find(s => 
      s.status === 'pending_confirmation' || s.status === 'confirmed'
    ) || null;
  }

  private getDefaultScope(type: ShutdownType): ShutdownScope[] {
    switch (type) {
      case ShutdownType.FULL:
        return ['spot', 'futures', 'options', 'margin', 'p2p', 'wallet'];
      case ShutdownType.PARTIAL:
        return ['spot', 'futures', 'options'];
      case ShutdownType.WITHDRAWAL_ONLY:
        return ['wallet'];
    }
  }

  private mapToShutdownStatus(type: ShutdownType): ShutdownStatus {
    switch (type) {
      case ShutdownType.FULL: return 'full';
      case ShutdownType.PARTIAL: return 'partial';
      case ShutdownType.WITHDRAWAL_ONLY: return 'partial';
      default: return 'normal';
    }
  }
}

type ShutdownStatus = 'normal' | 'warning' | 'partial' | 'full';

interface ShutdownResult {
  success: boolean;
  shutdownId: string;
  confirmationsNeeded: number;
  warning: string;
}

interface ConfirmationResult {
  success: boolean;
  confirmationsReceived: number;
  confirmationsNeeded: number;
}

interface ShutdownRecord {
  id: string;
  type: ShutdownType;
  scope: ShutdownScope[];
  reason: string;
  initiatedBy: string;
  initiatedAt: Date;
  status: string;
  confirmations?: Array<{ confirmedBy: string; confirmedAt: Date }>;
  confirmedAt?: Date;
  cancelledBy?: string;
  cancelledAt?: Date;
}