/**
 * Treasury Operator Console
 * 
 * Real-time treasury operations, liquidity monitoring, and hot wallet management.
 */

export class TreasuryOperatorConsole {
  private wallets: TreasuryWallet[] = [];
  private transactions: TreasuryTransaction[] = [];
  private alerts: TreasuryAlert[] = [];

  async getWalletBalances(): Promise<WalletBalance[]> {
    return this.wallets.map(w => ({
      walletId: w.id,
      currency: w.currency,
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
      updatedAt: w.updatedAt
    }));
  }

  async getHotWalletStatus(): Promise<HotWalletStatus> {
    const hotWallets = this.wallets.filter(w => w.type === 'hot');
    const totalHot = hotWallets.reduce((sum, w) => sum + w.balance, 0);
    
    return {
      totalHotBalance: totalHot,
      walletCount: hotWallets.length,
      lastRebalanced: hotWallets[0]?.updatedAt,
      status: totalHot > this.getThreshold() ? 'healthy' : 'needs_attention'
    };
  }

  async createManualWithdrawal(
    walletId: string,
    toAddress: string,
    amount: number,
    requestedBy: string,
    authorizationCode: string
  ): Promise<ManualWithdrawalResult> {
    // Triple authorization for manual withdrawals
    const wallet = this.wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error('Wallet not found');
    
    if (wallet.balance < amount) {
      throw new Error('Insufficient balance');
    }

    const tx: TreasuryTransaction = {
      id: `TX-${Date.now()}`,
      walletId,
      type: 'manual_withdrawal',
      toAddress,
      amount,
      status: 'pending_approval',
      requestedBy,
      authorizationCode,
      createdAt: new Date()
    };

    this.transactions.push(tx);
    
    return {
      transactionId: tx.id,
      status: 'pending_approval',
      confirmationsNeeded: 2
    };
  }

  async approveWithdrawal(txId: string, approvedBy: string): Promise<ApprovalResult> {
    const tx = this.transactions.find(t => t.id === txId);
    if (!tx) throw new Error('Transaction not found');
    
    if (!tx.approvals) tx.approvals = [];
    tx.approvals.push(approvedBy);
    
    if (tx.approvals.length >= 2) {
      tx.status = 'approved';
      tx.approvedAt = new Date();
    }

    return {
      approved: tx.approvals.length >= 2,
      approvalsReceived: tx.approvals.length,
      approvalsNeeded: 2
    };
  }

  async getLiquidityAlerts(): Promise<TreasuryAlert[]> {
    return this.alerts.filter(a => a.status === 'open');
  }

  async recordRebalancing(
    fromWalletId: string,
    toWalletId: string,
    amount: number,
    initiatedBy: string
  ): Promise<void> {
    const tx: TreasuryTransaction = {
      id: `TX-${Date.now()}`,
      walletId: fromWalletId,
      type: 'rebalancing',
      toWalletId,
      amount,
      status: 'completed',
      requestedBy: initiatedBy,
      createdAt: new Date(),
      completedAt: new Date()
    };

    this.transactions.push(tx);
  }

  private getThreshold(): number {
    return 1_000_000; // $1M default threshold
  }
}

interface TreasuryWallet {
  id: string;
  type: 'hot' | 'warm' | 'cold';
  currency: string;
  balance: number;
  reserved: number;
  updatedAt: Date;
}

interface WalletBalance {
  walletId: string;
  currency: string;
  balance: number;
  reserved: number;
  available: number;
  updatedAt: Date;
}

interface HotWalletStatus {
  totalHotBalance: number;
  walletCount: number;
  lastRebalanced?: Date;
  status: 'healthy' | 'needs_attention' | 'critical';
}

interface TreasuryTransaction {
  id: string;
  walletId: string;
  type: string;
  toWalletId?: string;
  toAddress?: string;
  amount: number;
  status: string;
  requestedBy: string;
  authorizationCode?: string;
  approvals?: string[];
  createdAt: Date;
  approvedAt?: Date;
  completedAt?: Date;
}

interface ManualWithdrawalResult {
  transactionId: string;
  status: string;
  confirmationsNeeded: number;
}

interface ApprovalResult {
  approved: boolean;
  approvalsReceived: number;
  approvalsNeeded: number;
}

interface TreasuryAlert {
  id: string;
  type: string;
  severity: string;
  message: string;
  status: string;
  createdAt: Date;
}