/**
 * AML/KYC Compliance System
 * Anti-Money Laundering & Know Your Customer
 * Required for all financial institutions
 */

import { EventEmitter } from 'events';

// ============================================================================
// KYC LEVELS
// ============================================================================

export type KYCLevel = 'none' | 'basic' | 'intermediate' | 'full' | 'institutional';
export type KYCStatus = 'pending' | 'approved' | 'rejected' | '需要额外信息';

// ============================================================================
// KYC DOCUMENTS
// ============================================================================

export interface KYCDocument {
  id: string;
  type: 'passport' | 'national_id' | 'driver_license' | 'utility_bill' | 'bank_statement';
  country: string;
  number: string;
  expiryDate?: number;
  verified: boolean;
}

/** 
 * @deprecated This interface is deprecated. Please use KYCDocument instead.
 */
export interface __Kycdocument extends KYCDocument {}

// ============================================================================
// KYC DATA
// ============================================================================

export interface KYCData {
  userId: string;
  level: KYCLevel;
  status: KYCStatus;
  
  // Personal Info
  firstName: string;
  lastName: string;
  dateOfBirth: number;
  nationality: string;
  country: string;
  address: string;
  city: string;
  postalCode: string;
  
  // Documents
  documents: KYCDocument[];
  
  // Verification
  submittedAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
  rejectionReason?: string;
  
  // AML Score
  amlScore: number;  // 0-100, higher = riskier
  amlChecked: boolean;
  pepStatus: boolean;  // Politically Exposed Person
  sanctionsStatus: boolean;
}

// ============================================================================
// SUSPICIOUS ACTIVITY
// ============================================================================

export interface SuspiciousActivity {
  id: string;
  userId: string;
  type: 'large_deposit' | 'rapid_movement' | 'unusual_pattern' | 'structuring' | 'layering';
  description: string;
  amount?: number;
  timestamp: number;
  status: 'open' | 'investigating' | 'resolved' | 'reported';
  notes?: string;
}

// ============================================================================
// AML/KYC MANAGER
// ============================================================================

export class AMLKYCManager extends EventEmitter {
  private kycData: Map<string, KYCData> = new Map();
  private suspiciousActivities: Map<string, SuspiciousActivity[]> = new Map();
  
  // Limits per KYC level
  private limits: Record<KYCLevel, { deposit: number; withdrawal: number; trading: number }> = {
    none: { deposit: 100, withdrawal: 100, trading: 100 },
    basic: { deposit: 1000, withdrawal: 1000, trading: 5000 },
    intermediate: { deposit: 10000, withdrawal: 10000, trading: 50000 },
    full: { deposit: 100000, withdrawal: 100000, trading: 500000 },
    institutional: { deposit: Infinity, withdrawal: Infinity, trading: Infinity },
  };

  // ============================================================================
  // START KYC PROCESS
  // ============================================================================

  async startKYC(userId: string, firstName: string, lastName: string): Promise<{
    kycId: string;
    level: KYCLevel;
  }> {
    const kycId = `kyc_${userId}_${Date.now()}`;
    
    const kyc: KYCData = {
      userId,
      level: 'none',
      status: 'pending',
      firstName,
      lastName,
      dateOfBirth: 0,
      nationality: '',
      country: '',
      address: '',
      city: '',
      postalCode: '',
      documents: [],
      amlScore: 0,
      amlChecked: false,
      pepStatus: false,
      sanctionsStatus: false,
    };
    
    this.kycData.set(kycId, kyc);
    return { kycId, level: 'none' };
  }

  // ============================================================================
  // SUBMIT DOCUMENTS
  // ============================================================================

  async submitDocument(
    kycId: string,
    type: KYCDocument['type'],
    country: string,
    number: string,
    expiryDate?: number
  ): Promise<boolean> {
    const kyc = this.kycData.get(kycId);
    if (!kyc) return false;
    
    const doc: KYCDocument = {
      id: `doc_${Date.now()}`,
      type,
      country,
      number,
      expiryDate,
      verified: false,
    };
    
    kyc.documents.push(doc);
    
    // Auto-upgrade level based on documents
    if (documents.length >= 2) {
      kyc.level = 'basic';
    }
    if (documents.length >= 3) {
      kyc.level = 'intermediate';
    }
    
    return true;
  }

  // ============================================================================
  // VERIFY DOCUMENTS (AML CHECK)
  // ============================================================================

  async verifyDocuments(kycId: string): Promise<{
    approved: boolean;
    newLevel: KYCLevel;
    amlScore: number;
    issues: string[];
  }> {
    const kyc = this.kycData.get(kycId);
    if (!kyc) return { approved: false, newLevel: 'none', amlScore: 0, issues: ['KYC not found'] };
    
    const issues: string[] = [];
    let amlScore = 0;
    
    // Check documents
    if (kyc.documents.length < 2) {
      issues.push('Insufficient documents');
      amlScore += 30;
    }
    
    // Check personal info completeness
    if (!kyc.firstName || !kyc.lastName || !kyc.dateOfBirth) {
      issues.push('Missing personal information');
      amlScore += 20;
    }
    
    // Check age
    const age = (Date.now() - kyc.dateOfBirth) / (365 * 24 * 60 * 60 * 1000);
    if (age < 18) {
      issues.push('Account holder must be 18+');
    }
    
    // High-risk countries
    const highRiskCountries = ['KP', 'IR', 'SY', 'CU', 'BY', 'VE', 'ZW'];
    if (highRiskCountries.includes(kyc.country)) {
      amlScore += 50;
      issues.push('High-risk country');
    }
    
    // PEP check simulation
    kyc.pepStatus = Math.random() > 0.95;
    if (kyc.pepStatus) {
      amlScore += 40;
      issues.push('PEP detected');
    }
    
    // Sanctions check simulation
    kyc.sanctionsStatus = false;
    if (kyc.sanctionsStatus) {
      amlScore = 100;
      issues.push('Sanctioned entity');
    }
    
    kyc.amlScore = amlScore;
    kyc.amlChecked = true;
    
    // Determine level
    let newLevel: KYCLevel = 'none';
    if (issues.length === 0 && amlScore < 30) {
      newLevel = 'full';
      kyc.status = 'approved';
    } else if (amlScore < 50) {
      newLevel = 'intermediate';
      kyc.status = 'approved';
    } else if (amlScore < 70) {
      newLevel = 'basic';
      kyc.status = 'approved';
    } else {
      newLevel = 'none';
      kyc.status = 'rejected';
      kyc.rejectionReason = issues.join(', ');
    }
    
    kyc.level = newLevel;
    kyc.submittedAt = Date.now();
    
    return { approved: kyc.status === 'approved', newLevel, amlScore, issues };
  }

  // ============================================================================
  // GET LIMITS FOR USER
  // ============================================================================

  getLimits(userId: string): { deposit: number; withdrawal: number; trading: number } {
    const kyc = Array.from(this.kycData.values()).find(k => k.userId === userId);
    if (!kyc) return this.limits.none;
    
    return this.limits[kyc.level];
  }

  // ============================================================================
  // SUSPICIOUS ACTIVITY REPORTING
  // ============================================================================

  async reportSuspiciousActivity(
    userId: string,
    type: SuspiciousActivity['type'],
    description: string,
    amount?: number
  ): Promise<string> {
    const activityId = `sar_${Date.now()}`;
    
    const activity: SuspiciousActivity = {
      id: activityId,
      userId,
      type,
      description,
      amount,
      timestamp: Date.now(),
      status: 'open',
    };
    
    const existing = this.suspiciousActivities.get(userId) || [];
    existing.push(activity);
    this.suspiciousActivities.set(userId, existing);
    
    this.emit('suspiciousActivity', activity);
    
    return activityId;
  }

  // ============================================================================
  // STRUCTURING DETECTION (Smurfing prevention)
  // ============================================================================

  async checkForStructuring(
    userId: string,
    transactions: { amount: number; timestamp: number }[]
  ): Promise<{ detected: boolean; details: string }> {
    // Look for multiple transactions just under $10,000
    const threshold = 10000;
    let total = 0;
    const recent = transactions.filter(t => Date.now() - t.timestamp < 24 * 60 * 60 * 1000);
    
    for (const tx of recent) {
      if (tx.amount < threshold) {
        total += tx.amount;
      }
    }
    
    if (total >= threshold && total < threshold * 1.1) {
      await this.reportSuspiciousActivity(userId, 'structuring', 
        `Potential structuring: $${total.toFixed(2)} in 24h`);
      return { detected: true, details: 'Structuring pattern detected' };
    }
    
    return { detected: false, details: '' };
  }

  // ============================================================================
  // GET KYC STATUS
  // ============================================================================

  getKYCStatus(userId: string): KYCData | undefined {
    return Array.from(this.kycData.values()).find(k => k.userId === userId);
  }

  // ============================================================================
  // MANUAL APPROVAL (Admin)
  // ============================================================================

  async manualApproval(
    kycId: string,
    reviewerId: string,
    approved: boolean,
    notes?: string
  ): Promise<boolean> {
    const kyc = this.kycData.get(kycId);
    if (!kyc) return false;
    
    kyc.status = approved ? 'approved' : 'rejected';
    kyc.reviewedAt = Date.now();
    kyc.reviewedBy = reviewerId;
    kyc.rejectionReason = notes;
    
    return true;
  }
}

export default AMLKYCManager;