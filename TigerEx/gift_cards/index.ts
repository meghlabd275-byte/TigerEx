/**
 * TigerEx Gift Cards Platform
 * 
 * Digital gift cards like Crypto.com, TigerEx
 * Features: Create, customize, redeem, bulk orders
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

export enum GiftCardStatus {
  ACTIVE = 'active',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled'
}

export interface GiftCardInput {
  sender: string;
  receiver: string;
  asset: string;
  amount: number;
  message?: string;
  design?: string;
  expiry_days?: number;
}

export interface GiftCard {
  id: string;
  code: string;
  sender: string;
  receiver: string;
  asset: string;
  amount: number;
  status: GiftCardStatus;
  balance: number;
  message?: string;
  design: string;
  created_at: Date;
  expires_at?: Date;
  redeemed_at?: Date;
}

export class GiftCardsPlatform {
  private logger: Logger;
  private cards: Map<string, GiftCard> = new Map();
  private eventEmitter: EventEmitter;

  constructor() {
    this.logger = new Logger('GiftCards');
    this.eventEmitter = new EventEmitter();
  }

  async create(params: GiftCardInput): Promise<GiftCard> {
    const card: GiftCard = {
      id: `gift_${Date.now()}`,
      code: this.generateCode(),
      sender: params.sender,
      receiver: params.receiver,
      asset: params.asset,
      amount: params.amount,
      status: GiftCardStatus.ACTIVE,
      balance: params.amount,
      message: params.message,
      design: params.design || 'default',
      created_at: new Date(),
      expires_at: params.expiry_days ? new Date(Date.now() + params.expiry_days * 86400000) : undefined
    };
    this.cards.set(card.id, card);
    this.eventEmitter.emit('card_created', card);
    return card;
  }

  async createBulk(params: { sender: string; receiver: string; asset: string; amount: number; quantity: number; message?: string }): Promise<GiftCard[]> {
    const cards: GiftCard[] = [];
    for (let i = 0; i < params.quantity; i++) {
      const card = await this.create({ ...params, amount: params.amount });
      cards.push(card);
    }
    return cards;
  }

  async redeem(code: string, redeemer: string): Promise<{ success: boolean; amount: number }> {
    const card = Array.from(this.cards.values()).find(c => c.code === code);
    if (!card) throw new Error('Invalid code');
    if (card.status !== GiftCardStatus.ACTIVE) throw new Error('Card not active');
    if (card.expires_at && card.expires_at < new Date()) throw new Error('Card expired');
    
    const amount = card.balance;
    card.status = GiftCardStatus.REDEEMED;
    card.balance = 0;
    card.redeemed_at = new Date();
    this.cards.set(card.id, card);
    
    this.eventEmitter.emit('card_redeemed', card);
    return { success: true, amount };
  }

  async checkBalance(code: string): Promise<{ balance: number; status: string }> {
    const card = Array.from(this.cards.values()).find(c => c.code === code);
    if (!card) throw new Error('Invalid code');
    return { balance: card.balance, status: card.status };
  }

  async getCards(userId: string): Promise<GiftCard[]> {
    return Array.from(this.cards.values()).filter(c => c.sender === userId || c.receiver === userId);
  }

  private generateCode(): string {
    return `TIGER-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
  }
}

export default GiftCardsPlatform;