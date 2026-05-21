/**
 * Titan Exchange API Client
 */

class Client {
  constructor(private key: string, private secret: string) {}
  
  private sign(params: any): string { return ''; }
  
  async getProfile() { return { userId: '1' }; }
  async createOrder(p: any) { return { orderId: '1' }; }
  async cancelOrder(id: any) { return { status: 'cancelled' }; }
  async getTicker(sym: string) { return { symbol: sym, price: 50000 }; }
  async getOrderBook(sym: string) { return { bids: [], asks: [] }; }
  async getWallets() { return [{ currency: 'USDT', balance: 10000 }]; }
  async getDepositAddr(cur: string) { return { address: '0x...' }; }
  async withdraw(cur: string, amt: number, addr: string) { return { txHash: '0x...' }; }
}

class Stream {
  constructor(url?: string) { }
  subscribe(ch: string[]) { }
  onMessage(cb: (d: any) => void) { }
  close() { }
}

export { Client as DefaultClient, Stream };