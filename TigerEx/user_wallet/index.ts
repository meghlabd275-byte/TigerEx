/**
 * TigerEx User Wallet
 * Complete wallet operations for users
 */

export interface DepositAddress {
  coin: string;
  chain: string;
  address: string;
  tag?: string;
  memo?: string;
}

export interface DepositRecord {
  id: string;
  coin: string;
  amount: number;
  fromAddress: string;
  toAddress: string;
  txHash: string;
  status: string;
  confirmations: number;
  time: number;
}

export interface WithdrawalRecord {
  id: string;
  coin: string;
  amount: number;
  fee: number;
  toAddress: string;
  txHash?: string;
  status: string;
  time: number;
}

export interface TransferRecord {
  id: string;
  coin: string;
  amount: number;
  fromUser: string;
  toUser: string;
  type: string;
  status: string;
  time: number;
}

export interface WalletBalance {
  coin: string;
  free: number;
  locked: number;
  total: number;
}

export class UserWallet {
  private balances: Map<string, WalletBalance> = new Map();
  private depositAddresses: Map<string, DepositAddress> = new Map();
  private deposits: Map<string, DepositRecord> = new Map();
  private withdrawals: Map<string, WithdrawalRecord> = new Map();
  private transfers: Map<string, TransferRecord> = new Map();

  constructor() {
    // Initialize with default balances
    this.balances.set('USDT', { coin: 'USDT', free: 10000, locked: 0, total: 10000 });
    this.balances.set('BTC', { coin: 'BTC', free: 1.5, locked: 0, total: 1.5 });
    this.balances.set('ETH', { coin: 'ETH', free: 10, locked: 0, total: 10 });
  }

  // Get deposit addresses
  async getDepositAddress(coin: string, chain: string = 'MAINNET'): Promise<DepositAddress> {
    const existing = `${coin}_${chain}`;
    if (this.depositAddresses.has(existing)) {
      return this.depositAddresses.get(existing)!;
    }

    const address: DepositAddress = {
      coin,
      chain,
      address: `${coin.toLowerCase()}_${Math.random().toString(36).substring(2, 15)}_address`,
      tag: Math.random() > 0.5 ? Math.random().toString().substring(2, 10) : undefined,
    };
    this.depositAddresses.set(existing, address);
    return address;
  }

  // Get all deposit addresses
  async getDepositAddresses(): Promise<DepositAddress[]> {
    return Array.from(this.depositAddresses.values());
  }

  // Get deposit history
  async getDepositHistory(coin?: string, status?: string, limit: number = 100): Promise<DepositRecord[]> {
    const records = Array.from(this.deposits.values());
    if (coin) return records.filter(r => r.coin === coin).slice(0, limit);
    return records.slice(0, limit);
  }

  // Request withdrawal
  async requestWithdrawal(
    coin: string,
    amount: number,
    address: string,
    network?: string
  ): Promise<{ id: string; success: boolean; message: string }> {
    const balance = this.balances.get(coin);
    if (!balance || balance.free < amount) {
      return { id: '', success: false, message: 'Insufficient balance' };
    }

    const record: WithdrawalRecord = {
      id: `wd_${Date.now()}`,
      coin,
      amount,
      fee: amount * 0.001,
      toAddress: address,
      status: 'pending',
      time: Date.now(),
    };

    this.withdrawals.set(record.id, record);
    balance.free -= amount;
    this.balances.set(coin, balance);

    return { id: record.id, success: true, message: 'Withdrawal submitted' };
  }

  // Get withdrawal history
  async getWithdrawalHistory(coin?: string, limit: number = 100): Promise<WithdrawalRecord[]> {
    const records = Array.from(this.withdrawals.values());
    if (coin) return records.filter(r => r.coin === coin).slice(0, limit);
    return records.slice(0, limit);
  }

  // Transfer to another user
  async transferToUser(
    coin: string,
    amount: number,
    toUserId: string,
    type: string = 'INTERNAL'
  ): Promise<{ id: string; success: boolean; message: string }> {
    const balance = this.balances.get(coin);
    if (!balance || balance.free < amount) {
      return { id: '', success: false, message: 'Insufficient balance' };
    }

    const record: TransferRecord = {
      id: `tf_${Date.now()}`,
      coin,
      amount,
      fromUser: 'current_user',
      toUser: toUserId,
      type,
      status: 'completed',
      time: Date.now(),
    };

    this.transfers.set(record.id, record);
    balance.free -= amount;
    this.balances.set(coin, balance);

    return { id: record.id, success: true, message: 'Transfer completed' };
  }

  // Get transfer history
  async getTransferHistory(limit: number = 100): Promise<TransferRecord[]> {
    return Array.from(this.transfers.values()).slice(0, limit);
  }

  // Get all balances
  async getBalances(): Promise<WalletBalance[]> {
    return Array.from(this.balances.values());
  }

  // Convert currency
  async convertCurrency(from: string, to: string, amount: number): Promise<{ result: number; rate: number }> {
    const rates: Record<string, number> = { BTC: 50000, ETH: 3000, USDT: 1 };
    const rate = rates[from] / rates[to];
    return { result: amount * rate, rate };
  }

  // Get mini tokens distribution (red packet)
  async getMiniTokens(): Promise<{ balance: number; pending: number }> {
    return { balance: 0, pending: 0 };
  }

  // Get all chains for a coin
  async getChainList(coin: string): Promise<string[]> {
    return ['MAINNET', 'BSC', 'Polygon', 'Arbitrum', 'Optimism'];
  }

  // Estimate withdrawal fee
  async estimateWithdrawalFee(coin: string, network: string): Promise<number> {
    const fees: Record<string, number> = { BTC: 0.0001, ETH: 0.001, USDT: 1 };
    return fees[coin] || 0;
  }
}

export default UserWallet;