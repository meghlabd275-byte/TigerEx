"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  ArrowRight, 
  RefreshCw, 
  Settings, 
  Star, 
  TrendingUp, 
  TrendingDown,
  ChevronDown,
  Wallet,
  Clock,
  Activity,
  BarChart3,
  List,
  AlertTriangle
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Types
interface Order {
  price: number;
  quantity: number;
  total: number;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  time: string;
  isBuyerMaker: boolean;
}

interface Position {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Demo data
const generateCandles = (): Candle[] => {
  const candles: Candle[] = [];
  let price = 45000;
  const now = Date.now();
  
  for (let i = 100; i >= 0; i--) {
    const open = price;
    const change = (Math.random() - 0.5) * 500;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * 100;
    const low = Math.min(open, close) - Math.random() * 100;
    
    candles.push({
      time: now - i * 60000,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000,
    });
    
    price = close;
  }
  
  return candles;
};

const generateOrderBook = (): { bids: Order[]; asks: Order[] } => {
  const basePrice = 45000;
  const bids: Order[] = [];
  const asks: Order[] = [];
  
  for (let i = 0; i < 15; i++) {
    const bidPrice = basePrice - i * 5 - Math.random() * 2;
    const askPrice = basePrice + (i + 1) * 5 + Math.random() * 2;
    const quantity = Math.random() * 10 + 0.1;
    
    bids.push({
      price: bidPrice,
      quantity: parseFloat(quantity.toFixed(4)),
      total: parseFloat((bidPrice * quantity).toFixed(2)),
    });
    
    asks.push({
      price: askPrice,
      quantity: parseFloat(quantity.toFixed(4)),
      total: parseFloat((askPrice * quantity).toFixed(2)),
    });
  }
  
  return { bids, asks };
};

const generateRecentTrades = (): Trade[] => {
  const trades: Trade[] = [];
  const now = Date.now();
  let price = 45000;
  
  for (let i = 0; i < 20; i++) {
    price += (Math.random() - 0.5) * 10;
    trades.push({
      id: `trade-${i}`,
      price: parseFloat(price.toFixed(2)),
      quantity: parseFloat((Math.random() * 2).toFixed(4)),
      time: new Date(now - i * 5000).toLocaleTimeString(),
      isBuyerMaker: Math.random() > 0.5,
    });
  }
  
  return trades;
};

const tradingPairs = [
  { symbol: 'BTC/USDT', price: 45123.50, change: 2.34 },
  { symbol: 'ETH/USDT', price: 2456.80, change: -1.23 },
  { symbol: 'BNB/USDT', price: 312.45, change: 0.87 },
  { symbol: 'SOL/USDT', price: 98.76, change: 5.67 },
  { symbol: 'XRP/USDT', price: 0.5234, change: -0.45 },
];

export default function SpotTradingPage() {
  // State
  const [selectedPair, setSelectedPair] = useState('BTC/USDT');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP_LIMIT'>('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [orderBook, setOrderBook] = useState(generateOrderBook());
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [lastPrice, setLastPrice] = useState(45123.50);
  const [priceChange, setPriceChange] = useState(2.34);
  const [high24h, setHigh24h] = useState(46200);
  const [low24h, setLow24h] = useState(43800);
  const [volume24h, setVolume24h] = useState('2.45B');
  const [showTradingPairs, setShowTradingPairs] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'positions' | 'history'>('orders');

  // Initialize data
  useEffect(() => {
    setCandles(generateCandles());
    setRecentTrades(generateRecentTrades());
    
    // Simulate real-time updates
    const interval = setInterval(() => {
      setOrderBook(generateOrderBook());
      setLastPrice(prev => {
        const change = (Math.random() - 0.5) * 20;
        return parseFloat((prev + change).toFixed(2));
      });
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // Calculate totals
  const total = useCallback(() => {
    const p = orderType === 'MARKET' ? lastPrice : parseFloat(price || '0');
    const q = parseFloat(quantity || '0');
    return parseFloat((p * q).toFixed(2));
  }, [price, quantity, orderType, lastPrice]);

  // Max quantity calculation (for 100% balance)
  const maxQuantity = useCallback((percentage: number) => {
    // Demo: assume user has 10000 USDT
    const balance = 10000;
    const effectivePrice = orderType === 'MARKET' ? lastPrice : parseFloat(price || '0');
    if (effectivePrice === 0) return '0';
    return parseFloat(((balance * percentage / 100) / effectivePrice).toFixed(6));
  }, [price, orderType, lastPrice]);

  // Format numbers
  const formatNumber = (num: number, decimals = 2): string => {
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  // Get max bid/ask
  const maxBidTotal = Math.max(...orderBook.bids.map(b => b.total));
  const maxAskTotal = Math.max(...orderBook.asks.map(a => a.total));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-[1800px] mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">T</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx</span>
              </Link>
              
              {/* Trading Pair Selector */}
              <div className="relative">
                <button 
                  onClick={() => setShowTradingPairs(!showTradingPairs)}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <span className="font-bold text-gray-900 dark:text-white">{selectedPair}</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>
                
                {showTradingPairs && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
                    {tradingPairs.map(pair => (
                      <button
                        key={pair.symbol}
                        onClick={() => {
                          setSelectedPair(pair.symbol);
                          setShowTradingPairs(false);
                        }}
                        className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{pair.symbol}</span>
                        <span className={`${pair.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pair.change >= 0 ? '+' : ''}{pair.change}%
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Price Info */}
            <div className="flex items-center space-x-6">
              <div>
                <div className="flex items-center space-x-2">
                  <span className={`text-2xl font-bold ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ${formatNumber(lastPrice)}
                  </span>
                  {priceChange >= 0 ? (
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-500" />
                  )}
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span>24h Change: <span className={priceChange >= 0 ? 'text-green-500' : 'text-red-500'}>{priceChange >= 0 ? '+' : ''}{priceChange}%</span></span>
                  <span>24h High: ${formatNumber(high24h)}</span>
                  <span>24h Low: ${formatNumber(low24h)}</span>
                  <span>24h Vol: {volume24h}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <ThemeToggle />
              <Link href="/wallet" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <Wallet className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-4 py-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Left Panel - Order Book */}
          <div className="col-span-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Order Book</h3>
            </div>
            
            {/* Asks (Sell) */}
            <div className="p-2">
              <div className="grid grid-cols-3 text-xs text-gray-500 mb-1">
                <span>Price(USDT)</span>
                <span className="text-right">Amount(BTC)</span>
                <span className="text-right">Total</span>
              </div>
              <div className="space-y-px">
                {orderBook.asks.slice(0, 10).reverse().map((ask, i) => (
                  <div key={i} className="grid grid-cols-3 text-xs py-0.5 relative">
                    <div 
                      className="absolute right-0 top-0 bottom-0 bg-red-500/20" 
                      style={{ width: `${(ask.total / maxAskTotal) * 100}%` }}
                    />
                    <span className="text-red-500 relative z-10">{formatNumber(ask.price)}</span>
                    <span className="text-right text-gray-900 dark:text-gray-100 relative z-10">{formatNumber(ask.quantity, 4)}</span>
                    <span className="text-right text-gray-500 relative z-10">{formatNumber(ask.total)}</span>
                  </div>
                ))}
              </div>
              
              {/* Current Price */}
              <div className="py-2 border-y border-gray-200 dark:border-gray-700 my-2">
                <span className={`text-lg font-bold ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${formatNumber(lastPrice)}
                </span>
              </div>
              
              {/* Bids (Buy) */}
              <div className="space-y-px">
                {orderBook.bids.slice(0, 10).map((bid, i) => (
                  <div key={i} className="grid grid-cols-3 text-xs py-0.5 relative">
                    <div 
                      className="absolute right-0 top-0 bottom-0 bg-green-500/20" 
                      style={{ width: `${(bid.total / maxBidTotal) * 100}%` }}
                    />
                    <span className="text-green-500 relative z-10">{formatNumber(bid.price)}</span>
                    <span className="text-right text-gray-900 dark:text-gray-100 relative z-10">{formatNumber(bid.quantity, 4)}</span>
                    <span className="text-right text-gray-500 relative z-10">{formatNumber(bid.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center Panel - Chart */}
          <div className="col-span-7 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            {/* Chart Header */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white">
                  Time
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <RefreshCw className="w-4 h-4 text-gray-500" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Settings className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>
            
            {/* Chart Area */}
            <div className="h-[500px] p-4 flex items-center justify-center">
              <div className="w-full h-full relative">
                {/* Simple candle chart visualization */}
                <div className="absolute inset-0 flex items-end justify-between px-2">
                  {candles.slice(-50).map((candle, i) => {
                    const height = ((candle.high - candle.low) / candle.high) * 100;
                    const bodyTop = ((candle.high - Math.max(candle.open, candle.close)) / candle.high) * 100;
                    const bodyBottom = ((candle.high - Math.min(candle.open, candle.close)) / candle.high) * 100;
                    const isGreen = candle.close >= candle.open;
                    
                    return (
                      <div 
                        key={i} 
                        className="flex-1 mx-px relative"
                        style={{ height: '100%' }}
                      >
                        {/* Wick */}
                        <div 
                          className={`absolute w-0.5 left-1/2 transform -translate-x-1/2 ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ 
                            top: `${bodyTop}%`, 
                            height: `${bodyBottom - bodyTop + 2}%` 
                          }}
                        />
                        {/* Body */}
                        <div 
                          className={`absolute w-1.5 left-1/2 transform -translate-x-1/2 ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ 
                            top: `${bodyTop}%`, 
                            height: `${Math.max(bodyBottom - bodyTop, 1)}%` 
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white/90 dark:from-gray-800/90 to-transparent flex flex-col justify-between py-2 text-xs text-gray-500">
                  <span>${formatNumber(high24h)}</span>
                  <span>${formatNumber((high24h + low24h) / 2)}</span>
                  <span>${formatNumber(low24h)}</span>
                </div>
              </div>
            </div>
            
            {/* Recent Trades */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Recent Trades</h3>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="px-3 py-1 text-left">Price(USDT)</th>
                      <th className="px-3 py-1 text-right">Amount(BTC)</th>
                      <th className="px-3 py-1 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.slice(0, 15).map(trade => (
                      <tr key={trade.id}>
                        <td className={`px-3 py-0.5 ${trade.isBuyerMaker ? 'text-green-500' : 'text-red-500'}`}>
                          {formatNumber(trade.price)}
                        </td>
                        <td className="px-3 py-0.5 text-right text-gray-900 dark:text-gray-100">
                          {formatNumber(trade.quantity, 4)}
                        </td>
                        <td className="px-3 py-0.5 text-right text-gray-500">
                          {trade.time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Panel - Order Form */}
          <div className="col-span-3 space-y-4">
            {/* Buy/Sell Tabs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2">
                <button
                  onClick={() => setOrderSide('BUY')}
                  className={`py-3 font-semibold ${orderSide === 'BUY' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'} rounded-l-lg`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setOrderSide('SELL')}
                  className={`py-3 font-semibold ${orderSide === 'SELL' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'} rounded-r-lg`}
                >
                  Sell
                </button>
              </div>

              {/* Order Type */}
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-1">
                  {(['LIMIT', 'MARKET', 'STOP_LIMIT'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setOrderType(type)}
                      className={`flex-1 py-1.5 text-sm rounded ${orderType === type ? 'bg-orange-500 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                      {type === 'LIMIT' ? 'Limit' : type === 'MARKET' ? 'Market' : 'Stop-Limit'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Order Form */}
              <div className="p-3 space-y-3">
                {/* Price */}
                {orderType !== 'MARKET' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price (USDT)</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded text-gray-900 dark:text-white"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDT</span>
                    </div>
                  </div>
                )}

                {/* Stop Price */}
                {orderType === 'STOP_LIMIT' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Stop Price (USDT)</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={stopPrice}
                        onChange={(e) => setStopPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded text-gray-900 dark:text-white"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDT</span>
                    </div>
                  </div>
                )}

                {/* Amount */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-500">Amount (BTC)</label>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded text-gray-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">BTC</span>
                  </div>
                  
                  {/* Quick buttons */}
                  <div className="flex items-center space-x-1 mt-2">
                    {[25, 50, 75, 100].map(pct => (
                      <button
                        key={pct}
                        onClick={() => setQuantity(String(maxQuantity(pct)))}
                        className="flex-1 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Total (USDT)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={total() > 0 ? formatNumber(total()) : ''}
                      readOnly
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded text-gray-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDT</span>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  className={`w-full py-3 rounded-lg font-semibold text-white ${orderSide === 'BUY' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                >
                  {orderSide === 'BUY' ? 'Buy BTC' : 'Sell BTC'}
                </button>
              </div>
            </div>

            {/* Available Balance */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Available</span>
                <span className="text-gray-900 dark:text-white font-medium">10,000.00 USDT</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-gray-500">Available</span>
                <span className="text-gray-900 dark:text-white font-medium">0.00 BTC</span>
              </div>
            </div>

            {/* Open Orders Tab */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex border-b border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex-1 py-2 text-sm font-medium ${activeTab === 'orders' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-gray-500'}`}
                >
                  Open Orders
                </button>
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`flex-1 py-2 text-sm font-medium ${activeTab === 'positions' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-gray-500'}`}
                >
                  Positions
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 py-2 text-sm font-medium ${activeTab === 'history' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-gray-500'}`}
                >
                  History
                </button>
              </div>
              
              <div className="p-4">
                {activeTab === 'orders' && (
                  <div className="text-center text-gray-500 py-8">
                    <List className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No open orders</p>
                  </div>
                )}
                {activeTab === 'positions' && (
                  <div className="text-center text-gray-500 py-8">
                    <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No positions</p>
                  </div>
                )}
                {activeTab === 'history' && (
                  <div className="text-center text-gray-500 py-8">
                    <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No order history</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
