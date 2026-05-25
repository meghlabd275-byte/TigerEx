/**
 * Insurance Protection System
 * Protect users from hacks, smart contract failures, and technical issues
 */

import { EventEmitter } from 'events';

// ============================================================================
// INSURANCE TYPES
// ============================================================================

export type InsuranceType = 'hack' | 'smart_contract' | 'stablecoin' | 'bridge' | 'custody';
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type CoverageLevel = 'basic' | 'silver' | 'gold' | 'platinum';

// ============================================================================
// INSURANCE POOL
// ============================================================================

export interface InsurancePool {
  id: string;
  type: InsuranceType;
  name: string;
  totalCovered: number;    // Total coverage limit
  availableCoverage: number;
  premiumRate: number;     // Annual percentage
  claimsPaid: number;
  claimsRejected: number;
  reserves: number;        // Treasury balance
  minCoverage: number;
  maxCoverage: number;
}

// ============================================================================
// USER COVERAGE
// ============================================================================

export interface UserCoverage {
  id: string;
  poolId: string;
  userId: string;
  level: CoverageLevel;
  coveredAmount: number;
  premiumPaid: number;
  startTime: number;
  expirationTime: number;
  active: boolean;
}

// ============================================================================
// CLAIMS
// ============================================================================

export interface InsuranceClaim {
  id: string;
  poolId: string;
  userId: string;
  incidentType: InsuranceType;
  amount: number;
  description: string;
  evidence: string[];
  status: ClaimStatus;
  submittedAt: number;
  reviewStartedAt?: number;
  resolvedAt?: number;
  reviewerId?: string;
  payoutAmount?: number;
  rejectionReason?: string;
}

// ============================================================================
// INSURANCE MANAGER
// ============================================================================

export class InsuranceManager extends EventEmitter {
  private pools: Map<string, InsurancePool> = new Map();
  private userCoverages: Map<string, UserCoverage[]> = new Map();
  private claims: Map<string, InsuranceClaim[]> = new Map();

  constructor() {
    super();
    this.initializePools();
  }

  // ============================================================================
  // INIT INSURANCE POOLS
  // ============================================================================

  private initializePools(): void {
    const pools: Omit<InsurancePool, 'claimsPaid' | 'claimsRejected'>[] = [
      {
        id: 'pool_hack',
        type: 'hack',
        name: 'Protocol Hack Coverage',
        totalCovered: 100000000,
        availableCoverage: 80000000,
        premiumRate: 0.02,  // 2% annual
        reserves: 50000000,
        minCoverage: 100,
        maxCoverage: 1000000,
      },
      {
        id: 'pool_sc',
        type: 'smart_contract',
        name: 'Smart Contract Failure',
        totalCovered: 50000000,
        availableCoverage: 45000000,
        premiumRate: 0.01,
        reserves: 30000000,
        minCoverage: 100,
        maxCoverage: 500000,
      },
      {
        id: 'pool_stable',
        type: 'stablecoin',
        name: 'Stablecoin De-Peg Coverage',
        totalCovered: 20000000,
        availableCoverage: 18000000,
        premiumRate: 0.005,
        reserves: 15000000,
        minCoverage: 1000,
        maxCoverage: 100000,
      },
      {
        id: 'pool_bridge',
        type: 'bridge',
        name: 'Bridge Failure Coverage',
        totalCovered: 30000000,
        availableCoverage: 25000000,
        premiumRate: 0.015,
        reserves: 20000000,
        minCoverage: 100,
        maxCoverage: 250000,
      },
      {
        id: 'pool_custody',
        type: 'custody',
        name: 'Custody Coverage',
        totalCovered: 100000000,
        availableCoverage: 90000000,
        premiumRate: 0.008,
        reserves: 75000000,
        minCoverage: 1000,
        maxCoverage: 5000000,
      },
    ];

    for (const pool of pools) {
      this.pools.set(pool.id, { ...pool, claimsPaid: 0, claimsRejected: 0 });
    }
  }

  // ============================================================================
  // PURCHASE COVERAGE
  // ============================================================================

  async purchaseCoverage(
    userId: string,
    poolId: string,
    level: CoverageLevel,
    coverageAmount: number
  ): Promise<{ success: boolean; coverageId?: string; premium: number }> {
    const pool = this.pools.get(poolId);
    if (!pool) return { success: false };

    // Validate amount
    if (coverageAmount < pool.minCoverage || coverageAmount > pool.maxCoverage) {
      return { success: false };
    }

    // Check availability
    if (coverageAmount > pool.availableCoverage) {
      return { success: false };
    }

    // Calculate premium
    const multiplier: Record<CoverageLevel, number> = {
      basic: 1,
      silver: 0.9,
      gold: 0.8,
      platinum: 0.7,
    };
    const premium = coverageAmount * pool.premiumRate * multiplier[level];

    // Create coverage
    const coverageId = `cov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const coverage: UserCoverage = {
      id: coverageId,
      poolId,
      userId,
      level,
      coveredAmount,
      premiumPaid: premium,
      startTime: Date.now(),
      expirationTime: Date.now() + 365 * 24 * 60 * 60 * 1000,
      active: true,
    };

    const existing = this.userCoverages.get(userId) || [];
    existing.push(coverage);
    this.userCoverages.set(userId, existing);

    // Update pool
    pool.availableCoverage -= coverageAmount;

    return { success: true, coverageId, premium };
  }

  // ============================================================================
  // FILE CLAIM
  // ============================================================================

  async fileClaim(
    userId: string,
    poolId: string,
    incidentType: InsuranceType,
    amount: number,
    description: string,
    evidence: string[]
  ): Promise<{ success: boolean; claimId?: string }> {
    const pool = this.pools.get(poolId);
    if (!pool) return { success: false };

    // Check user's coverage
    const userCoverage = this.getUserCoverageForPool(userId, poolId);
    if (!userCoverage || !userCoverage.active) {
      return { success: false };
    }

    // Verify amount is within coverage
    if (amount > userCoverage.coveredAmount) {
      amount = userCoverage.coveredAmount;
    }

    // Check pool has funds
    if (amount > pool.availableCoverage && amount > pool.reserves * 0.1) {
      return { success: false };
    }

    // Create claim
    const claimId = `claim_${Date.now()}`;
    
    const claim: InsuranceClaim = {
      id: claimId,
      poolId,
      userId,
      incidentType,
      amount,
      description,
      evidence,
      status: 'pending',
      submittedAt: Date.now(),
    };

    const existing = this.claims.get(poolId) || [];
    existing.push(claim);
    this.claims.set(poolId, existing);

    this.emit('claim filed', claim);

    return { success: true, claimId };
  }

  // ============================================================================
  // PROCESS CLAIM
  // ============================================================================

  async processClaim(
    claimId: string,
    reviewerId: string,
    approved: boolean,
    payoutAmount?: number,
    rejectionReason?: string
  ): Promise<boolean> {
    let claim: InsuranceClaim | undefined;
    
    for (const claims of this.claims.values()) {
      claim = claims.find(c => c.id === claimId);
      if (claim) break;
    }
    
    if (!claim) return false;

    const pool = this.pools.get(claim.poolId);
    if (!pool) return false;

    claim.status = approved ? 'approved' : 'rejected';
    claim.reviewStartedAt = Date.now();
    claim.reviewerId = reviewerId;
    claim.resolvedAt = Date.now();

    if (approved && payoutAmount && claim.status === 'approved') {
      claim.status = 'paid';
      claim.payoutAmount = payoutAmount;
      pool.availableCoverage -= payoutAmount;
      pool.claimsPaid++;

      this.emit('claimPaid', { claimId, amount: payoutAmount });
    } else {
      pool.claimsRejected++;
    }

    return true;
  }

  // ============================================================================
  // GET COVERAGE FOR USER
  // ============================================================================

  getUserCoverageForPool(userId: string, poolId: string): UserCoverage | undefined {
    const coverages = this.userCoverages.get(userId) || [];
    return coverages.find(c => c.poolId === poolId && c.active);
  }

  getUserCoverages(userId: string): UserCoverage[] {
    return this.userCoverages.get(userId) || [];
  }

  // ============================================================================
  // GET TOTAL COVERAGE VALUE
  // ============================================================================

  getTotalCoverage(userId: string): number {
    return this.getUserCoverages(userId)
      .filter(c => c.active)
      .reduce((sum, c) => sum + c.coveredAmount, 0);
  }

  // ============================================================================
  // GET POOLS
  // ============================================================================

  getPools(): InsurancePool[] {
    return Array.from(this.pools.values());
  }

  getPool(poolId: string): InsurancePool | undefined {
    return this.pools.get(poolId);
  }

  // ============================================================================
  // GET CLAIMS
  // ============================================================================

  getClaims(userId: string): InsuranceClaim[] {
    return Array.from(this.claims.values()).flat().filter(c => c.userId === userId);
  }

  // ============================================================================
  // RENEW COVERAGE
  // ============================================================================

  async renewCoverage(coverageId: string): Promise<{ success: boolean; newExpiration: number }> {
    for (const [, coverages] of this.userCoverages) {
      const coverage = coverages.find(c => c.id === coverageId);
      if (coverage) {
        const pool = this.pools.get(coverage.poolId);
        if (!pool) return { success: false, newExpiration: 0 };

        // Renew for another year
        coverage.expirationTime = Date.now() + 365 * 24 * 60 * 60 * 1000;

        return { success: true, newExpiration: coverage.expirationTime };
      }
    }

    return { success: false, newExpiration: 0 };
  }

  // ============================================================================
  // ADD TO RESERVES (Pool funding)
  // ============================================================================

  async addToReserves(poolId: string, amount: number): Promise<boolean> {
    const pool = this.pools.get(poolId);
    if (!pool) return false;

    pool.reserves += amount;
    pool.availableCoverage += amount * 0.8; // 80% goes to coverage

    return true;
  }
}

export default InsuranceManager;