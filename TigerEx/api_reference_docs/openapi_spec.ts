/**
 * TigerEx API Specification
 * OpenAPI 3.0
 */

const API_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'TigerEx API',
    version: '1.0.0',
    description: 'Professional crypto exchange API'
  },
  servers: [
    { url: 'https://api.tigerex.io', description: 'Production' }
  ],
  paths: {
    '/api/v1/auth/register': {
      post: {
        summary: 'Register',
        tags: ['Auth'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { '201': { description: 'Created' } }
      }
    },
    '/api/v1/auth/login': { post: { summary: 'Login', tags: ['Auth'], responses: { '200': {} } } },
    '/api/v1/user/profile': { get: { summary: 'Profile', tags: ['User'], security: [{Bearer:[]}], responses: { '200': {} } } },
    '/api/v1/wallets': { get: { summary: 'Wallets', tags: ['Wallet'], responses: { '200': {} } } },
    '/api/v1/wallets/{currency}/deposit': { post: { summary: 'Deposit', tags: ['Wallet'], responses: { '200': {} } } },
    '/api/v1/wallets/{currency}/withdraw': { post: { summary: 'Withdraw', tags: ['Wallet'], responses: { '200': {} } } },
    '/api/v1/orders': {
      get: { summary: 'Get Orders', tags: ['Trading'], responses: { '200': {} } },
      post: { summary: 'Create Order', tags: ['Trading'], responses: { '200': {} } }
    },
    '/api/v1/orders/{id}': { delete: { summary: 'Cancel Order', tags: ['Trading'], responses: { '200': {} } } },
    '/api/v1/market/ticker/{symbol}': { get: { summary: 'Ticker', tags: ['Market'], responses: { '200': {} } } },
    '/api/v1/market/orderbook/{symbol}': { get: { summary: 'OrderBook', tags: ['Market'], responses: { '200': {} } } },
    '/api/v1/market/trades/{symbol}': { get: { summary: 'Trades', tags: ['Market'], responses: { '200': {} } } },
    '/api/v1/market/klines': { get: { summary: 'Klines', tags: ['Market'], responses: { '200': {} } } },
  },
  components: {
    schemas: {
      Order: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          side: { type: 'string', enum: ['BUY', 'SELL'] },
          type: { type: 'string', enum: ['LIMIT', 'MARKET'] },
          quantity: { type: 'number' },
          price: { type: 'number' }
        }
      }
    },
    securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } }
  }
};

export default API_SPEC;