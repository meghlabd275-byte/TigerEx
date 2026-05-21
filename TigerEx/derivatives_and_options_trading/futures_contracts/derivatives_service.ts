/**
 * TigerEx Derivatives
 * Futures and Options
 */

const PERPETUAL_CONTRACTS = [
  { symbol: 'BTCUSDT-PERP', underlying: 'BTC', maxLeverage: 125 },
  { symbol: 'ETHUSDT-PERP', underlying: 'ETH', maxLeverage: 100 },
];

class DerivativesService {
  async openPosition(params) {
    const contract = PERPETUAL_CONTRACTS.find(c => c.symbol === params.symbol);
    if (!contract) throw new Error('Unknown contract');
    if (params.leverage > contract.maxLeverage) throw new Error('Max leverage exceeded');
    
    const margin = (params.price * params.quantity) / params.leverage;
    return { id: crypto.randomUUID(), margin, status: 'OPEN' };
  }
  
  async getFundingRate(symbol) {
    return { rate: 0.0001, nextUpdate: Date.now() + 28800000 };
  }
}

class OptionsService {
  async buyOption(params) {
    const premium = params.price * params.quantity;
    return { id: crypto.randomUUID(), premium, status: 'OPEN' };
  }
  
  async exercise(optId, price) {
    return price * 100;
  }
}

export { DerivativesService, OptionsService };