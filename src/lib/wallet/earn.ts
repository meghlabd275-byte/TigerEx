/**
 * DeFi/Earn Module
 * TypeScript implementation for decentralized finance and yield products
 */

export interface PoolInfo {
  id: string;
  tokenA: string;
  tokenB: string;
  poolAddress: string;
  totalSupplyA: string;
  totalSupplyB: string;
  tvl: string;
  apr: string;
  volume24h: string;
}

export interface LiquidityPosition {
  id: string;
  poolId: string;
  amountA: string;
  amountB: string;
  lpShares: string;
  valueUsd: string;
  feesEarnedA: string;
  feesEarnedB: string;
}

export interface DefiAggregatorYield {
  protocol: string;
  token: string;
  yieldPercentage: string;
  minDeposit: string;
  risk: 'low' | 'medium' | 'high';
  lockTime?: number;
}

export interface SwapResult {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  minReceived: string;
  priceImpact: string;
  route: string[];
  txHash: string;
}

export class LiquidityPoolService {
  private apiKey: string;
  private baseUrl: string;
  private routerAddress: string;

  constructor(apiKey: string, routerAddress: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.routerAddress = routerAddress;
    this.baseUrl = baseUrl;
  }

  async getPools(): Promise<PoolInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/pools`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async addLiquidity(
    poolId: string,
    amountADesired: string,
    amountBDesired: string,
    amountAMin: string,
    amountBMin: string
  ): Promise<{ success: boolean; lpTokens: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/add-liquidity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        poolId,
        amountADesired,
        amountBDesired,
        amountAMin,
        amountBMin,
        router: this.routerAddress,
      }),
    });
    return response.json();
  }

  async removeLiquidity(
    lpShares: string,
    amountAMin: string,
    amountBMin: string
  ): Promise<{ success: boolean; amountA: string; amountB: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/remove-liquidity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        lpShares,
        amountAMin,
        amountBMin,
        router: this.routerAddress,
      }),
    });
    return response.json();
  }

  async getPositions(): Promise<LiquidityPosition[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/positions`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<{ toAmount: string; priceImpact: string; route: string[] }> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ fromToken, toToken, amount }),
    });
    return response.json();
  }

  async executeSwap(
    fromToken: string,
    toToken: string,
    amount: string,
    minReceived: string,
    route: string[]
  ): Promise<SwapResult> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        fromToken,
        toToken,
        amount,
        minReceived,
        route,
        router: this.routerAddress,
      }),
    });
    return response.json();
  }
}

export class YieldAggregatorService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apikey;
    this.baseUrl = baseUrl;
  }

  async getYieldOpportunities(
    options?: {
      token?: string;
      minApy?: string;
      maxRisk?: string;
    }
  ): Promise<DefiAggregatorYield[]> {
    const params = new URLSearchParams();
    if (options?.token) params.set('token', options.token);
    if (options?.minApy) params.set('minApy', options.minApy);
    if (options?.maxRisk) params.set('maxRisk', options.maxRisk);

    const response = await fetch(`${this.baseUrl}/api/v1/defi/yields?${params}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async deposit(
    protocol: string,
    token: string,
    amount: string
  ): Promise<{ success: boolean; depositId: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/yield/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ protocol, token, amount }),
    });
    return response.json();
  }

  async withdraw(
    depositId: string,
    percentage: number
  ): Promise<{ success: boolean; withdrawn: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/yield/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ depositId, percentage }),
    });
    return response.json();
  }

  async getDeposits(): Promise<
    Array<{
      id: string;
      protocol: string;
      token: string;
      depositAmount: string;
      currentValue: string;
      apy: string;
      earned: string;
    }>
  > {
    const response = await fetch(`${this.baseUrl}/api/v1/defi/yield/deposits`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }
}

export class LaunchpoolService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getPools(): Promise<
    Array<{
      id: string;
      token: string;
      duration: number;
      totalReward: string;
      participants: number;
      myStake?: string;
      myReward?: string;
      status: 'upcoming' | 'active' | 'ended';
    }>
  > {
    const response = await fetch(`${this.baseUrl}/api/v1/launchpool/pools`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async stake(poolId: string, amount: string): Promise<{ success: boolean; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/launchpool/stake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ poolId, amount }),
    });
    return response.json();
  }

  async unstake(poolId: string): Promise<{ success: boolean; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/launchpool/unstake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ poolId }),
    });
    return response.json();
  }

  async claim(poolId: string): Promise<{ success: boolean; claimed: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/launchpool/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ poolId }),
    });
    return response.json();
  }
}