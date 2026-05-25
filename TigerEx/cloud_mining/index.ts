/**
 * TIGEREX CLOUD MINING
 * Production - Cloud mining like KuCoin
 */

export interface CloudMiningProduct {
  id: string;
  coin: string;
  hashrate: number;
  price: number;
  duration: number;
  dailyEarn: number;
  totalEarn: number;
  status: 'available' | 'sold_out';
}

export interface CloudMiningOrder {
  id: string;
  userId: string;
  productId: string;
  coin: string;
  hashrate: number;
  startTime: number;
  endTime: number;
  earned: number;
  pending: number;
  status: 'mining' | 'completed' | 'expired';
}

export class CloudMining {
  private products: Map<string, CloudMiningProduct> = new Map();
  private orders: Map<string, CloudMiningOrder> = new Map();
  private counter = 0;

  constructor() {
    this.products.set('cm_1', { id: 'cm_1', coin: 'BTC', hashrate: 100, price: 100, duration: 180, dailyEarn: 0.5, totalEarn: 90, status: 'available' });
    this.products.set('cm_2', { id: 'cm_2', coin: 'ETH', hashrate: 500, price: 50, duration: 90, dailyEarn: 2, totalEarn: 180, status: 'available' });
    this.products.set('cm_3', { id: 'cm_3', coin: 'DOGE', hashrate: 10000, price: 30, duration: 30, dailyEarn: 1000, totalEarn: 30000, status: 'available' });
  }

  async getProducts(): Promise<CloudMiningProduct[]> {
    return Array.from(this.products.values());
  }

  async purchase(userId: string, productId: string): Promise<{ success: boolean; orderId: string }> {
    const product = this.products.get(productId);
    if (!product || product.status !== 'available') return { success: false, orderId: '' };
    
    const order: CloudMiningOrder = {
      id: `ORDER_${++this.counter}`,
      userId,
      productId,
      coin: product.coin,
      hashrate: product.hashrate,
      startTime: Date.now(),
      endTime: Date.now() + product.duration * 86400000,
      earned: 0,
      pending: 0,
      status: 'mining'
    };
    this.orders.set(order.id, order);
    return { success: true, orderId: order.id };
  }

  async getMyOrders(userId: string): Promise<CloudMiningOrder[]> {
    return Array.from(this.orders.values()).filter(o => o.userId === userId);
  }

  async getEarnings(userId: string): Promise<{ totalEarned: number; pending: number }> {
    const orders = await this.getMyOrders(userId);
    let totalEarned = 0, pending = 0;
    for (const o of orders) { totalEarned += o.earned; pending += o.pending; }
    return { totalEarned, pending };
  }

  async claimEarnings(orderId: string): Promise<{ success: boolean; amount: number }> {
    const order = this.orders.get(orderId);
    if (!order) return { success: false, amount: 0 };
    const amount = order.pending;
    order.earned += amount;
    order.pending = 0;
    return { success: true, amount };
  }
}

export default CloudMining;