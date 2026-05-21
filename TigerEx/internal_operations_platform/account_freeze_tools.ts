/**
 * Account Freeze Tools
 * 
 * Operations for freezing/unfreezing user accounts with full audit trail.
 */

export enum FreezeReason {
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  KYC_REJECTED = 'kyc_rejected',
  COMPLIANCE_REQUEST = 'compliance_request',
  COURT_ORDER = 'court_order',
  FRAUD = 'fraud',
  ABUSE = 'abuse',
  SELF_EXCLUSION = 'self_exclusion',
  DEBT = 'debt'
}

export class AccountFreezeTools {
  private frozenAccounts: FrozenAccount[] = [];
  private pendingFreezeRequests: FreezeRequest[] = [];

  async freezeAccount(
    userId: string,
    reason: FreezeReason,
    requestedBy: string,
    additionalInfo?: string
  ): Promise<FreezeResult> {
    // Check if already frozen
    const existing = this.frozenAccounts.find(f => f.userId === userId && f.status === 'frozen');
    if (existing) {
      throw new Error('Account already frozen');
    }

    const freeze: FrozenAccount = {
      userId,
      reason,
      requestedBy,
      additionalInfo,
      frozenAt: new Date(),
      status: 'frozen',
      restrictions: this.getRestrictionsForReason(reason)
    };

    this.frozenAccounts.push(freeze);
    
    return {
      success: true,
      userId,
      frozenAt: freeze.frozenAt,
      restrictions: freeze.restrictions
    };
  }

  async unfreezeAccount(
    userId: string,
    reason: string,
    requestedBy: string
  ): Promise<FreezeResult> {
    const freeze = this.frozenAccounts.find(f => f.userId === userId && f.status === 'frozen');
    if (!freeze) {
      throw new Error('Account not frozen');
    }

    freeze.status = 'unfrozen';
    freeze.unfrozenAt = new Date();
    freeze.unfrozenBy = requestedBy;
    freeze.unfreezeReason = reason;

    return {
      success: true,
      userId,
      unfrozenAt: freeze.unfrozenAt
    };
  }

  async getFrozenStatus(userId: string): Promise<FrozenAccountStatus> {
    const freeze = this.frozenAccounts.find(f => f.userId === userId);
    if (!freeze) return { frozen: false };
    
    return {
      frozen: freeze.status === 'frozen',
      reason: freeze.reason,
      frozenAt: freeze.frozenAt,
      restrictions: freeze.restrictions
    };
  }

  async getFrozenCount(): Promise<number> {
    return this.frozenAccounts.filter(f => f.status === 'frozen').length;
  }

  private getRestrictionsForReason(reason: FreezeReason): AccountRestriction[] {
    switch (reason) {
      case FreezeReason.FRAUD:
      case FreezeReason.COMPLIANCE_REQUEST:
        return ['withdraw', 'trade', 'transfer', 'api_access', 'deposit'];
      case FreezeReason.KYC_REJECTED:
        return ['withdraw', 'trade'];
      case FreezeReason.SUSPICIOUS_ACTIVITY:
        return ['withdraw', 'transfer', 'api_access'];
      case FreezeReason.SELF_EXCLUSION:
        return ['deposit', 'trade'];
      default:
        return ['withdraw'];
    }
  }
}

interface FrozenAccount {
  userId: string;
  reason: FreezeReason;
  requestedBy: string;
  additionalInfo?: string;
  frozenAt: Date;
  status: string;
  restrictions: AccountRestriction[];
  unfrozenAt?: Date;
  unfrozenBy?: string;
  unfreezeReason?: string;
}

interface FreezeResult {
  success: boolean;
  userId: string;
  frozenAt?: Date;
  restrictions?: AccountRestriction[];
  unfrozenAt?: Date;
}

interface FrozenAccountStatus {
  frozen: boolean;
  reason?: FreezeReason;
  frozenAt?: Date;
  restrictions?: AccountRestriction[];
}

type AccountRestriction = 
  | 'withdraw' 
  | 'deposit' 
  | 'trade' 
  | 'transfer' 
  | 'api_access' 
  | 'p2p' 
  | 'earn';