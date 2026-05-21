/**
 * TigerEx Wallet System
 * 
 * Real wallet implementation with deposits, withdrawals, and transfers
 */

export enum WalletType {
  SPOT = 'spot',
  MARGIN = 'margin',
  FUTURES = 'futures',
  EARN = 'earn',
  FEE = 'fee',
  COLLATERAL = 'collateral'
}

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
  TRADE = 'trade',
  FEE = 'fee',
  REWARD = 'reward',
  STAKING = 'staking',
  EARN = 'earn',
  REFERRAL = 'referral'
}

export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface Wallet {
  id: string;
  userId: string;
  type: WalletType;
  asset: string;
  balance: number;
  lockedBalance: number;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  type: TransactionType;
  asset: string;
  amount: number;
  fee: number;
  status: TransactionStatus;
  txHash?: string;
  address?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface WithdrawalRequest {
  userId: string;
  asset: string;
  amount: number;
  address: string;
  network: string;
  fee: number;
}

export interface DepositAddress {
  asset: string;
  address: string;
  network: string;
  memo?: string;
  qrCode: string;
}

export class WalletSystem {
  private wallets: Map<string, Wallet> = new Map();
  private transactions: Map<string, Transaction> = new Map();
  private walletIdCounter: number = 0;
  private txIdCounter: number = 0;

  // Initialize user wallets
  async initializeWallets(userId: string, assets: string[]): Promise<Wallet[]> {
    const wallets: Wallet[] = [];
    
    // Create spot wallets for each asset
    for (const asset of assets) {
      const wallet = await this.createWallet(userId, WalletType.SPOT, asset);
      wallets.push(wallet);
    }
    
    // Create special wallets
    wallets.push(await this.createWallet(userId, WalletType.MARGIN, 'USDT'));
    wallets.push(await this.createWallet(userId, WalletType.FUTURES, 'USDT'));
    wallets.push(await this.createWallet(userId, WalletType.EARN, 'USDT'));
    wallets.push(await this.createWallet(userId, WalletType.FEE, 'USDT'));
    
    return wallets;
  }

  // Create wallet
  private async createWallet(userId: string, type: WalletType, asset: string): Promise<Wallet> {
    const wallet: Wallet = {
      id: `WAL-${++this.walletIdCounter}`,
      userId,
      type,
      asset,
      balance: 0,
      lockedBalance: 0,
      updatedAt: new Date()
    };
    
    const key = `${userId}_${type}_${asset}`;
    this.wallets.set(key, wallet);
    return wallet;
  }

  // Get wallet
  getWallet(userId: string, type: WalletType, asset: string): Wallet | undefined {
    const key = `${userId}_${type}_${asset}`;
    return this.wallets.get(key);
  }

  // Get all user wallets
  getUserWallets(userId: string): Wallet[] {
    return Array.from(this.wallets.values())
      .filter(w => w.userId === userId);
  }

  // Get balance
  getBalance(userId: string, type: WalletType, asset: string): number {
    const wallet = this.getWallet(userId, type, asset);
    return wallet ? wallet.balance : 0;
  }

  // Get available balance (total - locked)
  getAvailableBalance(userId: string, type: WalletType, asset: string): number {
    const wallet = this.getWallet(userId, type, asset);
    if (!wallet) return 0;
    return wallet.balance - wallet.lockedBalance;
  }

  // Credit balance
  async credit(userId: string, type: WalletType, asset: string, amount: number, txType: TransactionType, metadata?: Record<string, any>): Promise<Transaction> {
    const wallet = this.getWallet(userId, type, asset);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    wallet.balance += amount;
    wallet.updatedAt = new Date();

    const transaction = await this.createTransaction(userId, wallet, txType, asset, amount, 0, TransactionStatus.COMPLETED);
    
    return transaction;
  }

  // Debit balance
  async debit(userId: string, type: WalletType, asset: string, amount: number, txType: TransactionType, fee: number = 0): Promise<Transaction> {
    const wallet = this.getWallet(userId, type, asset);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const available = wallet.balance - wallet.lockedBalance;
    if (available < amount + fee) {
      throw new Error('Insufficient balance');
    }

    wallet.balance -= (amount + fee);
    wallet.updatedAt = new Date();

    const transaction = await this.createTransaction(userId, wallet, txType, asset, amount, fee, TransactionStatus.COMPLETED);
    
    return transaction;
  }

  // Lock balance (for pending orders)
  async lock(userId: string, type: WalletType, asset: string, amount: number): Promise<void> {
    const wallet = this.getWallet(userId, type, asset);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const available = wallet.balance - wallet.lockedBalance;
    if (available < amount) {
      throw new Error('Insufficient available balance');
    }

    wallet.lockedBalance += amount;
    wallet.updatedAt = new Date();
  }

  // Unlock balance
  async unlock(userId: string, type: WalletType, asset: string, amount: number): Promise<void> {
    const wallet = this.getWallet(userId, type, asset);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - amount);
    wallet.updatedAt = new Date();
  }

  // Transfer between wallets
  async transfer(userId: string, fromType: WalletType, toType: WalletType, asset: string, amount: number): Promise<void> {
    // Debit from source
    await this.debit(userId, fromType, asset, amount, TransactionType.TRANSFER);
    
    // Credit to destination
    await this.credit(userId, toType, asset, amount, TransactionType.TRANSFER);
  }

  // Create transaction record
  private async createTransaction(
    userId: string, 
    wallet: Wallet, 
    type: TransactionType, 
    asset: string, 
    amount: number, 
    fee: number,
    status: TransactionStatus
  ): Promise<Transaction> {
    const tx: Transaction = {
      id: `TX-${++this.txIdCounter}`,
      userId,
      walletId: wallet.id,
      type,
      asset,
      amount,
      fee,
      status,
      createdAt: new Date(),
      completedAt: status === TransactionStatus.COMPLETED ? new Date() : undefined
    };
    
    this.transactions.set(tx.id, tx);
    return tx;
  }

  // Get transaction history
  getTransactionHistory(userId: string, limit: number = 50): Transaction[] {
    return Array.from(this.transactions.values())
      .filter(tx => tx.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Generate deposit address (simulated)
  async generateDepositAddress(userId: string, asset: string, network: string): Promise<DepositAddress> {
    // In production, integrate with blockchain nodes
    const address = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 42)}`;
    
    return {
      asset,
      address,
      network,
      qrCode: `qr://${address}`,
    };
  }

  // Create withdrawal request
  async createWithdrawal(request: WithdrawalRequest): Promise<Transaction> {
    const wallet = this.getWallet(request.userId, WalletType.SPOT, request.asset);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const totalAmount = request.amount + request.fee;
    if (wallet.balance - wallet.lockedBalance < totalAmount) {
      throw new Error('Insufficient balance');
    }

    // Lock amount
    wallet.balance -= totalAmount;
    wallet.lockedBalance += totalAmount;
    wallet.updatedAt = new Date();

    // Create pending transaction
    const tx = await this.createTransaction(
      request.userId,
      wallet,
      TransactionType.WITHDRAWAL,
      request.asset,
      request.amount,
      request.fee,
      TransactionStatus.PENDING
    );
    
    tx.address = request.address;
    tx.txHash = `0x${Date.now().toString(16)}`;
    
    return tx;
  }

  // Confirm withdrawal
  async confirmWithdrawal(txId: string, txHash: string): Promise<void> {
    const tx = this.transactions.get(txId);
    if (!tx || tx.type !== TransactionType.WITHDRAWAL) {
      throw new Error('Transaction not found');
    }

    tx.status = TransactionStatus.COMPLETED;
    tx.txHash = txHash;
    tx.completedAt = new Date();

    // Unlock fee (goes to fee wallet)
    const wallet = this.wallets.get(tx.walletId);
    if (wallet) {
      wallet.lockedBalance -= (tx.amount + tx.fee);
      
      // Credit fee to fee wallet
      const feeWallet = this.getWallet(tx.userId, WalletType.FEE, tx.asset);
      if (feeWallet) {
        feeWallet.balance += tx.fee;
      }
    }
  }

  // Cancel withdrawal
  async cancelWithdrawal(txId: string): Promise<void> {
    const tx = this.transactions.get(txId);
    if (!tx || tx.type !== TransactionType.WITHDRAWAL) {
      throw new Error('Transaction not found');
    }

    if (tx.status !== TransactionStatus.PENDING) {
      throw new Error('Can only cancel pending withdrawals');
    }

    tx.status = TransactionStatus.CANCELLED;
    tx.completedAt = new Date();

    // Refund to wallet
    const wallet = this.wallets.get(tx.walletId);
    if (wallet) {
      wallet.balance += (tx.amount + tx.fee);
      wallet.lockedBalance -= (tx.amount + tx.fee);
    }
  }
}

export default WalletSystem;