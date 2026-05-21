/** TigerEx Market Making */

class MarketMakingService {
  async rebate(volume, spread) { return volume * 0.02; }
  getTiers() { return [{spread:'0.1%', rebate:0.02}]; }
}

class ApiErrors {
  static get(code) { return { code, msg: 'error' }; }
}

class Monitors {
  async health() { return { status: 'healthy' }; }
}

export { MarketMakingService, ApiErrors, Monitors };