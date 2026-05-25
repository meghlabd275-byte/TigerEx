/**
 * TIGEREX CONVERT SYSTEM
 * Easy one-click conversion - Production
 */

export interface ConvertQuote {
  id: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  price: number;
  fee: number;
  expireTime: number;
}

export interface ConvertOrder {
  id: string;
  userId: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  price: number;
  fee: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
}

export class ConvertSystem {
  private quotes = new Map();
  private orders = new Map();
  private counter = 0;
  
  private rates: Record<string, number> = {
    BTC: 45000, ETH: 2500, BNB: 300, SOL: 100,
    XRP: 0.55, ADA: 0.45, DOGE: 0.08, DOT: 7.5,
    USDT: 1, USDC: 1, BUSD: 1
  };

  // Get convert quote
  async getQuote(from: string, to: string, amount: number): Promise<ConvertQuote> {
    if (!this.rates[from] || !this.rates[to]) throw new Error('Unsupported token');
    
    const price = this.rates[to] / this.rates[from];
    const toAmount = amount * price;
    const fee = toAmount * 0.001; // 0.1% fee
    
    const quote: ConvertQuote = {
      id: `QUOTE_${++this.counter}`,
      fromToken: from,
      toToken: to,
      fromAmount: amount,
      toAmount: toAmount - fee,
      price,
      fee,
      expireTime: Date.now() + 10000
    };
    
    this.quotes.set(quote.id, quote);
    return quote;
  }

  // Execute conversion
  async convert(userId: string, quoteId: string): Promise<ConvertOrder> {
    const quote = this.quotes.get(quoteId);
    if (!quote || quote.expireTime < Date.now()) throw new Error('Quote expired');
    
    const order: ConvertOrder = {
      id: `CONV_${++this.counter}`,
      userId,
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      price: quote.price,
      fee: quote.fee,
      status: 'completed',
      createdAt: Date.now()
    };
    
    this.orders.set(order.id, order);
    this.quotes.delete(quoteId);
    return order;
  }

  // Preview conversion
  async preview(from: string, to: string, amount: number): Promise<{ toAmount: number; price: number; fee: number; minAmount: number; maxAmount: number }> {
    const price = this.rates[to] / this.rates[from];
    const toAmount = amount * price;
    const fee = toAmount * 0.001;
    
    return {
      toAmount: toAmount - fee,
      price,
      fee,
      minAmount: 10,
      maxAmount: 1000000
    };
  }

  // Get history
  async getHistory(userId: string, limit: number = 100): Promise<ConvertOrder[]> {
    return Array.from(this.orders.values())
      .filter(o => o.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

export default ConvertSystem;