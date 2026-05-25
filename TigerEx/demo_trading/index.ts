/**
 * DEMO TRADING PLATFORM
 * Production - Paper trading with virtual funds
 */

export interface DemoAccount {
  id: string;
  userId: string;
  balances: Map<string, number>;
  createdAt: number;
  isActive: boolean;
  pnl: number;
  trades: number;
}

export interface TradeInput {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
}

export interface DemoTrade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  value: number;
  fee: number;
  executedAt: number;
}

export class DemoTradingPlatform {
  private accounts: Map<string, DemoAccount> = new Map();
  private trades: Map<string, DemoTrade> = new Map();
  private counter = 0;

  async createDemoAccount(userId: string): Promise<DemoAccount> {
    const account: DemoAccount = {
      id: `DEMO_${++this.counter}`,
      userId,
      balances: new Map([
        ['USDT', 10000],
        ['BTC', 0.5],
        ['ETH', 2]
      ]),
      createdAt: Date.now(),
      isActive: true,
      pnl: 0,
      trades: 0
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async getBalance(demoId: string): Promise<Map<string, number>> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');
    return account.balances;
  }

  async executeTrade(demoId: string, trade: TradeInput): Promise<DemoTrade> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');

    const price = 50000;
    const executed: DemoTrade = {
      id: `TRADE_${++this.counter}`,
      symbol: trade.symbol,
      side: trade.side,
      price,
      quantity: trade.quantity,
      value: trade.quantity * price,
      fee: 0,
      executedAt: Date.now()
    };

    this.trades.set(executed.id, executed);

    const balance = account.balances.get(trade.symbol) || 0;
    if (trade.side === 'buy') {
      account.balances.set(trade.symbol, balance + trade.quantity);
    } else {
      account.balances.set(trade.symbol, balance - trade.quantity);
    }

    account.trades++;
    return executed;
  }

  async getTradeHistory(demoId: string): Promise<DemoTrade[]> {
    return Array.from(this.trades.values()).slice(-100);
  }

  async reset(demoId: string): Promise<void> {
    const account = this.accounts.get(demoId);
    if (!account) throw new Error('Demo account not found');
    account.balances = new Map([['USDT', 10000], ['BTC', 0.5], ['ETH', 2]]);
    account.pnl = 0;
    account.trades = 0;
  }
}

export default DemoTradingPlatform;