/**
 * TigerEx Insurance Fund Platform
 * 
 * SAFU (Secure Asset Fund) like TigerEx SAFU
 * Features: Insurance coverage, claims, reserve management
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

export enum ClaimStatus {
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid'
}

export interface InsuranceClaim {
  id: string;
  user_id: string;
  incident_type: string;
  description: string;
  amount_claimed: number;
  currency: string;
  evidence: string[];
  status: ClaimStatus;
  reviewer?: string;
  decision_note?: string;
  amount_approved?: number;
  created_at: Date;
  resolved_at?: Date;
}

export interface ReserveAllocation {
  id: string;
  token: string;
  amount: number;
  value_usd: number;
  allocation: 'hot_wallet' | 'cold_storage' | 'insurance';
}

export class InsuranceFundPlatform {
  private logger: Logger;
  private reserves: Map<string, number> = new Map();
  private claims: Map<string, InsuranceClaim> = new Map();
  private eventEmitter: EventEmitter;

  constructor() {
    this.logger = new Logger('InsuranceFund');
    this.eventEmitter = new EventEmitter();
    this.initializeReserves();
  }

  private initializeReserves(): void {
    this.reserves.set('USDT', 100000000);
    this.reserves.set('USDC', 50000000);
    this.reserves.set('BTC', 15000);
    this.reserves.set('ETH', 100000);
  }

  async getBalance(token?: string): Promise<number | Record<string, number>> {
    if (token) return this.reserves.get(token) || 0;
    return Object.fromEntries(this.reserves);
  }

  async getTotalValueUSD(): Promise<number> {
    let total = 0;
    const prices: Record<string, number> = { USDT: 1, USDC: 1, BTC: 50000, ETH: 2500 };
    for (const [token, amount] of this.reserves) {
      total += amount * (prices[token] || 0);
    }
    return total;
  }

  async contribute(userId: string, token: string, amount: number): Promise<void> {
    const current = this.reserves.get(token) || 0;
    this.reserves.set(token, current + amount);
    this.eventEmitter.emit('contribution', { userId, token, amount });
  }

  async submitClaim(params: {
    user_id: string;
    incident_type: string;
    description: string;
    amount_claimed: number;
    currency: string;
    evidence: string[];
  }): Promise<InsuranceClaim> {
    const claim: InsuranceClaim = {
      id: `claim_${Date.now()}`,
      user_id: params.user_id,
      incident_type: params.incident_type,
      description: params.description,
      amount_claimed: params.amount_claimed,
      currency: params.currency,
      evidence: params.evidence,
      status: ClaimStatus.SUBMITTED,
      created_at: new Date()
    };
    this.claims.set(claim.id, claim);
    this.eventEmitter.emit('claim_submitted', claim);
    return claim;
  }

  async reviewClaim(claimId: string, reviewer: string): Promise<void> {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error('Claim not found');
    claim.status = ClaimStatus.UNDER_REVIEW;
    claim.reviewer = reviewer;
    this.claims.set(claimId, claim);
  }

  async resolveClaim(params: {
    claim_id: string;
    approved: boolean;
    amount_approved?: number;
    decision_note: string;
  }): Promise<void> {
    const claim = this.claims.get(params.claim_id);
    if (!claim) throw new Error('Claim not found');
    
    claim.status = params.approved ? ClaimStatus.APPROVED : ClaimStatus.REJECTED;
    claim.decision_note = params.decision_note;
    claim.amount_approved = params.amount_approved;
    claim.resolved_at = new Date();
    this.claims.set(params.claim_id, claim);

    if (params.approved && params.amount_approved) {
      claim.status = ClaimStatus.PAID;
      // Would transfer funds to user
    }
    this.eventEmitter.emit('claim_resolved', claim);
  }

  async getClaims(userId?: string): Promise<InsuranceClaim[]> {
    let r = Array.from(this.claims.values());
    if (userId) r = r.filter(c => c.user_id === userId);
    return r;
  }

  async getClaim(claimId: string): Promise<InsuranceClaim | null> { return this.claims.get(claimId) || null; }

  async allocateReserve(token: string, amount: number, allocation: 'hot_wallet' | 'cold_storage' | 'insurance'): Promise<void> {
    const current = this.reserves.get(token) || 0;
    if (amount > current) throw new Error('Insufficient reserves');
    this.reserves.set(token, current - amount);
    this.eventEmitter.emit('reserve_allocated', { token, amount, allocation });
  }
}

export default InsuranceFundPlatform;