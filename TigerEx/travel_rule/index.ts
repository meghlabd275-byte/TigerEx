/**
 * Travel Rule Compliance System
 * Required for international crypto transfers (FATF Travel Rule)
 * Compliant with US, EU, UK regulations
 */

import { EventEmitter } from 'events';

// ============================================================================
// TRAVEL RULE REQUIREMENTS
// ============================================================================

export interface TravelRuleData {
  // Sender Information
  senderName: string;
  senderAccountNumber: string;
  senderGeographicAddress: string;
  senderLegalName?: string;
  senderBusinessInfo?: string;
  senderCountry: string;
  senderTIN?: string;
  
  // Recipient Information
  recipientName: string;
  recipientAccountNumber: string;
  recipientGeographicAddress: string;
  recipientCountry: string;
  recipientTIN?: string;
  
  // Transaction Information
  amount: number;
  currency: string;
  timestamp: number;
  cryptoChain?: string;
  txHash?: string;
  
  // Transfer Details
  transferType: 'wallet_transfer' | 'exchange_transfer' | 'custodial';
}

export interface TravelRuleCompliance {
  threshold: number;
  countries: string[];
  blockedCountries: string[];
  requiredFields: string[];
}

export interface TravelRuleRecord {
  id: string;
  transferId: string;
  data: TravelRuleData;
  status: 'pending' | 'verified' | 'flagged' | 'blocked';
  verifiedAt?: number;
  verifiedBy?: string;
  notes?: string;
}

// ============================================================================
// TRAVEL RULE MANAGER
// ============================================================================

export class TravelRuleManager extends EventEmitter {
  private records: Map<string, TravelRuleRecord> = new Map();
  private compliance: TravelRuleCompliance;

  constructor() {
    super();
    this.compliance = this.initCompliance();
  }

  private initCompliance(): TravelRuleCompliance {
    return {
      threshold: 3000,
      countries: ['US', 'GB', 'EU', 'AU', 'CA', 'JP', 'SG', 'KR', 'CH'],
      blockedCountries: ['KP', 'IR', 'SY', 'CU', 'BY'],
      requiredFields: [
        'senderName', 'senderAccountNumber', 'senderGeographicAddress',
        'senderCountry', 'recipientName', 'recipientAccountNumber',
        'recipientCountry', 'amount', 'currency',
      ],
    };
  }

  requiresDisclosure(data: TravelRuleData): boolean {
    const inUSD = this.convertToUSD(data.amount, data.currency);
    if (inUSD < this.compliance.threshold) return false;
    const senderRegulated = this.compliance.countries.includes(data.senderCountry);
    const recipientRegulated = this.compliance.countries.includes(data.recipientCountry);
    return senderRegulated || recipientRegulated;
  }

  private convertToUSD(amount: number, currency: string): number {
    const rates: Record<string, number> = {
      USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0067,
      BTC: 65000, ETH: 3500, USDT: 1, USDC: 1,
    };
    return amount * (rates[currency] || 1);
  }

  async validateTransfer(data: TravelRuleData): Promise<{
    allowed: boolean;
    requiresDisclosure: boolean;
    blockedReason?: string;
  }> {
    if (this.compliance.blockedCountries.includes(data.senderCountry)) {
      return { allowed: false, requiresDisclosure: false, blockedReason: 'Sender country sanctioned' };
    }
    if (this.compliance.blockedCountries.includes(data.recipientCountry)) {
      return { allowed: false, requiresDisclosure: false, blockedReason: 'Recipient country sanctioned' };
    }
    const requiresTR = this.requiresDisclosure(data);
    if (!requiresTR) return { allowed: true, requiresDisclosure: false };
    const missing = this.validateRequiredFields(data);
    if (missing.length > 0) {
      return { allowed: false, requiresDisclosure: true, blockedReason: `Missing: ${missing.join(', ')}` };
    }
    return { allowed: true, requiresDisclosure: true };
  }

  private validateRequiredFields(data: TravelRuleData): string[] {
    const missing: string[] = [];
    for (const field of this.compliance.requiredFields) {
      const value = (data as any)[field];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        missing.push(field);
      }
    }
    return missing;
  }

  async submitTravelRuleData(data: TravelRuleData): Promise<string> {
    const transferId = `tr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const record: TravelRuleRecord = { id: transferId, transferId, data, status: 'pending' };
    this.records.set(transferId, record);
    return transferId;
  }

  async verifyTransfer(transferId: string, verifierId: string, notes?: string): Promise<boolean> {
    const record = this.records.get(transferId);
    if (!record) return false;
    record.status = 'verified';
    record.verifiedAt = Date.now();
    record.verifiedBy = verifierId;
    record.notes = notes;
    return true;
  }

  async flagTransfer(transferId: string, reason: string): Promise<boolean> {
    const record = this.records.get(transferId);
    if (!record) return false;
    record.status = 'flagged';
    record.notes = reason;
    this.emit('transferFlagged', record);
    return true;
  }

  async blockTransfer(transferId: string, reason: string): Promise<boolean> {
    const record = this.records.get(transferId);
    if (!record) return false;
    record.status = 'blocked';
    record.notes = reason;
    this.emit('transferBlocked', record);
    return true;
  }

  getRecord(transferId: string): TravelRuleRecord | undefined {
    return this.records.get(transferId);
  }

  getComplianceRules(): TravelRuleCompliance {
    return this.compliance;
  }
}

// ============================================================================
// FATCA REPORTING
// ============================================================================

export interface FATCAReport {
  accountHolder: string;
  tin: string;
  country: string;
  accountNumber: string;
  accountBalance: number;
}

export class FATCAManager {
  async reportLargeTransactions(thresholdUSD: number = 10000): Promise<FATCAReport[]> {
    return [];
  }
}

export default TravelRuleManager;