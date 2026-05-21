/**
 * Demo Trading Platform
 * 
 * Paper trading with virtual funds
 */

export class DemoTradingPlatform {
  private accounts: Map<string, DemoAccount> = new Map();
  
  // Create demo account
  async createDemoAccount(userId: string): Promise<DemoAccount> {
    const account: DemoAccount = {
      id: `DEMO-${Date.now()}`,
      userId,
      balances: new Map([
        ['USDT', 10000],
        ['BTC', 0.5],
        ['ETH', 2]
      ]),
      createdAt: new Date(),
      isActive: true
    };
    this.accounts.set(account.id, account);
    return account;
  }
  
  // Get balance
  async getBalance(demoId: string): Promise<Map<string, number>> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');
    return account.balances;
  }
  
  // Execute demo trade
  async executeTrade(demoId: string, trade: TradeInput): Promise<DemoTrade> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');
    
    const executed: DemoTrade = {
      id: `TRADE-${Date.now()}`,
      symbol: trade.symbol,
      side: trade.side,
      price: 50000, // Mock price
      quantity: trade.quantity,
      value: trade.quantity * 50000,
      fee: 0,
      executedAt: new Date()
    };
    
    // Update balances
    const balance = account.balances.get(trade.symbol) || 0;
    if (trade.side === 'buy') {
      account.balances.set(trade.symbol, balance + trade.quantity);
    } else {
      account.balances.set(trade.symbol, balance - trade.quantity);
    }
    
    return executed;
  }
  
  // Reset demo account
  async reset(demoId: string): Promise<void> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');
    
    account.balances = new Map([
      ['USDT', 10000],
      ['BTC', 0.5],
      ['ETH', 2]
    ]);
  }
}

interface DemoAccount {
  id: string;
  userId: string;
  balances: Map<string, number>;
  createdAt: Date;
  isActive: boolean;
}

interface TradeInput {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
}

interface DemoTrade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  value: number;
  fee: number;
  executedAt: Date;
}