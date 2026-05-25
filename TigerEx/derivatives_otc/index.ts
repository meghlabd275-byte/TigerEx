/**
 * TigerEx Derivatives OTC & Structured Products
 * 
 * Over-the-counter derivatives, structured notes,
 * exotic options, structured payments
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export enum ProductType {
  PRINCIPAL_protected = 'principal_protected',
  BOOST = 'boost',
  DUAL_CURRENCY = 'dual_currency',
  AUTOCALL = 'autocall',
  KNOCK_OUT = 'knock_out',
  BONUS = 'bonus',
  TRACKER = 'tracker'
}

export enum UnderlyingAsset {
  BTC = 'BTC',
  ETH = 'ETH',
  SOL = 'SOL',
  AAPL = 'AAPL',
  SPX = 'SPX',
  NDX = 'NDX',
  GOLD = 'XAU',
  EUR_USD = 'EUR/USD'
}

export enum ProductStatus {
  STRUCTURING = 'structuring',
  SUBSCRIBING = 'subscribing',
  LIVE = 'live',
  SETTLED = 'settled',
  KNOCKED_OUT = 'knocked_out'
}

export interface StructuredProduct {
  id: string;
  name: string;
  productType: ProductType;
  underlying: UnderlyingAsset | string;
  strikePrice: number;
  barrierLevel: number;
  
  terms: {
    denomination: string;
    minSubscription: number;
    maxSubscription: number;
    issueDate: number;
    maturityDate: number;
    tenureDays: number;
  };
  
  payoff: {
    participation: number;
    cap: number;
    floor: number;
    barrierType: ' knock_in' | 'knock_out' | 'performance';
    barrierDirection: 'above' | 'below';
  };
  
  risk: {
    riskLevel: 'low' | 'medium' | 'high';
    capitalProtection: number;
    worstCase: number;
    bestCase: number;
  };
  
  fees: {
    structuring: number;
    management: number;
    performance: number;
  };
  
  status: ProductStatus;
  createdAt: number;
}

export interface Subscription {
  id: string;
  productId: string;
  investorId: string;
  amount: number;
  tokenCount: number;
  subscriptionPrice: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'settled';
}

export interface PayoffCalculation {
  productId: string;
  investorId: string;
  underlyingFinalPrice: number;
  performance: number;
  payoffAmount: number;
  roi: number;
  scenario: 'best' | 'worst' | 'actual';
}

// ============================================================================
// STRUCTURED PRODUCTS ENGINE
// ============================================================================

export class DerivativesOTC {
  private products: Map<string, StructuredProduct> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private counter = 1;

  // Create structured product
  async createProduct(params: {
    name: string;
    productType: ProductType;
    underlying: UnderlyingAsset | string;
    strikePrice: number;
    barrierLevel: number;
    denomination: string;
    minSubscription: number;
    maxSubscription: number;
    issueDate: number;
    tenureDays: number;
    participation: number;
    cap: number;
    floor: number;
  }): Promise<{ productId: string; status: string }> {
    const maturityDate = params.issueDate + params.tenureDays * 86400000;
    
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    let capitalProtection = 100;
    
    if (params.productType === ProductType.PRINCIPAL_protected) {
      capitalProtection = 100;
      riskLevel = 'low';
    } else if (params.productType === ProductType.BOOST) {
      capitalProtection = 90;
      riskLevel = 'medium';
    } else if ([ProductType.KNOCK_OUT, ProductType.AUTOCALL].includes(params.productType)) {
      capitalProtection = 0;
      riskLevel = 'high';
    }
    
    const product: StructuredProduct = {
      id: `prod_${this.counter++}`,
      name: params.name,
      productType: params.productType,
      underlying: params.underlying,
      strikePrice: params.strikePrice,
      barrierLevel: params.barrierLevel,
      terms: {
        denomination: params.denomination,
        minSubscription: params.minSubscription,
        maxSubscription: params.maxSubscription,
        issueDate: params.issueDate,
        maturityDate,
        tenureDays: params.tenureDays
      },
      payoff: {
        participation: params.participation,
        cap: params.cap,
        floor: params.floor,
        barrierType: 'performance',
        barrierDirection: 'above'
      },
      risk: {
        riskLevel,
        capitalProtection,
        worstCase: params.floor,
        bestCase: params.cap || params.participation * 100
      },
      fees: {
        structuring: 0.5,
        management: 0.3,
        performance: 0
      },
      status: ProductStatus.STRUCTURING,
      createdAt: Date.now()
    };
    
    this.products.set(product.id, product);
    return { productId: product.id, status: 'structuring' };
  }

  async getProduct(productId: string): Promise<StructuredProduct | undefined> {
    return this.products.get(productId);
  }

  async getProducts(filter?: { type?: ProductType; status?: ProductStatus }): Promise<StructuredProduct[]> {
    let result = Array.from(this.products.values());
    if (filter?.type) result = result.filter(p => p.productType === filter.type);
    if (filter?.status) result = result.filter(p => p.status === filter.status);
    return result;
  }

  // Launch product for subscription
  async launchProduct(productId: string): Promise<{ launched: boolean }> {
    const product = this.products.get(productId);
    if (!product) return { launched: false };
    product.status = ProductStatus.SUBSCRIBING;
    return { launched: true };
  }

  // Subscribe
  async subscribe(params: {
    productId: string;
    investorId: string;
    amount: number;
  }): Promise<{ subscriptionId: string; tokenCount: number; status: string }> {
    const product = this.products.get(params.productId);
    if (!product) throw new Error('Product not found');
    
    if (params.amount < product.terms.minSubscription || params.amount > product.terms.maxSubscription) {
      throw new Error('Invalid subscription amount');
    }
    
    const tokenCount = Math.floor(params.amount / product.strikePrice);
    const subscription: Subscription = {
      id: `sub_${this.counter++}`,
      productId: params.productId,
      investorId: params.investorId,
      amount: params.amount,
      tokenCount,
      subscriptionPrice: product.strikePrice,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    this.subscriptions.set(subscription.id, subscription);
    return { subscriptionId: subscription.id, tokenCount, status: 'pending' };
  }

  async confirmSubscription(subscriptionId: string): Promise<{ confirmed: boolean }> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return { confirmed: false };
    sub.status = 'confirmed';
    return { confirmed: true };
  }

  // Calculate payoff at maturity
  async calculatePayoff(productId: string, underlyingFinalPrice: number, scenario: 'best' | 'worst' | 'actual'): Promise<PayoffCalculation[]> {
    const product = this.products.get(productId);
    if (!product) throw new Error('Product not found');
    
    const subs = Array.from(this.subscriptions.values()).filter(s => s.productId === productId);
    const calculations: PayoffCalculation[] = [];
    
    const performance = (underlyingFinalPrice - product.strikePrice) / product.strikePrice * 100;
    
    for (const sub of subs) {
      let payoffAmount = 0;
      let actualPerformance = performance;
      
      switch (product.productType) {
        case ProductType.PRINCIPAL_protected:
          payoffAmount = Math.max(sub.amount * (1 + product.payoff.floor / 100), sub.amount * (1 + actualPerformance * product.payoff.participation / 100));
          break;
        case ProductType.BOOST:
          payoffAmount = sub.amount * (1 + Math.min(actualPerformance * product.payoff.participation / 100, product.payoff.cap / 100));
          if (actualPerformance < 0) payoffAmount = sub.amount * (1 + product.payoff.floor / 100);
          break;
        case ProductType.DUAL_CURRENCY:
          if (actualPerformance > 0) {
            payoffAmount = sub.amount * (1 + product.payoff.participation / 100);
          } else {
            payoffAmount = sub.amount;
          }
          break;
        case ProductType.AUTOCALL:
        case ProductType.KNOCK_OUT:
          if (performance >= product.barrierLevel) {
            payoffAmount = sub.amount * (1 + product.payoff.bonus || 10 / 100);
            product.status = ProductStatus.KNOCKED_OUT;
          } else {
            payoffAmount = sub.amount * (1 + actualPerformance * product.payoff.participation / 100);
          }
          break;
        default:
          payoffAmount = sub.amount * (1 + actualPerformance * product.payoff.participation / 100);
      }
      
      payoffAmount = Math.min(payoffAmount, sub.amount * (1 + product.payoff.cap / 100));
      
      calculations.push({
        productId,
        investorId: sub.investorId,
        underlyingFinalPrice,
        performance: actualPerformance,
        payoffAmount,
        roi: ((payoffAmount - sub.amount) / sub.amount) * 100,
        scenario
      });
    }
    
    return calculations;
  }

  // Settle at maturity
  async settleProduct(productId: string, underlyingFinalPrice: number): Promise<{ settled: boolean; totalPaid: number }> {
    const product = this.products.get(productId);
    if (!product) return { settled: false, totalPaid: 0 };
    
    const payoffs = await this.calculatePayoff(productId, underlyingFinalPrice, 'actual');
    const totalPaid = payoffs.reduce((sum, p) => sum + p.payoffAmount, 0);
    
    product.status = ProductStatus.SETTLED;
    
    return { settled: true, totalPaid };
  }

  // Historical products
  async getSettledProducts(limit: number): Promise<StructuredProduct[]> {
    return Array.from(this.products.values())
      .filter(p => p.status === ProductStatus.SETTLED)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // Performance analytics
  async getProductPerformance(productId: string): Promise<{
    totalSubscribed: number;
    investorCount: number;
    avgInvestment: number;
    projectedRoi: number;
  }> {
    const product = this.products.get(productId);
    if (!product) return { totalSubscribed: 0, investorCount: 0, avgInvestment: 0, projectedRoi: 0 };
    
    const subs = Array.from(this.subscriptions.values()).filter(s => s.productId === productId);
    
    return {
      totalSubscribed: subs.reduce((sum, s) => sum + s.amount, 0),
      investorCount: subs.length,
      avgInvestment: subs.reduce((sum, s) => sum + s.amount, 0) / subs.length,
      projectedRoi: product.payoff.participation
    };
  }
}

export const derivativesOTC = new DerivativesOTC();

export default DerivativesOTC;
export { ProductType, UnderlyingAsset, ProductStatus, StructuredProduct, Subscription, PayoffCalculation };