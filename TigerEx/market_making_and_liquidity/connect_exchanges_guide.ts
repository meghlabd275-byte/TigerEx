/**
 * TigerEx MM Bot - Complete Exchange Connection Guide
 * 
 * HOW TO CONNECT ALL EXCHANGES:
 * ==========================
 * 
 * Step 1: Import the module
 * Step 2: Initialize connector
 * Step 3: Connect with your API keys
 * Step 4: Start trading!
 */

// ============================================================================
// STEP 1: IMPORT
// ============================================================================

import { MMOperationManager } from './market_making_and_liquidity/mm_complete_operations';

// ============================================================================
// STEP 2: INITIALIZE
// ============================================================================

const mmManager = new MMOperationManager();

// ============================================================================
// STEP 3: CONNECT WITH API KEYS
// ============================================================================

// ========================================
// TOP 15 EXCHANGES CONNECTION GUIDE
// ========================================

// ----- BINANCE -----
/*
Register at: https://www.binance.com/en/register
1. Login to Binance
2. Go to API Management (Account > API)
3. Click "Create API"
4. Name your API key
5. Set permissions: Read, Spot & Margin Trading
6. Enable IP restriction (optional)
7. Save your API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('binance', 
  'YOUR_BINANCE_API_KEY',      // e.g., 'abcd1234...'
  'YOUR_BINANCE_SECRET'        // e.g., 'xyz789...'
);

// ----- COINBASE -----
/*
Register at: https://www.coinbase.com
1. Settings > API
2. Create new API key
3. Select permissions: Trade, View
4. Save API Key, Secret Key, Passphrase

Connect:
*/
await mmManager.apiConnector.connect('coinbase',
  'YOUR_COINBASE_API_KEY',
  'YOUR_COINBASE_SECRET',
  'YOUR_COINBASE_PASSPHRASE'  // Passphrase you set
);

// ----- BYBIT -----
/*
Register at: https://www.bybit.com
1. Account & Security > API
2. Create API key
3. Select permissions: Read, Trade
4. IP whitelist (optional)
5. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('bybit',
  'YOUR_BYBIT_API_KEY',
  'YOUR_BYBIT_SECRET'
);

// ----- OKX -----
/*
Register at: https://www.okx.com
1. Settings > API Management
2. Create API Key
3. Permissions: Trading, Reading
4. Save API Key, Secret, Passphrase

Connect:
*/
await mmManager.apiConnector.connect('okx',
  'YOUR_OKX_API_KEY',
  'YOUR_OKX_SECRET',
  'YOUR_OKX_PASSPHRASE'
);

// ----- KUCOIN -----
/*
Register at: https://www.kucoin.com
1. Settings > API Management
2. Create API
3. Permissions: Trade, Market, Wallet
4. Save API Key, Secret, Passphrase

Connect:
*/
await mmManager.apiConnector.connect('kucoin',
  'YOUR_KUCOIN_API_KEY',
  'YOUR_KUCOIN_SECRET',
  'YOUR_KUCOIN_PASSPHRASE'
);

// ----- GATE.IO -----
/*
Register at: https://www.gate.io
1. API Management
2. Create API Key
3. Permissions: Spot, Futures, Margin
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('gateio',
  'YOUR_GATE_API_KEY',
  'YOUR_GATE_SECRET'
);

// ----- BITGET -----
/*
Register at: https://www.bitget.com
1. Account > API Management
2. Create API Key
3. Permissions: Trade, Read
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('bitget',
  'YOUR_BITGET_API_KEY',
  'YOUR_BITGET_SECRET'
);

// ----- MEXC -----
/*
Register at: https://www.mexc.com
1. API Management
2. Create API
3. Select trading permissions
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('mexc',
  'YOUR_MEXC_API_KEY',
  'YOUR_MEXC_SECRET'
);

// ----- HUOBI -----
/*
Register at: https://www.huobi.com
1. Account > API Management
2. Create API
3. Permissions: Trade, Read
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('huobi',
  'YOUR_HUOBI_API_KEY',
  'YOUR_HUOBI_SECRET'
);

// ----- KRAKEN -----
/*
Register at: https://www.kraken.com
1. Security > API
2. Generate API Key
3. Select permissions: Query, Trade
4. Save API Key and Private Key

Connect:
*/
await mmManager.apiConnector.connect('kraken',
  'YOUR_KRAKEN_API_KEY',
  'YOUR_KRAKEN_PRIVATE_KEY'  // Note: Kraken uses private key as secret
);

// ----- COINEX -----
/*
Register at: https://www.coinex.com
1. Account > API Management
2. Create API
3. Permissions: Trade, Read
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('coinex',
  'YOUR_COINEX_API_KEY',
  'YOUR_COINEX_SECRET'
);

// ----- BITFINEX -----
/*
Register at: https://www.bitfinex.com
1. Settings > API
2. Generate API Key
3. Permissions: Trade, Read, Write
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('bitfinex',
  'YOUR_BITFINEX_API_KEY',
  'YOUR_BITFINEX_SECRET'
);

// ----- GEMINI -----
/*
Register at: https://www.gemini.com
1. Settings > API Keys
2. Create API Key
3. Select permissions
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('gemini',
  'YOUR_GEMINI_API_KEY',
  'YOUR_GEMINI_SECRET'
);

// ----- CRYPTO.COM -----
/*
Register at: https://crypto.com
1. Settings > API
2. Create API Key
3. Select scopes
4. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('cryptocom',
  'YOUR_CRYPTO_COM_API_KEY',
  'YOUR_CRYPTO_COM_SECRET'
);

// ----- ROBINHOOD -----
/*
Register at: https://robinhood.com
1. Account > API
2. Create API key (must have verified identity)
3. Save API Key

Connect:
*/
await mmManager.apiConnector.connect('robinhood',
  'YOUR_ROBINHOOD_API_KEY',
  'YOUR_ROBINHOOD_SECRET'
);

// ----- BITRUE -----
/*
Register at: https://www.bitrue.com
1. API Management
2. Create API
3. Save API Key and Secret

Connect:
*/
await mmManager.apiConnector.connect('bitrue',
  'YOUR_BITRUE_API_KEY',
  'YOUR_BITRUE_SECRET'
);

// ============================================================================
// CONNECTING DEXs (NO API KEYS NEEDED - USE WALLET)
// ============================================================================

// Using wallet connection (MetaMask/walletconnect)
/*
For DEXs like Uniswap, SushiSwap, Curve:
1. Connect wallet (MetaMask, WalletConnect)
2. No API keys needed - uses wallet signature

Example Uniswap connection:
*/

interface WalletConfig {
  connector: 'metamask' | 'walletconnect' | 'coinbase_wallet';
  chainId: number;
}

const walletConfig: WalletConfig = {
  connector: 'metamask',  // or 'walletconnect'
  chainId: 1,             // 1=Ethereum, 56=BSC, 42161=Arbitrum
};

// ============================================================================
// STEP 4: VERIFY CONNECTION
// ============================================================================

// Check connection status
const connections = mmManager.apiConnector.getAllConnections();
console.log('Connected exchanges:', connections.map(c => c.id));

// Get supported exchanges
const apis = mmManager.apiConnector.getAvailableAPIs();
console.log('Total available:', apis.length);

// ============================================================================
// EXAMPLE: PLACE ORDERS ON CONNECTED EXCHANGE
// ============================================================================

// Place Spot Order on Binance
const spotResult = await mmManager.apiConnector.placeOrder('binance', {
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  quantity: 0.001,
  price: 50000,
});

// Place Futures Order on Bybit
const futuresResult = await mmManager.apiConnector.placeOrder('bybit', {
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  quantity: 0.001,
  price: 50000,
});

// Place Margin Order
const marginResult = await mmManager.apiConnector.placeOrder('binance', {
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  quantity: 0.001,
  price: 50000,
});

// ============================================================================
// GET BALANCE FROM EXCHANGE
// ============================================================================

const balance = await mmManager.apiConnector.getBalance('binance');
console.log('Binance balance:', balance);

// ============================================================================
// COMPLETE CODE TEMPLATE
// ============================================================================

/*

// Complete Example - Connect to multiple exchanges and trade:

import { MMOperationManager } from './market_making_and_liquidity/mm_complete_operations';

async function main() {
  // Initialize
  const mm = new MMOperationManager();
  
  // Connect exchanges
  const exchanges = [
    { id: 'binance', apiKey: 'KEY', secret: 'SECRET' },
    { id: 'bybit', apiKey: 'KEY', secret: 'SECRET' },
    { id: 'okx', apiKey: 'KEY', secret: 'SECRET', passphrase: 'PASS' },
  ];
  
  for (const exch of exchanges) {
    await mm.apiConnector.connect(
      exch.id, 
      exch.apiKey, 
      exch.secret, 
      exch.passphrase
    );
  }
  
  // Get connection status
  const status = mm.apiConnector.getAllConnections();
  console.log('Connected:', status.length);
  
  // Trade on first exchange
  await mm.apiConnector.placeOrder('binance', {
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'limit',
    quantity: 0.001,
    price: 50000,
  });
}

main();

*/

// ============================================================================
// CEX CONNECTION SUMMARY TABLE
// ============================================================================

export const CEX_CONNECTION_GUIDE = `
╔═══════════════╦══════════════════╦═════════════╦════════════════════════╗
║ Exchange     ║ API Key          ║ Secret     ║ Extra Params          ║
╠═══════════════╬══════════════════╬═════════════╬════════════════════════╣
║ Binance     ║ Required        ║ Required   ║ -                   ║
║ Coinbase   ║ Required        ║ Required   ║ Passphrase           ║
║ Bybit       ║ Required        ║ Required   ║ -                   ║
║ OKX         ║ Required        ║ Required   ║ Passphrase           ║
║ KuCoin      ║ Required        ║ Required   ║ Passphrase           ║
║ Gate.io    ║ Required        ║ Required   ║ -                   ║
║ Bitget     ║ Required        ║ Required   ║ -                   ║
║ MEXC       ║ Required        ║ Required   ║ -                   ║
║ Huobi      ║ Required        ║ Required   ║ -                   ║
║ Kraken     ║ Required        ║ PrivateKey║ -                   ║
║ CoinEx     ║ Required        ║ Required   ║ -                   ║
║ Bitfinex  ║ Required        ║ Required   ║ -                   ║
║ Gemini     ║ Required        ║ Required   ║ -                   ║
║ Crypto.com║ Required        ║ Required   ║ -                   ║
║ Robinhood ║ Required        ║ Required   ║ -                   ║
╚══════════════╩══════════════════╩═════════════╩════════════════════════╝

For 300+ more exchanges, use same pattern:
await mm.apiConnector.connect('EXCHANGE_ID', apiKey, apiSecret);
`;

export default CEX_CONNECTION_GUIDE;