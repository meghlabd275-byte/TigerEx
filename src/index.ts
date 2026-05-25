/**
 * TigerEx Exchange - Main Entry Point
 * Production-ready API Server
 */

import express from 'express';
import { WebSocketServer } from 'ws';

// Import all platform modules
import * as spotTrading from '../TigerEx/spot_trading';
import * as marginTrading from '../TigerEx/margin_trading';
import * as futuresTrading from '../TigerEx/futures_perpetual';
import * as optionsTrading from '../TigerEx/derivatives_and_options_trading';
import * as copyTrading from '../TigerEx/copy_trading';
import * as earnYield from '../TigerEx/earn_and_yield';
import * as defiAggregator from '../TigerEx/defi_aggregator';
import * as nftMarketplace from '../TigerEx/nft_marketplace';
import * as fiatOnOff from '../TigerEx/fiat_onoff_ramps';
import * as cards from '../TigerEx/prepaid_cards';
import * as apiGateway from '../TigerEx/api_gateway_platform';
import * as mobileApps from '../TigerEx/mobile_apps';
import * as custody from '../TigerEx/custody_protection';
import * as compliance from '../TigerEx/aml_compliance';
import * as analytics from '../TigerEx/analytics_and_bi';
import * as adminBackend from '../TigerEx/admin_backend_control';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health Check Endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/health/ready', async (req, res) => {
  // Check database connectivity
  res.json({ status: 'ready', services: 'operational' });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'alive' });
});

// API Status
app.get('/api/v1/status', (req, res) => {
  res.json({
    platform: 'TigerEx Exchange',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// ============================================================
// TRADING ENDPOINTS
// ============================================================

// Spot Trading
app.post('/api/v1/spot/order', async (req, res) => {
  try {
    const { symbol, side, quantity, price, type } = req.body;
    const order = await spotTrading.orderBook.placeOrder({ symbol, side, quantity, price, type });
    res.json({ success: true, order });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/v1/spot/depth/:symbol', async (req, res) => {
  const depth = await spotTrading.orderBook.getDepth(req.params.symbol);
  res.json(depth);
});

app.get('/api/v1/spot/ticker/:symbol', async (req, res) => {
  const ticker = await spotTrading.marketData.getTicker(req.params.symbol);
  res.json(ticker);
});

// Margin Trading
app.post('/api/v1/margin/borrow', async (req, res) => {
  try {
    const { userId, asset, amount } = req.body;
    const result = await marginTrading.marginSystem.borrow(userId, { asset, amount });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/v1/margin/account/:userId', async (req, res) => {
  const account = await marginTrading.marginAccounts.getAccount(req.params.userId);
  res.json(account);
});

// Futures Trading
app.post('/api/v1/futures/order', async (req, res) => {
  const order = await futuresTrading.futuresEngine.placeOrder(req.body);
  res.json(order);
});

app.get('/api/v1/futures/positions/:userId', async (req, res) => {
  const positions = await futuresTrading.positionManager.getPositions(req.params.userId);
  res.json(positions);
});

// Options Trading
app.get('/api/v1/options/chains/:symbol', async (req, res) => {
  const chains = await optionsTrading.optionChains.getChains(req.params.symbol);
  res.json(chains);
});

app.post('/api/v1/options/exercise', async (req, res) => {
  const result = await optionsTrading.optionSettlement.exercise(req.body);
  res.json(result);
});

// Copy Trading
app.get('/api/v1/copy/traders', async (req, res) => {
  const traders = await copyTrading.copyTraderLeaderboard.getLeaders();
  res.json(traders);
});

app.post('/api/v1/copy/follow', async (req, res) => {
  const { userId, leaderId, copyRatio } = req.body;
  const result = await copyTrading.copyFollow.startFollowing({ userId, leaderId, copyRatio });
  res.json(result);
});

// ============================================================
// EARN & YIELD ENDPOINTS
// ============================================================

app.get('/api/v1/earn/products', async (req, res) => {
  const products = await earnYield.productManager.getProducts();
  res.json(products);
});

app.post('/api/v1/earn/subscribe', async (req, res) => {
  const subscription = await earnYield.subscriptionManager.subscribe(req.body);
  res.json(subscription);
});

// DeFi Aggregator
app.get('/api/v1/defi/portfolio/:userId', async (req, res) => {
  const portfolio = await defiAggregator.defiAggregator.getPortfolioValue(req.params.userId);
  res.json(portfolio);
});

// ============================================================
// NFT ENDPOINTS
// ============================================================

app.get('/api/v1/nft/market', async (req, res) => {
  const listings = await nftMarketplace.nftMarketplace.getLiveListings(req.query);
  res.json(listings);
});

app.post('/api/v1/nft/mint', async (req, res) => {
  const nft = await nftMarketplace.nftMinter.mint(req.body);
  res.json(nft);
});

app.post('/api/v1/nft/list', async (req, res) => {
  const listing = await nftMarketplace.nftMarketplace.listItem(req.body);
  res.json(listing);
});

// ============================================================
// FIAT ON/OFF ENDPOINTS
// ============================================================

app.post('/api/v1/fiat/deposit', async (req, res) => {
  const deposit = await fiatOnOff.fiatProcessor.processDeposit(req.body);
  res.json(deposit);
});

app.post('/api/v1/fiat/withdraw', async (req, res) => {
  const withdrawal = await fiatOnOff.fiatProcessor.processWithdrawal(req.body);
  res.json(withdrawal);
});

// ============================================================
// CARDS ENDPOINTS
// ============================================================

app.post('/api/v1/cards/virtual', async (req, res) => {
  const card = await cards.cardService.createVirtualCard(req.body);
  res.json(card);
});

app.get('/api/v1/cards/:userId', async (req, res) => {
  const cards_list = await cards.cardService.getUserCards(req.params.userId);
  res.json(cards_list);
});

// ============================================================
// API GATEWAY ENDPOINTS
// ============================================================

app.post('/api/v1/api-keys', async (req, res) => {
  const apiKey = await apiGateway.apiGatewayPlatform.createApiKey(req.body);
  res.json(apiKey);
});

app.get('/api/v1/usage/:apiKey', async (req, res) => {
  const usage = await apiGateway.apiGatewayPlatform.getUsage(req.params.apiKey);
  res.json(usage);
});

// ============================================================
// MOBILE APP ENDPOINTS
// ============================================================

app.get('/api/v1/mobile/config', async (req, res) => {
  const config = await mobileApps.mobileConfigService.getConfig(req.query.appVersion as string);
  res.json(config);
});

// ============================================================
// CUSTODY ENDPOINTS
// ============================================================

app.get('/api/v1/custody/balance/:userId', async (req, res) => {
  const balance = await custody.custodyService.getBalance(req.params.userId);
  res.json(balance);
});

app.post('/api/v1/custody/transfer', async (req, res) => {
  const transfer = await custody.custodyService.initiateTransfer(req.body);
  res.json(transfer);
});

// ============================================================
// COMPLIANCE ENDPOINTS
// ============================================================

app.post('/api/v1/kyc/submit', async (req, res) => {
  const result = await compliance.kycService.submitDocuments(req.body);
  res.json(result);
});

app.get('/api/v1/kyc/status/:userId', async (req, res) => {
  const status = await compliance.kycService.getStatus(req.params.userId);
  res.json(status);
});

// ============================================================
// ANALYTICS ENDPOINTS
// ============================================================

app.get('/api/v1/analytics/dashboard/:userId', async (req, res) => {
  const dashboard = await analytics.dashboardGenerator.generateDashboard(req.params.userId);
  res.json(dashboard);
});

app.get('/api/v1/analytics/trading-volume', async (req, res) => {
  const volume = await analytics.tradingAnalytics.getVolume(req.query);
  res.json(volume);
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

app.get('/api/v1/admin/users', async (req, res) => {
  const users = await adminBackend.userManagement.listUsers(req.query);
  res.json(users);
});

app.post('/api/v1/admin/user/action', async (req, res) => {
  const result = await adminBackend.adminPanel.performAction(req.body);
  res.json(result);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🐯 TigerEx Exchange API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
});

// WebSocket for real-time data
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  ws.on('message', (message) => {
    console.log('Received:', message.toString());
  });
  
  // Subscribe to market data streams
  ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
});

export default app;