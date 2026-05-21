/**
 * Fiat On/Off Ramp Platform
 * 
 * Fiat payment rails: card payments, bank transfers, local payment methods
 * Partners: Stripe, Adyen, local rails
 */

export enum PaymentMethod {
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  SWIFT = 'swift',
  SEPA = 'sepa',
  LOCAL_RAIL = 'local_rail'
}

export class FiatOnOffRampPlatform {
  private partners: Map<string, FiatPartner> = new Map();
  private transactions: Map<string, FiatTransaction> = new Map();

  /**
   * Initiate fiat deposit
   */
  async initiateDeposit(input: DepositInput): Promise<FiatTransaction> {
    const tx: FiatTransaction = {
      id: `FIAT-${Date.now()}`,
      type: 'deposit',
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      partner: input.partner,
      status: 'pending',
      createdAt: new Date(),
      redirectUrl: `https://partner.com/pay/${input.partner}`
    };

    this.transactions.set(tx.id, tx);
    return tx;
  }

  /**
   * Initiate fiat withdrawal
   */
  async initiateWithdrawal(input: WithdrawalInput): Promise<FiatTransaction> {
    const tx: FiatTransaction = {
      id: `FIAT-${Date.now()}`,
      type: 'withdrawal',
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      partner: input.partner,
      bankDetails: input.bankDetails,
      status: 'pending',
      createdAt: new Date()
    };

    this.transactions.set(tx.id, tx);
    return tx;
  }

  /**
   * Add fiat partner (Stripe, Adyen, etc.)
   */
  async addPartner(partner: FiatPartner): Promise<void> {
    this.partners.set(partner.id, partner);
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId: string): Promise<FiatTransaction | null> {
    return this.transactions.get(txId) || null;
  }
}

interface DepositInput {
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  partner: string;
}

interface WithdrawalInput {
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  partner: string;
  bankDetails: BankDetails;
}

interface FiatTransaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  partner: string;
  status: string;
  redirectUrl?: string;
  bankDetails?: BankDetails;
  createdAt: Date;
}

interface BankDetails {
  bankName: string;
  accountNumber: string;
  routingNumber?: string;
  iban?: string;
  swift?: string;
}

interface FiatPartner {
  id: string;
  name: string;
  supportedMethods: PaymentMethod[];
  supportedCurrencies: string[];
  fees: Record<string, number>;
}

export { PaymentMethod };