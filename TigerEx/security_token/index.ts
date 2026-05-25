/**
 * TigerEx Security Tokens (STO)
 * 
 * Security token offering, tokenized securities,
 * compliant trading, investor relations
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export enum SecurityType {
  EQUITY = 'equity',
  DEBT = 'debt',
  hybrid = 'hybrid',
  DERIVATIVE = 'derivative',
  FUND = 'fund',
  REAL_ESTATE = 'real_estate'
}

export enum OfferingStatus {
  UPCOMING = 'upcoming',
  OPEN = 'open',
  CLOSED = 'closed',
  SETTLED = 'settled',
  CANCELLED = 'cancelled'
}

export enum InvestorStatus {
  ACCREDITED = 'accredited',
  QUALIFIED = 'qualified',
  RETAIL = 'retail',
  INSTITUTIONAL = 'institutional'
}

export enum KycLevel {
  NONE = 0,
  BASIC = 1,
  INTERMEDIATE = 2,
  ENHANCED = 3
}

export interface SecurityToken {
  id: string;
  name: string;
  symbol: string;
  issuer: string;
  securityType: SecurityType;
  totalSupply: number;
  pricePerToken: number;
  currency: string;
  blockchain: string;
  contractAddress: string;
  metadata: {
    jurisdiction: string;
    regulator: string;
    licenseNumber: string;
    offeringMemo: string;
  };
  investorLimits: {
    minInvestment: number;
    maxInvestmentPerInvestor: number;
    maxTotalRaise: number;
  };
  lockupPeriod: number;
  features: {
    divisible: boolean;
    transferable: boolean;
    dividends: boolean;
    voting: boolean;
    buyback: boolean;
  };
  status: 'pending' | 'active' | 'paused' | 'completed';
}

export interface STOOffering {
  id: string;
  securityTokenId: string;
  name: string;
  description: string;
  phase: 'seed' | 'series_a' | 'public';
  offeringType: 'public' | 'private' | 'ipo';
  
  raise: {
    target: number;
    raised: number;
    min: number;
    max: number;
    currency: string;
  };
  
  pricing: {
    tokenPrice: number;
    discount: number;
    earlyBirdDiscount: number;
    warrantCoverage: number;
  };
  
  timeline: {
    startDate: number;
    endDate: number;
    linearUnlockDate: number;
    cliffMonths: number;
  };
  
  allocation: {
    publicPercentage: number;
    privatePercentage: number;
    teamPercentage: number;
    advisorPercentage: number;
    ecosystemPercentage: number;
  };
  
  useOfProceeds: { category: string; percentage: number; amount: number }[];
  investorRights: string[];
  
  kycRequired: boolean;
  accreditedOnly: boolean;
  jurisdictionalRestrictions: string[];
  
  status: OfferingStatus;
  createdAt: number;
}

export interface InvestmentRecord {
  id: string;
  offeringId: string;
  investorId: string;
  investorType: InvestorStatus;
  kycLevel: KycLevel;
  amount: number;
  tokenAmount: number;
  price: number;
  discountApplied: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'settled' | 'cancelled';
  transactions: { type: string; hash: string; timestamp: number }[];
}

export interface DividendDistribution {
  id: string;
  securityTokenId: string;
  period: string;
  totalAmount: number;
  perToken: number;
  
  qualification: {
    minHolding: number;
    minPeriod: number;
  };
  
  recordDate: number;
  distributionDate: number;
  paymentMethods: string[];
}

export interface InvestorPortfolio {
  investorId: string;
  securities: {
    tokenId: string;
    balance: number;
    costBasis: number;
    currentValue: number;
    unrealizedPnL: number;
    realizedPnL: number;
    dividendsReceived: number;
    votingPower: number;
  }[];
  totalValue: number;
  totalCostBasis: number;
  totalDividends: number;
}

export interface VotingRecord {
  id: string;
  securityTokenId: string;
  proposer: string;
  title: string;
  description: string;
  proposalType: ' issuance' | 'amendment' | 'governance' | 'buyback';
  votingStart: number;
  votingEnd: number;
  quorum: number;
  votes: { investorId: string; choice: 'for' | 'against' | 'abstain'; weight: number }[];
  results: { for: number; against: number; abstain: number };
  status: 'pending' | 'active' | 'passed' | 'rejected';
}

// ============================================================================
// SECURITY TOKEN ENGINE
// ============================================================================

export class SecurityTokenEngine {
  private securities: Map<string, SecurityToken> = new Map();
  private offerings: Map<string, STOOffering> = new Map();
  private investments: Map<string, InvestmentRecord> = new Map();
  private dividends: Map<string, DividendDistribution> = new Maps();
  private portfolios: Map<string, InvestorPortfolio> = new Map();
  private votes: Map<string, VotingRecord> = new Map();
  private counter = 1;

  // Create security token
  async createSecurityToken(params: Omit<SecurityToken, 'id' | 'status'>): Promise<{ tokenId: string; contractAddress: string }> {
    const token: SecurityToken = {
      id: `sec_${this.counter++}`,
      ...params,
      status: 'pending'
    };
    
    this.securities.set(token.id, token);
    
    return {
      tokenId: token.id,
      contractAddress: token.contractAddress
    };
  }

  async getSecurityToken(tokenId: string): Promise<SecurityToken | undefined> {
    return this.securities.get(tokenId);
  }

  async getAllSecurityTokens(filter?: { securityType?: SecurityType; status?: string }): Promise<SecurityToken[]> {
    let result = Array.from(this.securities.values());
    if (filter?.securityType) result = result.filter(s => s.securityType === filter.securityType);
    if (filter?.status) result = result.filter(s => s.status === filter.status);
    return result;
  }

  // Create offering
  async createOffering(params: Omit<STOOffering, 'id' | 'createdAt'>): Promise<{ offeringId: string; status: string }> {
    const offering: STOOffering = {
      id: `offer_${this.counter++}`,
      ...params,
      createdAt: Date.now(),
      status: OfferingStatus.OPEN
    };
    
    this.offerings.set(offering.id, offering);
    return { offeringId: offering.id, status: OfferingStatus.OPEN };
  }

  async getOffering(offeringId: string): Promise<STOOffering | undefined> {
    return this.offerings.get(offeringId);
  }

  async getOfferings(status?: OfferingStatus): Promise<STOOffering[]> {
    if (!status) return Array.from(this.offerings.values());
    return Array.from(this.offerings.values()).filter(o => o.status === status);
  }

  // Investment
  async invest(params: {
    offeringId: string;
    investorId: string;
    investorType: InvestorStatus;
    kycLevel: KycLevel;
    amount: number;
  }): Promise<{ investmentId: string; tokenAmount: number; status: string }> {
    const offering = this.offerings.get(params.offeringId);
    if (!offering) throw new Error('Offering not found');
    
    const discount = Date.now() < offering.timeline.startDate + 86400000 * 7 ? offering.pricing.earlyBirdDiscount :
                   Date.now() < offering.timeline.startDate + 86400000 * 30 ? offering.pricing.discount : 0;
    
    const price = offering.pricing.tokenPrice * (1 - discount);
    const tokenAmount = params.amount / price;
    const investment: InvestmentRecord = {
      id: `inv_${this.counter++}`,
      offeringId: params.offeringId,
      investorId: params.investorId,
      investorType: params.investorType,
      kycLevel: params.kycLevel,
      amount: params.amount,
      tokenAmount,
      price,
      discountApplied: discount,
      timestamp: Date.now(),
      status: 'pending',
      transactions: []
    };
    
    offering.raise.raised += params.amount;
    this.investments.set(investment.id, investment);
    
    return {
      investmentId: investment.id,
      tokenAmount,
      status: 'pending'
    };
  }

  async confirmInvestment(investmentId: string): Promise<{ confirmed: boolean }> {
    const inv = this.investments.get(investmentId);
    if (!inv) return { confirmed: false };
    
    inv.status = 'confirmed';
    inv.transactions.push({ type: 'confirmation', hash: `0x${Math.random().toString(16).substr(2, 64)}`, timestamp: Date.now() });
    
    return { confirmed: true };
  }

  async settleInvestment(investmentId: string): Promise<{ settled: boolean; txHash: string }> {
    const inv = this.investments.get(investmentId);
    if (!inv) return { settled: false, txHash: '' };
    
    inv.status = 'settled';
    inv.transactions.push({ type: 'settlement', hash: `0x${Math.random().toString(16).substr(2, 64)}`, timestamp: Date.now() });
    
    return { settled: true, txHash: inv.transactions[inv.transactions.length - 1].hash };
  }

  async getInvestorInvestments(investorId: string): Promise<InvestmentRecord[]> {
    return Array.from(this.investments.values()).filter(i => i.investorId === investorId);
  }

  async getOfferingInvestors(offeringId: string): Promise<{ investorId: string; totalInvested: number; investorType: InvestorStatus }[]> {
    const investments = Array.from(this.investments.values()).filter(i => i.offeringId === offeringId);
    const aggregated: Map<string, { totalInvested: number; investorType: InvestorStatus }> = new Map();
    
    investments.forEach(inv => {
      const existing = aggregated.get(inv.investorId);
      if (existing) {
        existing.totalInvested += inv.amount;
      } else {
        aggregated.set(inv.investorId, { totalInvested: inv.amount, investorType: inv.investorType });
      }
    });
    
    return Array.from(aggregated.entries()).map(([investorId, data]) => ({ investorId, ...data }));
  }

  // Dividends
  async declareDividend(params: {
    securityTokenId: string;
    period: string;
    totalAmount: number;
    minHolding: number;
    minPeriodDays: number;
  }): Promise<{ dividendId: string }> {
    const sec = this.securities.get(params.securityTokenId);
    if (!sec) throw new Error('Security not found');
    
    const dividend: DividendDistribution = {
      id: `div_${this.counter++}`,
      securityTokenId: params.securityTokenId,
      period: params.period,
      totalAmount: params.totalAmount,
      perToken: params.totalAmount / sec.totalSupply,
      qualification: {
        minHolding: params.minHolding,
        minPeriod: params.minPeriodDays * 86400000
      },
      recordDate: Date.now(),
      distributionDate: Date.now() + 86400000 * 14,
      paymentMethods: ['wire', 'stablecoin', 'bank_transfer']
    };
    
    this.dividends.set(dividend.id, dividend);
    return { dividendId: dividend.id };
  }

  async claimDividend(dividendId: string, investorId: string): Promise<{ claimed: boolean; amount: number }> {
    const div = this.dividends.get(dividendId);
    if (!div) return { claimed: false, amount: 0 };
    
    const portfolio = this.portfolios.get(investorId);
    if (!portfolio) return { claimed: false, amount: 0 };
    
    const holding = portfolio.securities.find(s => s.tokenId === div.securityTokenId);
    if (!holding || holding.balance < div.qualification.minHolding) return { claimed: false, amount: 0 };
    
    const amount = holding.balance * div.perToken;
    holding.dividendsReceived += amount;
    
    return { claimed: true, amount };
  }

  async getDividendHistory(securityTokenId: string): Promise<DividendDistribution[]> {
    return Array.from(this.dividends.values())
      .filter(d => d.securityTokenId === securityTokenId)
      .sort((a, b) => b.recordDate - a.recordDate);
  }

  // Governance / Voting
  async createProposal(params: {
    securityTokenId: string;
    proposer: string;
    title: string;
    description: string;
    proposalType: 'issuance' | 'amendment' | 'governance' | 'buyback';
    duration: number;
  }): Promise<{ proposalId: string }> {
    const vote: VotingRecord = {
      id: `vote_${this.counter++}`,
      securityTokenId: params.securityTokenId,
      proposer: params.proposer,
      title: params.title,
      description: params.description,
      proposalType: params.proposalType,
      votingStart: Date.now(),
      votingEnd: Date.now() + params.duration,
      quorum: 50,
      votes: [],
      results: { for: 0, against: 0, abstain: 0 },
      status: 'active'
    };
    
    this.votes.set(vote.id, vote);
    return { proposalId: vote.id };
  }

  async castVote(proposalId: string, investorId: string, choice: 'for' | 'against' | 'abstain', weight: number): Promise<{ voted: boolean }> {
    const vote = this.votes.get(proposalId);
    if (!vote || vote.status !== 'active') return { voted: false };
    
    vote.votes.push({ investorId, choice, weight });
    vote.results[choice] += weight;
    
    return { voted: true };
  }

  async tallyVotes(proposalId: string): Promise<{ passed: boolean; turnout: number }> {
    const vote = this.votes.get(proposalId);
    if (!vote) return { passed: false, turnout: 0 };
    
    const totalVotes = vote.results.for + vote.results.against + vote.results.abstain;
    const passed = vote.results.for > vote.quorum;
    
    vote.status = passed ? 'passed' : 'rejected';
    
    return { passed, turnout: totalVotes };
  }

  // Investor portfolio
  async getPortfolio(investorId: string): Promise<InvestorPortfolio | undefined> {
    return this.portfolios.get(investorId);
  }

  async getInvestorHoldings(investorId: string, securityTokenId: string): Promise<{ balance: number; costBasis: number; currentValue: number; pnl: number } | null> {
    const portfolio = this.portfolios.get(investorId);
    if (!portfolio) return null;
    
    const holding = portfolio.securities.find(s => s.tokenId === securityTokenId);
    if (!holding) return null;
    
    return {
      balance: holding.balance,
      costBasis: holding.costBasis,
      currentValue: holding.currentValue,
      pnl: holding.unrealizedPnL
    };
  }

  // Secondary trading
  async createOrder(params: {
    securityTokenId: string;
    sellerId: string;
    quantity: number;
    price: number;
    orderType: 'limit' | 'market';
  }): Promise<{ orderId: string; status: string }> {
    return { orderId: `ord_${this.counter++}`, status: 'open' };
  }

  async fillOrder(params: { orderId: string; buyerId: string; quantity: number }): Promise<{ filled: boolean; price: number }> {
    return { filled: true, price: 520 };
  }

  // Compliance checks
  async verifyInvestorEligibility(investorId: string, offeringId: string): Promise<{
    eligible: boolean;
    reasons: string[];
  }> {
    const offering = this.offerings.get(offeringId);
    if (!offering) return { eligible: false, reasons: ['Offering not found'] };
    
    const reasons: string[] = [];
    
    if (offering.accreditedOnly) {
      reasons.push('Accredited investor verification required');
    }
    
    if (offering.jurisdictionalRestrictions.length > 0) {
      reasons.push(`Restricted in: ${offering.jurisdictionalRestrictions.join(', ')}`);
    }
    
    return { eligible: reasons.length === 0, reasons };
  }

  // Reports
  async generateOfferingReport(offeringId: string): Promise<any> {
    const offering = this.offerings.get(offeringId);
    if (!offering) return null;
    
    const investments = await this.getOfferingInvestors(offeringId);
    const totalInvested = investments.reduce((sum, i) => sum + i.totalInvested, 0);
    
    return {
      offeringId,
      name: offering.name,
      target: offering.raise.target,
      raised: totalInvested,
      investorCount: investments.length,
      avgInvestment: totalInvested / investments.length,
      byInvestorType: investments.reduce((acc, i) => {
        acc[i.investorType] = (acc[i.investorType] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

export const securityTokenEngine = new SecurityTokenEngine();

export default SecurityTokenEngine;
export { SecurityType, OfferingStatus, InvestorStatus, KycLevel, SecurityToken, STOOffering, InvestmentRecord, DividendDistribution, InvestorPortfolio, VotingRecord };