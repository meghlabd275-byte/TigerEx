/**
 * Compliance Module
 * TypeScript implementation for KYC/AML requirements
 */

export interface KYCDocument {
  type: 'passport' | 'national_id' | 'driver_license' | 'utility_bill';
  number: string;
  issuedCountry: string;
  expiryDate?: number;
}

export interface KYCSubmission {
  document: KYCDocument;
  selfieImage: string;
  proofOfAddress?: string;
}

export interface KYCStatus {
  level: number;
  status: 'none' | 'pending' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';
  rejectionReason?: string;
  submittedAt?: number;
  reviewedAt?: number;
}

export interface AMLCheck {
  id: string;
  userId: string;
  timestamp: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  pepStatus: boolean;
  sanctionsScreening: 'clear' | 'match';
  adverseMedia: boolean;
  flaggedActivities: string[];
}

export interface TravelRule {
  senderAddress: string;
  senderCountry: string;
  senderFinancialInstitution: string;
  receiverAddress: string;
  receiverCountry: string;
  receiverFinancialInstitution: string;
  amount: string;
  currency: string;
}

export interface ComplianceConfig {
  kycLevels: {
    level: number;
    name: string;
    depositLimit: string;
    withdrawalLimit: string;
    tradingEnabled: boolean;
    fiatEnabled: boolean;
  }[];
  amlThreshold: string;
  travelRuleThreshold: string;
  restrictedCountries: string[];
}

export class ComplianceService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getKYCStatus(): Promise<KYCStatus> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/kyc/status`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async submitKYC(submission: KYCSubmission): Promise<{ success: boolean; submissionId: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/kyc/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(submission),
    });
    return response.json();
  }

  async getAMLCheck(): Promise<AMLCheck> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/aml/check`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async createAMLCheck(userId: string): Promise<{ checkId: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/aml/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ userId }),
    });
    return response.json();
  }

  async getTravelRule(transactionId: string): Promise<TravelRule | undefined> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/travel-rule?txId=${transactionId}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    const data = await response.json();
    return data.needsTravelRule ? data.travelRule : undefined;
  }

  async submitTravelRule(transactionId: string, rule: TravelRule): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/travel-rule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ transactionId, ...rule }),
    });
    return response.json();
  }

  async getRestrictionStatus(countryCode: string): Promise<{ allowed: boolean; restrictions: string[] }> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/restrictions?country=${countryCode}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getComplianceConfig(): Promise<ComplianceConfig> {
    const response = await fetch(`${this.baseUrl}/api/v1/compliance/config`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }
}

export function validateKYCLevel(
  level: number,
  depositAmount: string,
  withdrawalAmount: string
): { valid: boolean; reason?: string } {
  const limits: Record<number, { deposit: string; withdrawal: string }> = {
    1: { deposit: '1000', withdrawal: '1000' },
    2: { deposit: '10000', withdrawal: '5000' },
    3: { deposit: '100000', withdrawal: '50000' },
    4: { deposit: 'unlimited', withdrawal: 'unlimited' },
  };

  const limit = limits[level];
  if (!limit) return { valid: false, reason: 'Invalid KYC level' };

  const deposit = parseFloat(depositAmount);
  const withdrawal = parseFloat(withdrawalAmount);

  if (limit.deposit !== 'unlimited') {
    if (deposit > parseFloat(limit.deposit)) {
      return { valid: false, reason: `Deposit exceeds KYC level ${level} limit` };
    }
  }

  if (limit.withdrawal !== 'unlimited') {
    if (withdrawal > parseFloat(limit.withdrawal)) {
      return { valid: false, reason: `Withdrawal exceeds KYC level ${level} limit` };
    }
  }

  return { valid: true };
}

export function checkRestrictedCountry(
  countryCode: string,
  restrictedCountries: string[]
): boolean {
  return restrictedCountries.includes(countryCode.toUpperCase());
}