/**
 * Post-Trade Clearing & Settlement System
 * 
 * Separates execution from clearing and settlement.
 * Critical for institutional expansion and regulatory compliance.
 */

export enum SettlementStatus {
  PENDING = 'pending',
  NOVATED = 'novated',
  IN_PROGRESS = 'in_progress',
  SETTLED = 'settled',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum SettlementType {
  REGULAR = 'regular',           // T+1 standard
  INSTANT = 'instant',         // Immediate settlement
  DELAYED = 'delayed',         // Delayed settlement  
  OTC = 'otc',               // Over-the-counter
  INSTITUTIONAL = 'institutional'  // Institutional-sized
}

export class ClearingHouseEngine {
  private trades: Map<string, SettlementTrade> = new Map();
  private novationQueue: Map<string, string[]> = new Map();  // symbol -> trade IDs

  /**
   * Novate a trade from execution to clearing
   */
  async novateTrade(execution: ExecutionData): Promise<NovationResult> {
    const tradeId = `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const settlementTrade: SettlementTrade = {
      tradeId,
      symbol: execution.symbol,
      buyerId: execution.buyerId,
      sellerId: execution.sellerId,
      quantity: execution.quantity,
      price: execution.price,
      settlementAmount: execution.quantity * execution.price,
      commission: execution.commission || 0,
      status: SettlementStatus.NOVATED,
      settlementType: execution.settlementType || SettlementType.REGULAR,
      executedAt: execution.executedAt,
      novatedAt: new Date(),
      settlementDeadline: this.calculateSettlementDeadline(execution.settlementType),
      buyerSettlementAccount: execution.buyerAccount,
      sellerSettlementAccount: execution.sellerAccount
    };

    this.trades.set(tradeId, settlementTrade);
    
    // Add to symbol-specific processing queue
    if (!this.novationQueue.has(execution.symbol)) {
      this.novationQueue.set(execution.symbol, []);
    }
    this.novationQueue.get(execution.symbol)!.push(tradeId);

    return {
      tradeId,
      status: SettlementStatus.NOVATED,
      settlementDue: settlementTrade.settlementDeadline
    };
  }

  /**
   * Process settlements in batch (called by scheduled job)
   */
  async processSettlementBatch(symbol: string, batchSize: number = 100): Promise<BatchSettlementResult> {
    const tradeIds = this.novationQueue.get(symbol) || [];
    const toProcess = tradeIds.slice(0, batchSize);
    
    let processed = 0;
    let failed = 0;

    for (const tradeId of toProcess) {
      const trade = this.trades.get(tradeId);
      if (!trade) continue;

      try {
        // Simulate settlement execution
        await this.settleTrade(trade);
        processed++;
      } catch (error) {
        failed++;
        trade.status = SettlementStatus.FAILED;
        trade.failureReason = (error as Error).message;
      }
    }

    // Remove processed from queue
    if (processed > 0) {
      const remaining = tradeIds.slice(batchSize);
      this.novationQueue.set(symbol, remaining);
    }

    return {
      processed,
      failed,
      remaining: (this.novationQueue.get(symbol) || []).length
    };
  }

  /**
   * Get counterparty exposure for risk management
   */
  async getCounterpartyExposure(userId: string): Promise<CounterpartyExposure[]> {
    const exposures: CounterpartyExposure[] = [];
    
    for (const trade of this.trades.values()) {
      if (trade.status !== SettlementStatus.SETTLED) {
        if (trade.buyerId === userId) {
          exposures.push({
            counterpartyId: trade.sellerId,
            symbol: trade.symbol,
            amount: trade.settlementAmount,
            dueAt: trade.settlementDeadline
          });
        } else if (trade.sellerId === userId) {
          exposures.push({
            counterpartyId: trade.buyerId,
            symbol: trade.symbol,
            amount: trade.settlementAmount,
            dueAt: trade.settlementDeadline
          });
        }
      }
    }

    return exposures;
  }

  /**
   * Net settlements between two parties
   */
  async netSettlements(userA: string, userB: string, symbol: string): Promise<NettingResult> {
    const tradesAtoB = Array.from(this.trades.values())
      .filter(t => t.buyerId === userA && t.sellerId === userB && t.symbol === symbol);
    const tradesBtoA = Array.from(this.trades.values())
      .filter(t => t.buyerId === userB && t.sellerId === userA && t.symbol === symbol);

    const amountAtoB = tradesAtoB.reduce((sum, t) => sum + t.settlementAmount, 0);
    const amountBtoA = tradesBtoA.reduce((sum, t) => sum + t.settlementAmount, 0);
    const netAmount = amountAtoB - amountBtoA;

    return {
      partyA: userA,
      partyB: userB,
      symbol,
      amountAtoB,
      amountBtoA,
      netAmount,
      netDirection: netAmount > 0 ? 'A->B' : netAmount < 0 ? 'B->A' : 'even'
    };
  }

  private async settleTrade(trade: SettlementTrade): Promise<void> {
    trade.status = SettlementStatus.SETTLED;
    trade.settledAt = new Date();
  }

  private calculateSettlementDeadline(type?: SettlementType): Date {
    const now = Date.now();
    switch (type) {
      case SettlementType.INSTANT:
        return new Date(now + 60 * 1000);  // 1 minute
      case SettlementType.INSTITUTIONAL:
        return new Date(now + 2 * 24 * 60 * 60 * 1000);  // T+2
      case SettlementType.DELAYED:
        return new Date(now + 7 * 24 * 60 * 60 * 1000);  // T+7
      default:
        return new Date(now + 24 * 60 * 60 * 1000);  // T+1
    }
  }
}

interface ExecutionData {
  symbol: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  price: number;
  commission?: number;
  executedAt: Date;
  settlementType?: SettlementType;
  buyerAccount: string;
  sellerAccount: string;
}

interface SettlementTrade {
  tradeId: string;
  symbol: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  price: number;
  settlementAmount: number;
  commission: number;
  status: SettlementStatus;
  settlementType: SettlementType;
  executedAt: Date;
  novatedAt: Date;
  settlementDeadline: Date;
  buyerSettlementAccount: string;
  sellerSettlementAccount: string;
  settledAt?: Date;
  failureReason?: string;
}

interface NovationResult {
  tradeId: string;
  status: SettlementStatus;
  settlementDue: Date;
}

interface BatchSettlementResult {
  processed: number;
  failed: number;
  remaining: number;
}

interface CounterpartyExposure {
  counterpartyId: string;
  symbol: string;
  amount: number;
  dueAt: Date;
}

interface NettingResult {
  partyA: string;
  partyB: string;
  symbol: string;
  amountAtoB: number;
  amountBtoA: number;
  netAmount: number;
  netDirection: string;
}

export { SettlementStatus, SettlementType };