/**
 * TigerEx P2P Trading Platform
 * 
 * P2P (C2C) trading like Bybit, Gate.io, Binance P2P
 * Features: Advertisements, orders, disputes, escrow, merchant program
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

// ============================================================
// TYPES & INTERFACES
// ============================================================

export enum P2POrderSide {
  BUY = 'buy',    // Buyer wants to buy crypto
  SELL = 'sell'   // Seller wants to sell crypto
}

export enum P2POrderStatus {
  PENDING = 'pending',
  WAITING_PAYMENT = 'waiting_payment',
  PAID = 'paid',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  APPEAL = 'appeal',
  DISPUTED = 'disputed'
}

export enum P2POrderType {
  MERCHANT_AD = 'merchant_ad',
  USER_AD = 'user_ad',
  EXPRESS = 'express'
}

export enum PaymentMethodType {
  BANK_TRANSFER = 'bank_transfer',
  CREDIT_CARD = 'credit_card',
  ALIPAY = 'alipay',
  WECHAT_PAY = 'wechat_pay',
  PAYPAL = 'paypal',
  STRIPE = 'stripe',
  WESTERN_UNION = 'western_union',
  CASH_DEPOSIT = 'cash_deposit',
  AMAZON_GIFT_CARD = 'amazon_gift_card',
  SEPA = 'sepa',
  PIX = 'pix',
  UPI = 'upi',
  FPS = 'fps',
  KLARNA = 'klarna'
}

export enum MerchantTier {
  NONE = 'none',
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum'
}

export interface P2PPaymentMethod {
  id: string;
  type: PaymentMethodType;
  name: string;
  bank_name?: string;
  account_number?: string;
  account_name?: string;
  branch_code?: string;
  phone?: string;
  email?: string;
  qr_code?: string;
  instructions?: string;
  verified: boolean;
  verified_at?: Date;
}

export interface P2PAdvert {
  id: string;
  advertiser_id: string;
  side: P2POrderSide;
  cryptcurrency: string;
  fiat_currency: string;
  price_type: 'fixed' | 'float';
  price_offset: number; // Fixed: absolute, Float: percentage above market
  price: number;
  min_amount: number;
  max_amount: number;
  terms?: string;
  payment_methods: string[];
  auto_reply?: string;
  status: 'active' | 'inactive' | 'paused';
  limit_no_appeals: number;
  completed_orders: number;
  auto_cancel_minutes: number;
  created_at: Date;
  updated_at: Date;
}

export interface P2POrder {
  id: string;
  advert_id: string;
  buyer_id: string;
  seller_id: string;
  side: P2POrderSide;
  type: P2POrderType;
  cryptcurrency: string;
  amount_crypto: number;
  fiat_amount: number;
  fiat_currency: string;
  price: number;
  payment_method: string;
  status: P2POrderStatus;
  payment_proof?: string;
  payment_time?: Date;
  completed_at?: Date;
  cancel_reason?: string;
  dispute_reason?: string;
  dispute_status?: 'open' | 'resolved_buyer' | 'resolved_seller';
  created_at: Date;
  updated_at: Date;
}

export interface P2PMerchant {
  id: string;
  user_id: string;
  username: string;
  tier: MerchantTier;
  total_orders: number;
  total_volume: number;
  total_feedback: number;
  positive_feedback: number;
  avg_release_time: number;
  response_time: number;
  registered_at: Date;
  verified: boolean;
  verified_at?: Date;
}

export interface P2PDispute {
  id: string;
  order_id: string;
  complainant_id: string;
  defendant_id: string;
  reason: string;
  description: string;
  evidence: string[];
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolution?: 'buyer_win' | 'seller_win' | 'split';
  resolution_note?: string;
  handled_by?: string;
  created_at: Date;
  resolved_at?: Date;
}

export interface P2PUserStats {
  user_id: string;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  disputed_orders: number;
  total_volume: number;
  avg_price: number;
  member_since: Date;
  first_trade_at?: Date;
}

// ============================================================
// P2P TRADING ENGINE
// ============================================================

export class P2PTradingEngine {
  private logger: Logger;
  private adverts: Map<string, P2PAdvert> = new Map();
  private orders: Map<string, P2POrder> = new Map();
  private merchants: Map<string, P2PMerchant> = new Map();
  private disputes: Map<string, P2PDispute> = new Map();
  private userPayments: Map<string, P2PPaymentMethod[]> = new Map();
  private eventEmitter: EventEmitter;

  // Config
  private readonly FEE_PLATFORM = 0; // Free P2P
  private readonly FEE_MERCHANT = 0;
  private readonly MIN_ORDER_AMOUNT = 1; // $1 minimum
  private readonly MAX_ORDERS_PER_DAY = 50;
  private readonly APPEAL_WINDOW_MINUTES = 15;
  
  constructor() {
    this.logger = new Logger('P2PTrading');
    this.eventEmitter = new EventEmitter();
  }

  // ============================================================
  // ADVERTISEMENTS
  // ============================================================

  /**
   * Create advertisement
   */
  async createAdvert(params: {
    advertiser_id: string;
    side: P2POrderSide;
    crypto: string;
    fiat_currency: string;
    price_type: 'fixed' | 'float';
    price_offset: number;
    min_amount: number;
    max_amount: number;
    terms?: string;
    payment_methods: string[];
    auto_reply?: string;
    auto_cancel_minutes?: number;
  }): Promise<P2PAdvert> {
    // Validate crypto and fiat
    if (!params.crypto || !params.fiat_currency) {
      throw new Error('Invalid crypto or fiat currency');
    }

    if (params.min_amount < this.MIN_ORDER_AMOUNT) {
      throw new Error(`Minimum order amount is $${this.MIN_ORDER_AMOUNT}`);
    }

    if (params.max_amount < params.min_amount) {
      throw new Error('Max amount must be greater than min amount');
    }

    // Calculate price
    const marketPrice = 50000; // Would fetch from oracle
    const finalPrice = params.price_type === 'fixed' 
      ? params.price_offset
      : marketPrice * (1 + params.price_offset / 100);

    const advert: P2PAdvert = {
      id: this.generateId(),
      advertiser_id: params.advertiser_id,
      side: params.side,
      cryptcurrency: params.crypto,
      fiat_currency: params.fiat_currency,
      price_type: params.price_type,
      price_offset: params.price_offset,
      price: finalPrice,
      min_amount: params.min_amount,
      max_amount: params.max_amount,
      terms: params.terms,
      payment_methods: params.payment_methods,
      auto_reply: params.auto_reply,
      status: 'active',
      limit_no_appeals: 3,
      completed_orders: 0,
      auto_cancel_minutes: params.auto_cancel_minutes || 15,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.adverts.set(advert.id, advert);
    this.eventEmitter.emit('advert_created', advert);
    this.logger.info(`P2P advert created: ${advert.id} - ${params.side} ${params.crypto}`);
    return advert;
  }

  /**
   * Update advertisement
   */
  async updateAdvert(params: {
    advert_id: string;
    advertiser_id: string;
    price_offset?: number;
    min_amount?: number;
    max_amount?: number;
    terms?: string;
    payment_methods?: string[];
    status?: 'active' | 'inactive' | 'paused';
  }): Promise<void> {
    const advert = this.adverts.get(params.advert_id);
    if (!advert || advert.advertiser_id !== params.advertiser_id) {
      throw new Error('Advert not found or not authorized');
    }

    if (params.price_offset !== undefined) {
      advert.price_offset = params.price_offset;
      const marketPrice = 50000;
      advert.price = advert.price_type === 'fixed'
        ? params.price_offset
        : marketPrice * (1 + params.price_offset / 100);
    }
    if (params.min_amount !== undefined) advert.min_amount = params.min_amount;
    if (params.max_amount !== undefined) advert.max_amount = params.max_amount;
    if (params.terms !== undefined) advert.terms = params.terms;
    if (params.payment_methods !== undefined) advert.payment_methods = params.payment_methods;
    if (params.status !== undefined) advert.status = params.status;
    advert.updated_at = new Date();

    this.adverts.set(params.advert_id, advert);
    this.eventEmitter.emit('advert_updated', advert);
  }

  /**
   * Delete/Remove advertisement
   */
  async deleteAdvert(params: {
    advert_id: string;
    advertiser_id: string;
  }): Promise<void> {
    const advert = this.adverts.get(params.advert_id);
    if (!advert || advert.advertiser_id !== params.advertiser_id) {
      throw new Error('Not authorized');
    }

    advert.status = 'inactive';
    this.adverts.set(params.advert_id, advert);
    this.eventEmitter.emit('advert_deleted', advert);
  }

  /**
   * Get active advertisements
   */
  async getAdverts(filters?: {
    side?: P2POrderSide;
    crypto?: string;
    fiat_currency?: string;
    payment_method?: string;
    amount?: number;
  }): Promise<P2PAdvert[]> {
    let results = Array.from(this.adverts.values())
      .filter(a => a.status === 'active');

    if (filters?.side) results = results.filter(a => a.side === filters.side);
    if (filters?.crypto) results = results.filter(a => a.cryptcurrency === filters.crypto);
    if (filters?.fiat_currency) results = results.filter(a => a.fiat_currency === filters.fiat_currency);
    if (filters?.payment_method) {
      results = results.filter(a => a.payment_methods.includes(filters.payment_method || ''));
    }
    if (filters?.amount) {
      results = results.filter(a => filters.amount! >= a.min_amount && filters.amount! <= a.max_amount);
    }

    // Sort by price
    results.sort((a, b) => {
      // Sellers want low price, buyers want low price (same formula)
      if (filters?.side === P2POrderSide.BUY) {
        return b.price - a.price; // Higher price first for buyers
      }
      return a.price - b.price; // Lower price first for sellers
    });

    return results;
  }

  // ============================================================
  // ORDERS
  // ============================================================

  /**
   * Create order (initiate P2P trade)
   */
  async createOrder(params: {
    advert_id: string;
    user_id: string;
    amount_crypto: number;
  }): Promise<P2POrder> {
    const advert = this.adverts.get(params.advert_id);
    if (!advert || advert.status !== 'active') {
      throw new Error('Advert not found or inactive');
    }

    if (advert.advertiser_id === params.user_id) {
      throw new Error('Cannot trade with yourself');
    }

    if (params.amount_crypto < advert.min_amount || params.amount_crypto > advert.max_amount) {
      throw new Error(`Amount must be between ${advert.min_amount} and ${advert.max_amount}`);
    }

    const fiatAmount = params.amount_crypto * advert.price;
    const buyerId = advert.side === P2POrderSide.BUY ? advert.advertiser_id : params.user_id;
    const sellerId = advert.side === P2POrderSide.BUY ? params.user_id : advert.advertiser_id;

    const order: P2POrder = {
      id: this.generateId(),
      advert_id: params.advert_id,
      buyer_id: buyerId,
      seller_id: sellerId,
      side: advert.side,
      type: advert.side === P2POrderSide.MERCHANT_AD ? P2POrderType.MERCHANT_AD : P2POrderType.USER_AD,
      cryptcurrency: advert.cryptcurrency,
      amount_crypto: params.amount_crypto,
      fiat_amount: fiatAmount,
      fiat_currency: advert.fiat_currency,
      price: advert.price,
      payment_method: advert.payment_methods[0],
      status: P2POrderStatus.PENDING,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.orders.set(order.id, order);
    this.eventEmitter.emit('order_created', order);
    this.logger.info(`P2P order created: ${order.id} - ${fiatAmount} ${advert.fiat_currency}`);
    return order;
  }

  /**
   * Mark as paid
   */
  async markAsPaid(params: {
    order_id: string;
    payer_id: string;
    payment_proof?: string;
  }): Promise<void> {
    const order = this.orders.get(params.order_id);
    if (!order) {
      throw new Error('Order not found');
    }

    const nextStep = order.side === P2POrderSide.BUY ? 'seller' : 'buyer';
    if (params.payer_id !== ((order.side === P2POrderSide.BUY) ? order.buyer_id : order.seller_id)) {
      throw new Error('Not authorized');
    }

    if (order.status !== P2POrderStatus.WAITING_PAYMENT) {
      throw new Error(`Order must be in waiting_payment status`);
    }

    order.status = P2POrderStatus.PAID;
    order.payment_proof = params.payment_proof;
    order.payment_time = new Date();
    order.updated_at = new Date();
    this.orders.set(params.order_id, order);

    this.eventEmitter.emit('order_paid', order);
  }

  /**
   * Release crypto (seller confirms)
   */
  async releaseCrypto(params: {
    order_id: string;
    releaser_id: string;
  }): Promise<{ tx_hash: string }> {
    const order = this.orders.get(params.order_id);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.seller_id !== params.releaser_id) {
      throw new Error('Only seller can release crypto');
    }

    if (order.status !== P2POrderStatus.PAID) {
      throw new Error('Buyer must mark as paid first');
    }

    order.status = P2POrderStatus.COMPLETED;
    order.completed_at = new Date();
    order.updated_at = new Date();
    this.orders.set(params.order_id, order);

    // Update advert stats
    const advert = this.adverts.get(order.advert_id);
    if (advert) {
      advert.completed_orders++;
      this.adverts.set(order.advert_id, advert);
    }

    this.eventEmitter.emit('order_completed', order);
    this.logger.info(`P2P order completed: ${order.id}`);
    return { tx_hash: this.generateTxHash() };
  }

  /**
   * Cancel order
   */
  async cancelOrder(params: {
    order_id: string;
    user_id: string;
    reason: string;
  }): Promise<void> {
    const order = this.orders.get(params.order_id);
    if (!order) {
      throw new Error('Order not found');
    }

    const canceler = order.side === P2POrderSide.BUY ? order.buyer_id : order.seller_id;
    if (params.user_id !== canceler) {
      throw new Error('Not authorized to cancel');
    }

    if (order.status !== P2POrderStatus.PENDING && order.status !== P2POrderStatus.WAITING_PAYMENT) {
      throw new Error('Cannot cancel in current status');
    }

    order.status = P2POrderStatus.CANCELLED;
    order.cancel_reason = params.reason;
    order.updated_at = new Date();
    this.orders.set(params.order_id, order);

    this.eventEmitter.emit('order_cancelled', order);
  }

  /**
   * Dispute order
   */
  async disputeOrder(params: {
    order_id: string;
    disputer_id: string;
    reason: string;
    description: string;
  }): Promise<P2PDispute> {
    const order = this.orders.get(params.order_id);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== P2POrderStatus.PAID) {
      throw new Error('Can only dispute after payment marked');
    }

    const otherParty = params.disputer_id === order.buyer_id ? order.seller_id : order.buyer_id;
    
    const dispute: P2PDispute = {
      id: this.generateId(),
      order_id: params.order_id,
      complainant_id: params.disputer_id,
      defendant_id: otherParty,
      reason: params.reason,
      description: params.description,
      evidence: [],
      status: 'open',
      created_at: new Date()
    };

    this.disputes.set(dispute.id, dispute);
    order.status = P2POrderStatus.DISPUTED;
    order.updated_at = new Date();
    this.orders.set(params.order_id, order);

    this.eventEmitter.emit('disputeOpened', dispute);
    this.logger.info(`P2P dispute opened: ${dispute.id} for order ${params.order_id}`);
    return dispute;
  }

  /**
   * Resolve dispute (admin)
   */
  async resolveDispute(params: {
    dispute_id: string;
    resolver_id: string;
    resolution: 'buyer_win' | 'seller_win' | 'split';
    note: string;
  }): Promise<void> {
    const dispute = this.disputes.get(params.dispute_id);
    if (!dispute) {
      throw new Error('Dispute not found');
    }

    dispute.status = 'resolved';
    dispute.resolution = params.resolution;
    dispute.resolution_note = params.note;
    dispute.handled_by = params.resolver_id;
    dispute.resolved_at = new Date();
    this.disputes.set(params.dispute_id, dispute);

    // Update order based on resolution
    const order = this.orders.get(dispute.order_id);
    if (order) {
      if (params.resolution === 'buyer_win') {
        order.status = P2POrderStatus.COMPLETED;
        order.dispute_status = 'resolved_buyer';
      } else {
        order.status = P2POrderStatus.CANCELLED;
        order.dispute_status = 'resolved_seller';
      }
      order.updated_at = new Date();
      this.orders.set(order.id, order);
    }

    this.eventEmitter.emit('disputeResolved', dispute);
  }

  // ============================================================
  // PAYMENT METHODS
  // ============================================================

  /**
   * Add payment method
   */
  async addPaymentMethod(params: {
    user_id: string;
    type: PaymentMethodType;
    name: string;
    details: {
      bank_name?: string;
      account_number?: string;
      account_name?: string;
      branch_code?: string;
      phone?: string;
      email?: string;
    };
    instructions?: string;
  }): Promise<P2PPaymentMethod> {
    const method: P2PPaymentMethod = {
      id: this.generateId(),
      type: params.type,
      name: params.name,
      bank_name: params.details.bank_name,
      account_number: params.details.account_number,
      account_name: params.details.account_name,
      branch_code: params.details.branch_code,
      phone: params.details.phone,
      email: params.details.email,
      instructions: params.instructions,
      verified: false
    };

    const key = `user_${params.user_id}`;
    const existing = this.userPayments.get(key) || [];
    existing.push(method);
    this.userPayments.set(key, existing);

    return method;
  }

  /**
   * Get user payment methods
   */
  async getPaymentMethods(userId: string): Promise<P2PPaymentMethod[]> {
    return this.userPayments.get(`user_${userId}`) || [];
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(params: {
    user_id: string;
    method_id: string;
  }): Promise<void> {
    const key = `user_${params.user_id}`;
    const methods = this.userPayments.get(key) || [];
    const filtered = methods.filter(m => m.id !== params.method_id);
    this.userPayments.set(key, filtered);
  }

  // ============================================================
  // MERCHANTS
  // ============================================================

  /**
   * Become a merchant
   */
  async registerAsMerchant(params: {
    user_id: string;
    username: string;
  }): Promise<P2PMerchant> {
    const merchant: P2PMerchant = {
      id: this.generateId(),
      user_id: params.user_id,
      username: params.username,
      tier: MerchantTier.BRONZE,
      total_orders: 0,
      total_volume: 0,
      total_feedback: 0,
      positive_feedback: 100,
      avg_release_time: 300, // seconds
      response_time: 60,
      registered_at: new Date(),
      verified: false
    };

    this.merchants.set(merchant.id, merchant);
    this.eventEmitter.emit('merchant_registered', merchant);
    this.logger.info(`Merchant registered: ${merchant.username}`);
    return merchant;
  }

  /**
   * Update merchant tier based on volume
   */
  async updateMerchantTier(merchantId: string): Promise<void> {
    const merchant = this.merchants.get(merchantId);
    if (!merchant) return;

    // Update tier based on volume
    if (merchant.total_volume > 10000000) {
      merchant.tier = MerchantTier.PLATINUM;
    } else if (merchant.total_volume > 1000000) {
      merchant.tier = MerchantTier.GOLD;
    } else if (merchant.total_volume > 100000) {
      merchant.tier = MerchantTier.SILVER;
    } else {
      merchant.tier = MerchantTier.BRONZE;
    }

    this.merchants.set(merchantId, merchant);
  }

  // ============================================================
  // QUERIES
  // ============================================================

  async getOrder(orderId: string): Promise<P2POrder | null> {
    return this.orders.get(orderId) || null;
  }

  async getUserOrders(userId: string, filters?: {
    status?: P2POrderStatus;
    limit?: number;
  }): Promise<P2POrder[]> {
    let results = Array.from(this.orders.values())
      .filter(o => o.buyer_id === userId || o.seller_id === userId);

    if (filters?.status) {
      results = results.filter(o => o.status === filters.status);
    }

    return results.slice(0, filters?.limit || 50);
  }

  async getActiveOrdersByAdvert(advertId: string): Promise<P2POrder[]> {
    return Array.from(this.orders.values())
      .filter(o => o.advert_id === advertId && 
        (o.status === P2POrderStatus.PENDING || 
         o.status === P2POrderStatus.WAITING_PAYMENT ||
         o.status === P2POrderStatus.PAID));
  }

  async getMerchant(merchantId: string): Promise<P2PMerchant | null> {
    return this.merchants.get(merchantId) || null;
  }

  async getMerchantByUser(userId: string): Promise<P2PMerchant | undefined> {
    return Array.from(this.merchants.values())
      .find(m => m.user_id === userId);
  }

  async getAdvert(advertId: string): Promise<P2PAdvert | null> {
    return this.adverts.get(advertId) || null;
  }

  // Stats
  async getUserStats(userId: string): Promise<P2PUserStats> {
    const userOrders = Array.from(this.orders.values())
      .filter(o => o.buyer_id === userId || o.seller_id === userId);

    const completed = userOrders.filter(o => o.status === P2POrderStatus.COMPLETED);
    const cancelled = userOrders.filter(o => o.status === P2POrderStatus.CANCELLED);

    return {
      user_id: userId,
      total_orders: userOrders.length,
      completed_orders: completed.length,
      cancelled_orders: cancelled.length,
      disputed_orders: 0,
      total_volume: completed.reduce((sum, o) => sum + o.fiat_amount, 0),
      avg_price: completed.length > 0 
        ? completed.reduce((sum, o) => sum + o.fiat_amount, 0) / completed.length 
        : 0,
      member_since: new Date(),
      first_trade_at: completed[completed.length - 1]?.completed_at
    };
  }

  async getPlatformStats(): Promise<{
    total_orders: number;
    total_volume: number;
    active_adverts: number;
    active_merchants: number;
  }> {
    const activeAdverts = Array.from(this.adverts.values())
      .filter(a => a.status === 'active');
    const activeMerchants = Array.from(this.merchants.values())
      .filter(m => m.verified);

    return {
      total_orders: this.orders.size,
      total_volume: Array.from(this.orders.values())
        .filter(o => o.status === P2POrderStatus.COMPLETED)
        .reduce((sum, o) => sum + o.fiat_amount, 0),
      active_adverts: activeAdverts.length,
      active_merchants: activeMerchants.length
    };
  }

  // Helper
  private generateId(): string {
    return `p2p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTxHash(): string {
    return `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  }
}

export default P2PTradingEngine;