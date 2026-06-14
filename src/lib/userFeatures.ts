export type FeatureStatus = 'live' | 'ready' | 'guarded';

export interface OperationFeature {
  name: string;
  route: string;
  category: string;
  capability: string;
  actions: string[];
  status: FeatureStatus;
}

export const userTradingFeatures: OperationFeature[] = [
  { name: 'Market', route: '/markets', category: 'Markets', capability: 'Binance-style market list with depth, ticker, trades and pair details.', actions: ['Search pairs', 'View order book', 'Open charts', 'Inspect 24h stats'], status: 'live' },
  { name: 'Spot', route: '/trade/BTC-USDT', category: 'Trading', capability: 'Bybit-style spot terminal for market and limit orders.', actions: ['Place market order', 'Place limit order', 'View chart', 'Track open orders'], status: 'live' },
  { name: 'Alpha Trading', route: '/alpha', category: 'Trading', capability: 'Binance Alpha-style discovery, watchlists and early token trading.', actions: ['Discover alpha assets', 'Analyze momentum', 'Trade alpha pairs'], status: 'live' },
  { name: 'Futures', route: '/futures', category: 'Derivatives', capability: 'Perpetual contracts with USDT-M, COIN-M and options-style contract selection.', actions: ['Set leverage', 'Open long/short', 'Manage margin', 'Close position'], status: 'live' },
  { name: 'Margin', route: '/margin', category: 'Trading', capability: 'Cross and isolated margin flows with Binance-like risk controls.', actions: ['Borrow', 'Repay', 'Switch margin mode', 'Liquidation monitor'], status: 'live' },
  { name: 'Options', route: '/options', category: 'Derivatives', capability: 'Call and put options chain with premium, strike and expiry workflows.', actions: ['Buy call', 'Buy put', 'Filter expiries', 'Exercise/settle'], status: 'live' },
  { name: 'P2P', route: '/p2p', category: 'Trading', capability: 'Bybit-like peer-to-peer marketplace with advertisers and escrow states.', actions: ['Post ad', 'Buy from seller', 'Release escrow', 'Dispute trade'], status: 'live' },
  { name: 'TradFi', route: '/tradfi', category: 'Trading', capability: 'Stocks CFD trading inspired by Bybit and Bitget.', actions: ['Trade stock CFDs', 'Use watchlists', 'Apply leverage', 'Close CFD'], status: 'live' },
  { name: 'Quick Trade', route: '/quick-trade', category: 'Trading', capability: 'Fast convert-style ticket for simple buy/sell actions.', actions: ['Preview quote', 'Buy instantly', 'Sell instantly'], status: 'live' },
  { name: 'Complete Trade', route: '/trading/terminal', category: 'Trading', capability: 'Full professional trading suite with charts, book, orders and trades.', actions: ['Advanced charting', 'Depth trading', 'Order management'], status: 'live' },
  { name: 'Pairs', route: '/markets', category: 'Markets', capability: 'Trading pairs directory across spot, margin and derivative instruments.', actions: ['Filter pairs', 'Favorite pairs', 'Open terminal'], status: 'live' },
  { name: 'Trading Pair Detail', route: '/trading/BTC-USDT', category: 'Markets', capability: 'Binance-like pair detail page with live-style stats and order entry.', actions: ['Read pair stats', 'View candles', 'Submit order'], status: 'live' },
  { name: 'Pre Market', route: '/premarket', category: 'Markets', capability: 'Bybit-like pre-market listings and allocation flow.', actions: ['View upcoming tokens', 'Place pre-market order', 'Track settlement'], status: 'live' },
  { name: 'Liquidity Mining', route: '/earn/liquidity-mining', category: 'Earn', capability: 'Binance-like pools with APR, TVL and claimable rewards.', actions: ['Add liquidity', 'Remove liquidity', 'Claim rewards'], status: 'live' },
  { name: 'Cloud Mining', route: '/earn/cloud-mining', category: 'Earn', capability: 'KuCoin-like hashrate packages and daily output projection.', actions: ['Buy hashrate', 'Track output', 'Redeem proceeds'], status: 'live' },
  { name: 'Launchpad', route: '/earn/launchpad', category: 'DeFi & ETF', capability: 'Token sales with subscription, allocation and claim stages.', actions: ['Subscribe', 'Commit funds', 'Claim tokens'], status: 'live' },
  { name: 'Launchpool', route: '/earn/launchpool', category: 'DeFi & ETF', capability: 'Yield farming campaigns with staking pools and hourly rewards.', actions: ['Stake', 'Harvest', 'Unstake'], status: 'live' },
  { name: 'Staking', route: '/earn/staking', category: 'DeFi & ETF', capability: 'Flexible and locked staking products.', actions: ['Subscribe', 'Redeem', 'Auto-compound'], status: 'live' },
  { name: 'Earn', route: '/earn', category: 'DeFi & ETF', capability: 'Earn hub for savings, staking, launchpool and mining products.', actions: ['Compare APR', 'Subscribe product', 'Redeem principal'], status: 'live' },
  { name: 'ETF', route: '/earn/etf', category: 'DeFi & ETF', capability: 'OKX-style ETF tokens and baskets.', actions: ['Trade ETF', 'Rebalance basket', 'View NAV'], status: 'live' },
  { name: 'Convert', route: '/convert', category: 'Wallet', capability: 'Binance-like instant conversion with firm quotes.', actions: ['Request quote', 'Accept quote', 'Record conversion'], status: 'live' },
  { name: 'Wallet Transfer', route: '/wallet/transfer', category: 'Wallet', capability: 'Move balances between spot, margin, futures and earn wallets.', actions: ['Internal wallet transfer', 'User-to-user transfer', 'Audit transfer'], status: 'live' },
  { name: 'Coupons', route: '/coupons', category: 'Rewards', capability: 'Claim and redeem fee coupons.', actions: ['Claim coupon', 'Apply coupon', 'View expiry'], status: 'live' },
  { name: 'Red Packet', route: '/redpacket', category: 'Rewards', capability: 'Binance-style red packet send and claim flows.', actions: ['Create packet', 'Share code', 'Claim packet'], status: 'live' },
];

export const walletFeatures = ['Deposit', 'Withdraw', 'Transfer', 'History', 'Addresses', 'Multi-currency', 'Multi-chain', 'Multi-asset'];
export const authFeatures = ['Login', 'Register', '2FA', 'KYC', 'Social', 'MetaMask', 'Passkey', 'Biometric'];
