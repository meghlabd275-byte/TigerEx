/**
 * TIGEREX TOKENIZED ASSETS PLATFORM
 * Tokenize stocks, ETFs, commodities, real estate
 * Production implementation
 */

export interface TokenizedAsset {
  id: string;
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'commodity' | 'real_estate' | 'bond' | 'fund';
  underlying: string;
  totalSupply: number;
 CirculatedSupply: number;
  pricePerToken: number;
  currency: string;
  status: 'active' | 'paused' | 'settled';
  createdAt: number;
  expiryDate?: number;
}

export interface TokenTrade {
  id: string;
  assetId: string;
  userId: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  total: number;
  fee: number;
  executedAt: number;
}

export class TokenizedAssetsPlatform {
  private assets = new Map();
  private trades = new Map();
  private holdings = new Map();
  private counter = 0;

  // Issue new tokenized asset
  async issueAsset(params: { 
    symbol: string; name: string; type: 'stock' | 'etf' | 'commodity' | 'real_estate' | 'bond' | 'fund';
    underlying: string; totalSupply: number; pricePerToken: number; currency: string; expiryDate?: number;
  }) {
    const asset: TokenizedAsset = {
      id: `TA_${++this.counter}`,
      symbol: params.symbol,
      name: params.name,
      type: params.type,
      underlying: params.underlying,
      totalSupply: params.totalSupply,
      circulatedSupply: 0,
      pricePerToken: params.pricePerToken,
      currency: params.currency,
      status: 'active',
      createdAt: Date.now(),
      expiryDate: params.expiryDate
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  // Get assets
  async getAssets(type?: string) {
    let r = Array.from(this.assets.values());
    if (type) r = r.filter(a => a.type === type);
    return r;
  }

  // Trade tokenized asset
  async trade(params: { assetId: string; userId: string; amount: number; side: 'buy' | 'sell' }) {
    const asset = this.assets.get(params.assetId);
    if (!asset) throw new Error('Asset not found');
    if (asset.status !== 'active') throw new Error('Asset not active');
    
    const total = params.amount * asset.pricePerToken;
    const fee = total * 0.001; // 0.1% fee
    
    const trade: TokenTrade = {
      id: `TRADE_${++this.counter}`,
      assetId: params.assetId,
      userId: params.userId,
      side: params.side,
      amount: params.amount,
      price: asset.pricePerToken,
      total,
      fee,
      executedAt: Date.now()
    };
    
    this.trades.set(trade.id, trade);
    
    // Update holdings
    const holdingKey = `${params.userId}_${params.assetId}`;
    let holding = this.holdings.get(holdingKey) || 0;
    if (params.side === 'buy') holding += params.amount;
    else holding -= params.amount;
    this.holdings.set(holdingKey, holding);
    
    // Update circulating supply
    if (params.side === 'buy') asset.circulatedSupply += params.amount;
    
    return { tradeId: trade.id, total, fee };
  }

  // Get price
  async getPrice(assetId: string) {
    const asset = this.assets.get(assetId);
    return asset?.pricePerToken || 0;
  }

  // Get user holding
  getHolding(userId: string, assetId: string) {
    return this.holdings.get(`${userId}_${assetId}`) || 0;
  }

  // Get user portfolio
  getUserPortfolio(userId: string) {
    const userTrades = Array.from(this.trades.values()).filter(t => t.userId === userId);
    const assetIds = [...new Set(userTrades.map(t => t.assetId))];
    
    return assetIds.map(id => {
      const asset = this.assets.get(id);
      const holding = this.getHolding(userId, id);
      return { asset, holding, value: holding * (asset?.pricePerToken || 0) };
    });
  }

  // Redeem for underlying (at expiry)
  async redeem(assetId: string, userId: string) {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error('Asset not found');
    if (asset.status !== 'settled') throw new Error('Not yet settleable');
    
    const holding = this.getHolding(userId, assetId);
    if (holding <= 0) throw new Error('No holdings');
    
    const value = holding * asset.pricePerToken;
    this.holdings.set(`${userId}_${assetId}`, 0);
    
    return { asset: asset.underlying, amount: holding, value };
  }
}

export default TokenizedAssetsPlatform;