/**
 * TIGEREX CARD PLATFORM
 * Production - Crypto payment card
 */

export interface Card {
  id: string;
  userId: string;
  type: 'virtual' | 'physical';
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  last4: string;
  status: 'active' | 'frozen' | 'blocked';
  balance: number;
  createdAt: number;
}

export interface Transaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  merchant: string;
  category: string;
  status: 'pending' | 'completed';
  timestamp: number;
}

export class TigerExCardPlatform {
  private cards = new Map();
  private transactions = new Map();
  private counter = 0;

  async orderCard(userId: string, tier: 'bronze' | 'silver' | 'gold' | 'platinum' = 'bronze'): Promise<Card> {
    const card: Card = {
      id: `CARD_${++this.counter}`,
      userId,
      type: 'virtual',
      tier,
      last4: String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
      status: 'active',
      balance: 0,
      createdAt: Date.now()
    };
    this.cards.set(card.id, card);
    return card;
  }

  async getBalance(cardId: string): Promise<number> {
    return this.cards.get(cardId)?.balance || 0;
  }

  async freeze(cardId: string): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (card) { card.status = 'frozen'; return true; }
    return false;
  }

  async unfreeze(cardId: string): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (card) { card.status = 'active'; return true; }
    return false;
  }

  async topUp(cardId: string, amount: number): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (card) { card.balance += amount; return true; }
    return false;
  }

  async getTransactions(cardId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values())
      .filter(t => t.cardId === cardId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getCashbackRate(tier: string): number {
    const rates: Record<string, number> = { bronze: 0.01, silver: 0.02, gold: 0.03, platinum: 0.05 };
    return rates[tier] || 0.01;
  }
}

export default TigerExCardPlatform;