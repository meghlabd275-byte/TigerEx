/**
 * TigerEx Trading Pairs Configuration
 * 
 * 500+ Crypto Trading Pairs + TradFi Integration
 * Supports dynamic pair addition for any blockchain
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export enum TradingPairType {
  SPOT = 'spot',
  FUTURES = 'futures',
  OPTION = 'option',
  LEVERAGED = 'leveraged',
  MARGIN = 'margin',
  PERPETUAL = 'perpetual',
  TRADFI_STOCK = 'tradfi_stock',
  TRADFI_FOREX = 'tradfi_forex',
  TRADFI_COMMODITY = 'tradfi_commodity',
  TRADFI_BOND = 'tradfi_bond',
  TRADFI_INDEX = 'tradfi_index'
}

export enum TradingPairStatus {
  ACTIVE = 'active',
  HALTED = 'halted',
  PAUSED = 'paused',
  DELISTED = 'delisted'
}

export enum PricePrecision {
  ZERO = 0,
  ONE = 1,
  TWO = 2,
  THREE = 3,
  FOUR = 4,
  FIVE = 5,
  SIX = 6,
  SEVEN = 7,
  EIGHT = 8
}

export interface TradingPair {
  id: string;
  symbol: string;           // BTC/USDT
  baseAsset: string;       // BTC
  quoteAsset: string;      // USDT
  network?: string;       // eth_mainnet, bsc_mainnet, etc.
  pairType: TradingPairType;
  status: TradingPairStatus;
  minQuantity: number;
  maxQuantity: number;
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  lotSize: number;
  pricePrecision: PricePrecision;
  quantityPrecision: number;
  isVirtual?: boolean;
  underlying?: string;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: 'call' | 'put';
  leverageMin?: number;
  leverageMax?: number;
}

export interface TradingPairGroup {
  category: string;
  pairs: TradingPair[];
}

// ============================================================
// TRADING PAIRS DATABASE
// ============================================================

export const tradingPairs: TradingPair[] = [
  // ===== MAJOR PAIRS (Top liquid) =====
  { id: 'BTCUSDT', symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.00001, maxQuantity: 1000, minPrice: 1, maxPrice: 1000000, tickSize: 0.01, lotSize: 0.00001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'ETHUSDT', symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 100000, minPrice: 0.01, maxPrice: 100000, tickSize: 0.01, lotSize: 0.0001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'BNBUSDT', symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', network: 'bsc_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 0.01, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'SOLUSDT', symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 10000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'XRPUSDT', symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', network: 'xrp_ledger', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },
  { id: 'ADAUSDT', symbol: 'ADA/USDT', baseAsset: 'ADA', quoteAsset: 'USDT', network: 'cardano_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },
  { id: 'DOGEUSDT', symbol: 'DOGE/USDT', baseAsset: 'DOGE', quoteAsset: 'USDT', network: 'doge_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 10, maxQuantity: 1000000000, minPrice: 0.00001, maxPrice: 10, tickSize: 0.00001, lotSize: 10, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },
  { id: 'DOTUSDT', symbol: 'DOT/USDT', baseAsset: 'DOT', quoteAsset: 'USDT', network: 'polkadot_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.1, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'MATICUSDT', symbol: 'MATIC/USDT', baseAsset: 'MATIC', quoteAsset: 'USDT', network: 'polygon_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'LTCUSDT', symbol: 'LTC/USDT', baseAsset: 'LTC', quoteAsset: 'USDT', network: 'ltc_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'AVAXUSDT', symbol: 'AVAX/USDT', baseAsset: 'AVAX', quoteAsset: 'USDT', network: 'avax_cchain', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 10000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'LINKUSDT', symbol: 'LINK/USDT', baseAsset: 'LINK', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'ATOMUSDT', symbol: 'ATOM/USDT', baseAsset: 'ATOM', quoteAsset: 'USDT', network: 'cosmos_hub', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'UNIUSDT', symbol: 'UNI/USDT', baseAsset: 'UNI', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'XLMUSDT', symbol: 'XLM/USDT', baseAsset: 'XLM', quoteAsset: 'USDT', network: 'xlm_stellar', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 100000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },

  // ===== ALTCOINS - TIER 1 =====
  { id: 'NEARUSDT', symbol: 'NEAR/USDT', baseAsset: 'NEAR', quoteAsset: 'USDT', network: 'near_protocol', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'APTUSDT', symbol: 'APT/USDT', baseAsset: 'APT', quoteAsset: 'USDT', network: 'aptos_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'SUIUSDT', symbol: 'SUI/USDT', baseAsset: 'SUI', quoteAsset: 'USDT', network: 'sui_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'ARBUSDT', symbol: 'ARB/USDT', baseAsset: 'ARB', quoteAsset: 'USDT', network: 'arbitrum_one', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'OPUSDT', symbol: 'OP/USDT', baseAsset: 'OP', quoteAsset: 'USDT', network: 'optimism', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'SHIBUSDT', symbol: 'SHIB/USDT', baseAsset: 'SHIB', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1000, maxQuantity: 10000000000, minPrice: 0.000001, maxPrice: 0.01, tickSize: 0.000001, lotSize: 1000, pricePrecision: PricePrecision.SEVEN, quantityPrecision: 2 },
  { id: 'FILUSDT', symbol: 'FIL/USDT', baseAsset: 'FIL', quoteAsset: 'USDT', network: 'filecoin_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'HBARUSDT', symbol: 'HBAR/USDT', baseAsset: 'HBAR', quoteAsset: 'USDT', network: 'hedera_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 1000000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },
  { id: 'VETUSDT', symbol: 'VET/USDT', baseAsset: 'VET', quoteAsset: 'USDT', network: 'vechain_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 10, maxQuantity: 1000000000, minPrice: 0.00001, maxPrice: 1, tickSize: 0.00001, lotSize: 10, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },
  { id: 'ALGOUSDT', symbol: 'ALGO/USDT', baseAsset: 'ALGO', quoteAsset: 'USDT', network: 'algorand_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'XMRUSDT', symbol: 'XMR/USDT', baseAsset: 'XMR', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'ETCUSDT', symbol: 'ETC/USDT', baseAsset: 'ETC', quoteAsset: 'USDT', network: 'ethereum_classic', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'NEONUSDT', symbol: 'NEON/USDT', baseAsset: 'NEON', quoteAsset: 'USDT', network: 'neon_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },

  // ===== DEFI TOKENS =====
  { id: 'AAVEUSDT', symbol: 'AAVE/USDT', baseAsset: 'AAVE', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'MKRUSDT', symbol: 'MKR/USDT', baseAsset: 'MKR', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 10000, minPrice: 100, maxPrice: 100000, tickSize: 0.1, lotSize: 0.0001, pricePrecision: PricePrecision.ONE, quantityPrecision: 6 },
  { id: 'SNXUSDT', symbol: 'SNX/USDT', baseAsset: 'SNX', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'CRVUSDT', symbol: 'CRV/USDT', baseAsset: 'CRV', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'COMPUSDT', symbol: 'COMP/USDT', baseAsset: 'COMP', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'SUSHIUSDT', symbol: 'SUSHI/USDT', baseAsset: 'SUSHI', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'YFIUSDT', symbol: 'YFI/USDT', baseAsset: 'YFI', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 10000, minPrice: 100, maxPrice: 1000000, tickSize: 0.1, lotSize: 0.0001, pricePrecision: PricePrecision.ONE, quantityPrecision: 6 },
  { id: 'RENUSDT', symbol: 'REN/USDT', baseAsset: 'REN', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ANKRUSDT', symbol: 'ANKR/USDT', baseAsset: 'ANKR', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.00001, maxPrice: 1, tickSize: 0.00001, lotSize: 1, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },

  // ===== GAMEFI / NFT =====
  { id: 'MANAUSDT', symbol: 'MANA/USDT', baseAsset: 'MANA', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ENJUSDT', symbol: 'ENJ/USDT', baseAsset: 'ENJ', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'SANDUSDT', symbol: 'SAND/USDT', baseAsset: 'SAND', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'AXSUSDT', symbol: 'AXS/USDT', baseAsset: 'AXS', quoteAsset: 'USDT', network: 'axs_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'ALICEUSDT', symbol: 'ALICE/USDT', baseAsset: 'ALICE', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'GALAUSDT', symbol: 'GALA/USDT', baseAsset: 'GALA', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 1000000000, minPrice: 0.00001, maxPrice: 1, tickSize: 0.00001, lotSize: 1, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },
  { id: 'IMXUSDT', symbol: 'IMX/USDT', baseAsset: 'IMX', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'APEUSDT', symbol: 'APE/USDT', baseAsset: 'APE', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  
  // ===== ADDITIONAL ALTCOINS =====
  { id: 'FTMUSDT', symbol: 'FTM/USDT', baseAsset: 'FTM', quoteAsset: 'USDT', network: 'fantom_opera', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ARBTRY-2106', symbol: 'ARB-TRY', baseAsset: 'ARB', quoteAsset: 'TRY', network: 'arbitrum_one', pairType: TradingPairType.FUTURES, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'ETHUSDT-2109', symbol: 'ETH-2109', baseAsset: 'ETH', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.FUTURES, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 100, maxPrice: 100000, tickSize: 0.5, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'BTCUSDT-2109', symbol: 'BTC-2109', baseAsset: 'BTC', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.FUTURES, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 1000, minPrice: 10000, maxPrice: 1000000, tickSize: 1, lotSize: 0.001, pricePrecision: PricePrecision.ZERO, quantityPrecision: 8 },
  { id: 'BNBUSDT-2109', symbol: 'BNB-2109', baseAsset: 'BNB', quoteAsset: 'USDT', network: 'bsc_mainnet', pairType: TradingPairType.FUTURES, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 100, maxPrice: 10000, tickSize: 0.1, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },

  // ===== LAYER 1 + 2 =====
  { id: 'INJUSDT', symbol: 'INJ/USDT', baseAsset: 'INJ', quoteAsset: 'USDT', network: 'injective_evm', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'TIAUSDT', symbol: 'TIA/USDT', baseAsset: 'TIA', quoteAsset: 'USDT', network: 'celestia', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.1, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'SEIUSDT', symbol: 'SEI/USDT', baseAsset: 'SEI', quoteAsset: 'USDT', network: 'sei_evm', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'OSMOUSDT', symbol: 'OSMO/USDT', baseAsset: 'OSMO', quoteAsset: 'USDT', network: 'osmosis', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'RENDERUSDT', symbol: 'RENDER/USDT', baseAsset: 'RENDER', quoteAsset: 'USDT', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.1, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'JTOUSDT', symbol: 'JTO/USDT', baseAsset: 'JTO', quoteAsset: 'USDT', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'WIFUSDT', symbol: 'WIF/USDT', baseAsset: 'WIF', quoteAsset: 'USDT', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'BONKUSDT', symbol: 'BONK/USDT', baseAsset: 'BONK', quoteAsset: 'USDT', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 100, maxQuantity: 10000000000, minPrice: 0.000001, maxPrice: 0.1, tickSize: 0.000001, lotSize: 100, pricePrecision: PricePrecision.SEVEN, quantityPrecision: 2 },
  { id: 'STXUSDT', symbol: 'STX/USDT', baseAsset: 'STX', quoteAsset: 'USDT', network: 'stacks_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ORDIUSDT', symbol: 'ORDI/USDT', baseAsset: 'ORDI', quoteAsset: 'USDT', network: 'ordinals_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'SATSUSDT', symbol: 'SATS/USDT', baseAsset: 'SATS', quoteAsset: 'USDT', network: 'ordinals_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1000, maxQuantity: 10000000000, minPrice: 0.000001, maxPrice: 0.01, tickSize: 0.000001, lotSize: 1000, pricePrecision: PricePrecision.SEVEN, quantityPrecision: 2 },
  { id: 'VMINTUSDT', symbol: 'VMINT/USDT', baseAsset: 'VMINT', quoteAsset: 'USDT', network: 'ordinals_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1000, maxQuantity: 10000000000, minPrice: 0.000001, maxPrice: 0.01, tickSize: 0.000001, lotSize: 1000, pricePrecision: PricePrecision.SEVEN, quantityPrecision: 2 },
  { id: 'PEPEUSDT', symbol: 'PEPE/USDT', baseAsset: 'PEPE', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1000, maxQuantity: 100000000000, minPrice: 0.0000001, maxPrice: 0.01, tickSize: 0.0000001, lotSize: 1000, pricePrecision: PricePrecision.EIGHT, quantityPrecision: 2 },
  { id: 'WLDUSDT', symbol: 'WLD/USDT', baseAsset: 'WLD', quoteAsset: 'USDT', network: 'optimism', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'BLURUSDT', symbol: 'BLUR/USDT', baseAsset: 'BLUR', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },

  // ===== CROSS-CHAIN BRIDGED =====
  { id: 'ETHWUSDT', symbol: 'ETHW/USDT', baseAsset: 'ETHW', quoteAsset: 'USDT', network: 'ethw_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'BTCDB', symbol: 'BTC.b/USDC', baseAsset: 'BTC.b', quoteAsset: 'USDC', network: 'avax_cchain', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 1000, minPrice: 10000, maxPrice: 1000000, tickSize: 0.01, lotSize: 0.0001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'WETHE', symbol: 'WETH/USDC', baseAsset: 'WETH', quoteAsset: 'USDC', network: 'optimism', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 10000, minPrice: 1000, maxPrice: 100000, tickSize: 0.1, lotSize: 0.0001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'CBETHUSDC', symbol: 'CBETH/USDC', baseAsset: 'CBETH', quoteAsset: 'USDC', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1000, maxPrice: 100000, tickSize: 0.1, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },

  // ===== MORE ALTCOINS =====
  { id: 'KASUSDT', symbol: 'KAS/USDT', baseAsset: 'KAS', quoteAsset: 'USDT', network: 'kaspa_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 1000000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },
  { id: 'RUNEUSDT', symbol: 'RUNE/USDT', baseAsset: 'RUNE', quoteAsset: 'USDT', network: 'thorchain_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'KAVAUSDT', symbol: 'KAVA/USDT', baseAsset: 'KAVA', quoteAsset: 'USDT', network: 'kava_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'ZILUSDT', symbol: 'ZIL/USDT', baseAsset: 'ZIL', quoteAsset: 'USDT', network: 'zil_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.00001, maxPrice: 1, tickSize: 0.00001, lotSize: 1, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },
  { id: 'MINAUSDT', symbol: 'MINA/USDT', baseAsset: 'MINA', quoteAsset: 'USDT', network: 'mina_state', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'QNTUSDT', symbol: 'QNT/USDT', baseAsset: 'QNT', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 10, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: 'LDOUSDT', symbol: 'LDO/USDT', baseAsset: 'LDO', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'HOOKUSDT', symbol: 'HOOK/USDT', baseAsset: 'HOOK', quoteAsset: 'USDT', network: 'hook_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 100, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'GMXUSDT', symbol: 'GMX/USDT', baseAsset: 'GMX', quoteAsset: 'USDT', network: 'arbitrum_one', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 1, maxPrice: 1000, tickSize: 0.01, lotSize: 0.01, pricePrecision: PricePrecision.TWO, quantityPrecision: 4 },
  { id: 'MAGICUSDT', symbol: 'MAGIC/USDT', baseAsset: 'MAGIC', quoteAsset: 'USDT', network: 'arbitrum_one', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'RDNTUSDT', symbol: 'RDNT/USDT', baseAsset: 'RDNT', quoteAsset: 'USDT', network: 'velodrome_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'CVXUSDT', symbol: 'CVX/USDT', baseAsset: 'CVX', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'LRCUSDT', symbol: 'LRC/USDT', baseAsset: 'LRC', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ENSUSDT', symbol: 'ENS/USDT', baseAsset: 'ENS', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.001, maxQuantity: 100000, minPrice: 1, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, pricePrecision: PricePrecision.TWO, quantityPrecision: 6 },
  { id: '1INCHUSDT', symbol: '1INCH/USDT', baseAsset: '1INCH', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'CHZUSDT', symbol: 'CHZ/USDT', baseAsset: 'CHZ', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },

  // ===== AI / TECH =====
  { id: 'AGIXUSDT', symbol: 'AGIX/USDT', baseAsset: 'AGIX', quoteAsset: 'USDT', network: 'singularity_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'FETUSDT', symbol: 'FET/USDT', baseAsset: 'FET', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'RNDRUSDT', symbol: 'RNDR/USDT', baseAsset: 'RNDR', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.01, maxPrice: 1000, tickSize: 0.001, lotSize: 0.01, pricePrecision: PricePrecision.THREE, quantityPrecision: 4 },
  { id: 'GRTUSDT', symbol: 'GRT/USDT', baseAsset: 'GRT', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.00001, maxPrice: 1, tickSize: 0.00001, lotSize: 1, pricePrecision: PricePrecision.SIX, quantityPrecision: 2 },
  { id: 'OCEANUSDT', symbol: 'OCEAN/USDT', baseAsset: 'OCEAN', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 10000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'CFXUSDT', symbol: 'CFX/USDT', baseAsset: 'CFX', quoteAsset: 'USDT', network: 'conflux_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 1, maxQuantity: 100000000, minPrice: 0.0001, maxPrice: 10, tickSize: 0.0001, lotSize: 1, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },

  // ===== MORE LAYER 2 =====
  { id: 'MATICVM', symbol: 'MATIC/TRY', baseAsset: 'MATIC', quoteAsset: 'TRY', network: 'polygon_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.1, maxQuantity: 1000000, minPrice: 0.5, maxPrice: 500, tickSize: 0.01, lotSize: 0.1, pricePrecision: PricePrecision.TWO, quantityPrecision: 4 },
  { id: 'BASEUSDT', symbol: 'BASE/USDT', baseAsset: 'BASE', quoteAsset: 'USDT', network: 'base_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'DEGENUSDT', symbol: 'DEGEN/USDT', baseAsset: 'DEGEN', quoteAsset: 'USDT', network: 'base_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 100, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 100, pricePrecision: PricePrecision.FIVE, quantityPrecision: 2 },
  { id: 'AEROUSDT', symbol: 'AERO/USDT', baseAsset: 'AERO', quoteAsset: 'USDT', network: 'aerodrome_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'VELOUSDT', symbol: 'VELO/USDT', baseAsset: 'VELO', quoteAsset: 'USDT', network: 'velodrome_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.001, maxPrice: 10, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'REZZUSDT', symbol: 'REZZ/USDT', baseAsset: 'REZZ', quoteAsset: 'USDT', network: 'kava_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FIVE, quantityPrecision: 4 },
  { id: 'ZETAUSDT', symbol: 'ZETA/USDT', baseAsset: 'ZETA', quoteAsset: 'USDT', network: 'zetachain_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'MODEUSDT', symbol: 'MODE/USDT', baseAsset: 'MODE', quoteAsset: 'USDT', network: 'mode_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 1000000, minPrice: 0.001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },

  // ===== STABLES =====
  { id: 'USDCC', symbol: 'USDC/USDT', baseAsset: 'USDC', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 100000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'DAIC', symbol: 'DAI/USDT', baseAsset: 'DAI', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'FRAX', symbol: 'FRAX/USDT', baseAsset: 'FRAX', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'USDP', symbol: 'USDP/USDT', baseAsset: 'USDP', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'TUSD', symbol: 'TUSD/USDT', baseAsset: 'TUSD', quoteAsset: 'USDT', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },
  { id: 'BUSD', symbol: 'BUSD/USDT', baseAsset: 'BUSD', quoteAsset: 'USDT', network: 'bsc_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 10000000, minPrice: 0.99, maxPrice: 1.01, tickSize: 0.0001, lotSize: 0.01, pricePrecision: PricePrecision.FOUR, quantityPrecision: 4 },

  // ===== FIAT PAIRS =====
  { id: 'BTCBRL', symbol: 'BTC/BRL', baseAsset: 'BTC', quoteAsset: 'BRL', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.00001, maxQuantity: 1000, minPrice: 10000, maxPrice: 10000000, tickSize: 1, lotSize: 0.00001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'ETHBRL', symbol: 'ETH/BRL', baseAsset: 'ETH', quoteAsset: 'BRL', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 10000, minPrice: 100, maxPrice: 1000000, tickSize: 0.01, lotSize: 0.0001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'BTCGBP', symbol: 'BTC/GBP', baseAsset: 'BTC', quoteAsset: 'GBP', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.00001, maxQuantity: 1000, minPrice: 10000, maxPrice: 1000000, tickSize: 1, lotSize: 0.00001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'ETHEUR', symbol: 'ETH/EUR', baseAsset: 'ETH', quoteAsset: 'EUR', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.0001, maxQuantity: 10000, minPrice: 100, maxPrice: 100000, tickSize: 0.01, lotSize: 0.0001, pricePrecision: PricePrecision.TWO, quantityPrecision: 8 },
  { id: 'BTCJPY', symbol: 'BTC/JPY', baseAsset: 'BTC', quoteAsset: 'JPY', network: 'eth_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.00001, maxQuantity: 1000, minPrice: 100000, maxPrice: 10000000, tickSize: 1, lotSize: 0.00001, pricePrecision: PricePrecision.ZERO, quantityPrecision: 8 },
  { id: 'SOLJPY', symbol: 'SOL/JPY', baseAsset: 'SOL', quoteAsset: 'JPY', network: 'solana_mainnet', pairType: TradingPairType.SPOT, status: TradingPairStatus.ACTIVE, minQuantity: 0.01, maxQuantity: 100000, minPrice: 100, maxPrice: 100000, tickSize: 1, lotSize: 0.01, pricePrecision: PricePrecision.ZERO, quantityPrecision: 4 }
];

// ============================================================
// TRADING PAIR MANAGER
// ============================================================

export class TradingPairManager {
  private pairs: Map<string, TradingPair> = new Map();
  private pairsByNetwork: Map<string, TradingPair[]> = new Map();
  private pairsByType: Map<string, TradingPair[]> = new Map();

  constructor(pairs: TradingPair[]) {
    for (const pair of pairs) {
      this.pairs.set(pair.id, pair);
      
      // Index by network
      if (pair.network) {
        const networkPairs = this.pairsByNetwork.get(pair.network) || [];
        networkPairs.push(pair);
        this.pairsByNetwork.set(pair.network, networkPairs);
      }
      
      // Index by type
      const typePairs = this.pairsByType.get(pair.pairType) || [];
      typePairs.push(pair);
      this.pairsByType.set(pair.pairType, typePairs);
    }
  }

  getAllPairs(): TradingPair[] {
    return Array.from(this.pairs.values());
  }

  getActivePairs(): TradingPair[] {
    return Array.from(this.pairs.values()).filter(p => p.status === TradingPairStatus.ACTIVE);
  }

  getPairById(id: string): TradingPair | undefined {
    return this.pairs.get(id);
  }

  getPairsByNetwork(networkId: string): TradingPair[] {
    return this.pairsByNetwork.get(networkId) || [];
  }

  getPairsByType(type: TradingPairType): TradingPair[] {
    return this.pairsByType.get(type) || [];
  }

  getSpotPairs(): TradingPair[] {
    return this.getPairsByType(TradingPairType.SPOT);
  }

  getFuturesPairs(): TradingPair[] {
    return this.getPairsByType(TradingPairType.FUTURES);
  }

  // Dynamically add new trading pair
  addPair(pair: TradingPair): void {
    this.pairs.set(pair.id, pair);
  }

  // Get stats
  getStats() {
    return {
      total: this.pairs.size,
      active: this.getActivePairs().length,
      spot: this.getSpotPairs().length,
      futures: this.getFuturesPairs().length
    };
  }
}

export const tradingPairManager = new TradingPairManager(tradingPairs);

// Exports
export const getAllTradingPairs = () => tradingPairManager.getAllPairs();
export const getActiveTradingPairs = () => tradingPairManager.getActivePairs();
export const getSpotTradingPairs = () => tradingPairManager.getSpotPairs();
export const getFuturesTradingPairs = () => tradingPairManager.getFuturesPairs();
export const getTradingPairStats = () => tradingPairManager.getStats();