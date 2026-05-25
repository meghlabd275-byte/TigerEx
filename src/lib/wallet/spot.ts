/**
 * Wallet Module
 * TypeScript implementation for wallet and deposit/withdrawal functionalities
 */

export interface Wallet {
  id: string;
  currency: string;
  chain: string;
  balance: string;
  locked: string;
  available: string;
  depositAddress?: string;
  depositMemo?: string;
  canDeposit: boolean;
  canWithdraw: boolean;
}

export interface Transaction {
  id: string;
  currency: string;
  amount: string;
  fee: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  address?: string;
  confirmations?: number;
  blockNumber?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SavingsProduct {
  id: string;
  currency: string;
  chain: string;
  productType: 'flexible' | 'fixed';
  minDeposit: string;
  maxDeposit?: string;
  interestRate: string;
  lockPeriod?: number;
  interestInterval: number;
}

export interface SavingsPosition {
  id: string;
  productId: string;
  currency: string;
  amount: string;
  interestEarned: string;
  purchaseTime: number;
  redemptionTime?: number;
  canRedeemEarly: boolean;
}

export interface StakingProduct {
  id: string;
  currency: string;
  chain: string;
  validator: string;
  minStake: string;
  rewardApy: string;
  lockPeriod: number;
  unbindPeriod: number;
}

export interface StakingPosition {
  id: string;
  productId: string;
  currency: string;
  amount: string;
  rewards: string;
  lockedUntil: number;
  status: 'active' | 'unbonding' | 'claimed';
}

export class WalletService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getWallets(): Promise<Wallet[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/wallets`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getSpotBalances(): Promise<Map<string, { free: string; locked: string }>> {
    const response = await fetch(`${this.baseUrl}/api/v1/balance`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    const data = await response.json();
    return new Map(Object.entries(data));
  }

  async getDepositAddress(currency: string, chain?: string): Promise<{ address: string; memo?: string }> {
    const url = chain
      ? `${this.baseUrl}/api/v1/wallets/deposit-address?currency=${currency}&chain=${chain}`
      : `${this.baseUrl}/api/v1/wallets/deposit-address?currency=${currency}`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async requestWithdrawal(
    currency: string,
    amount: string,
    address: string,
    chain?: string,
    options?: {
      memo?: string;
      networkFee?: string;
      clientId?: string;
    }
  ): Promise<{ success: boolean; withdrawalId: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/wallets/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ currency, amount, address, chain, ...options }),
    });
    return response.json();
  }

  async getTransactions(
    options?: {
      currency?: string;
      type?: string;
      status?: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
    }
  ): Promise<Transaction[]> {
    const params = new URLSearchParams();
    if (options?.currency) params.set('currency', options.currency);
    if (options?.type) params.set('type', options.type);
    if (options?.status) params.set('status', options.status);
    if (options?.startTime) params.set('startTime', options.startTime.toString());
    if (options?.endTime) params.set('endTime', options.endTime.toString());
    if (options?.limit) params.set('limit', options.limit.toString());

    const response = await fetch(`${this.baseUrl}/api/v1/transactions?${params}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getTransaction(txId: string): Promise<Transaction> {
    const response = await fetch(`${this.baseUrl}/api/v1/transactions/${txId}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }
}

export class SavingsService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getProducts(currency?: string): Promise<SavingsProduct[]> {
    const url = currency
      ? `${this.baseUrl}/api/v1/savings/products?currency=${currency}`
      : `${this.baseUrl}/api/v1/savings/products`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async purchase(productId: string, amount: string): Promise<{ success: boolean; positionId: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/savings/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ productId, amount }),
    });
    return response.json();
  }

  async redeem(positionId: string, amount?: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/v1/savings/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ positionId, amount }),
    });
    return response.json();
  }

  async getPositions(): Promise<SavingsPosition[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/savings/positions`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getHistoricalInterest(options?: { startTime?: number; endTime?: number }): Promise<{ date: string; amount: string }[]> {
    const params = new URLSearchParams();
    if (options?.startTime) params.set('startTime', options.startTime.toString());
    if (options?.endTime) params.set('endTime', options.endTime.toString());

    const response = await fetch(`${this.baseUrl}/api/v1/savings/interest-history?${params}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }
}

export class StakingService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getProducts(currency?: string): Promise<StakingProduct[]> {
    const url = currency
      ? `${this.baseUrl}/api/v1/staking/products?currency=${currency}`
      : `${this.baseUrl}/api/v1/staking/products`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async stake(productId: string, amount: string): Promise<{ success: boolean; positionId: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/staking/stake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ productId, amount }),
    });
    return response.json();
  }

  async unstake(positionId: string, amount?: string): Promise<{ success: boolean; undelegationTime: number }> {
    const response = await fetch(`${this.baseUrl}/api/v1/staking/unstake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ positionId, amount }),
    });
    return response.json();
  }

  async claimRewards(positionId: string): Promise<{ success: boolean; claimedAmount: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/staking/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ positionId }),
    });
    return response.json();
  }

  async getPositions(): Promise<StakingPosition[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/staking/positions`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }
}