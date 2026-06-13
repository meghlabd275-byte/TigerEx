"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  TrendingUp, 
  TrendingDown, 
  LineChart,
  Building,
  Globe,
  ArrowRight,
  Clock,
  Info,
  Wallet
} from "lucide-react";

const STOCKS_DATA = [
  { symbol: "AAPL", name: "Apple Inc.", price: 189.45, change: 1.23, high: 192.30, low: 187.50, volume: 45.6M },
  { symbol: "GOOGL", name: "Alphabet Inc.", price: 142.67, change: -0.89, high: 145.20, low: 141.00, volume: 23.4M },
  { symbol: "MSFT", name: "Microsoft", price: 378.91, change: 2.45, high: 382.50, low: 375.20, volume: 18.9M },
  { symbol: "AMZN", name: "Amazon.com", price: 178.23, change: 1.78, high: 180.50, low: 176.20, volume: 34.5M },
  { symbol: "TSLA", name: "Tesla Inc.", price: 245.67, change: -3.45, high: 252.30, low: 243.10, volume: 89.2M },
  { symbol: "NVDA", name: "NVIDIA", price: 456.78, change: 4.56, high: 462.10, low: 448.90, volume: 42.3M },
  { symbol: "META", name: "Meta Platforms", price: 489.12, change: 2.34, high: 495.30, low: 482.50, volume: 15.6M },
  { symbol: "JPM", name: "JPMorgan Chase", price: 189.45, change: 0.67, high: 191.20, low: 187.90, volume: 8.9M },
];

const INDICES_DATA = [
  { symbol: "US30", name: "US Wall Street 30", price: 38945.67, change: 0.45 },
  { symbol: "US500", name: "US S&P 500", price: 5234.56, change: 0.78 },
  { symbol: "NAS100", name: "US Nasdaq 100", price: 18234.67, change: 1.23 },
  { symbol: "GER40", name: "Germany 40", price: 18234.45, change: -0.34 },
  { symbol: "UK100", name: "UK FTSE 100", price: 8234.56, change: 0.23 },
];

const FOREX_DATA = [
  { symbol: "EUR/USD", name: "Euro / US Dollar", price: 1.0876, change: 0.12 },
  { symbol: "GBP/USD", name: "British Pound / US Dollar", price: 1.2645, change: -0.08 },
  { symbol: "USD/JPY", name: "US Dollar / Japanese Yen", price: 156.78, change: 0.23 },
  { symbol: "AUD/USD", name: "Australian Dollar / US Dollar", price: 0.6543, change: 0.34 },
];

export default function TradFiPage() {
  const [category, setCategory] = useState("stocks");
  const [selectedStock, setSelectedStock] = useState(STOCKS_DATA[0]);
  const [leverage, setLeverage] = useState(5);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
                <span className="text-xl font-bold text-white">T</span>
              </div>
              <span className="text-xl font-bold text-white">TigerEx</span>
            </Link>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/markets" className="text-sm text-gray-300 hover:text-white transition-colors">Markets</Link>
            <Link href="/trade/BTC-USDT" className="text-sm text-gray-300 hover:text-white transition-colors">Spot</Link>
            <Link href="/tradfi" className="text-sm text-tiger-orange hover:text-white transition-colors">TradeFi</Link>
            <Link href="/futures" className="text-sm text-gray-300 hover:text-white transition-colors">Futures</Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">Earn</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/wallet">
              <button className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/5">Wallet</button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">TradFi Trading</h1>
          <p className="text-gray-400">Trade Stocks, Indices, and Forex with leverage</p>
        </div>

        {/* Category Tabs */}
        <div className="mb-6 flex gap-2">
          {[
            { id: "stocks", label: "Stocks CFD", icon: Building },
            { id: "indices", label: "Indices", icon: LineChart },
            { id: "forex", label: "Forex", icon: Globe },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 ${
                category === cat.id 
                  ? "bg-tiger-orange text-white" 
                  : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              <cat.icon className="h-4 w-4" />
              {cat.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Left - Market List */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">
              {category === "stocks" ? "Stocks" : category === "indices" ? "Indices" : "Forex Pairs"}
            </h3>
            
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {category === "stocks" && STOCKS_DATA.map((stock) => (
                <button
                  key={stock.symbol}
                  onClick={() => setSelectedStock(stock)}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                    selectedStock.symbol === stock.symbol 
                      ? "bg-tiger-orange/20 border border-tiger-orange" 
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{stock.symbol}</span>
                    <span className={`font-mono ${stock.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {stock.change >= 0 ? "+" : ""}{stock.change}%
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-400">{stock.name}</div>
                  <div className="mt-1 font-mono text-white">${stock.price}</div>
                </button>
              ))}
              
              {category === "indices" && INDICES_DATA.map((idx) => (
                <button key={idx.symbol} className="w-full rounded-lg p-3 text-left hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{idx.symbol}</span>
                    <span className={`font-mono ${idx.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {idx.change >= 0 ? "+" : ""}{idx.change}%
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-white">${idx.price.toLocaleString()}</div>
                </button>
              ))}
              
              {category === "forex" && FOREX_DATA.map((fx) => (
                <button key={fx.symbol} className="w-full rounded-lg p-3 text-left hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{fx.symbol}</span>
                    <span className={`font-mono ${fx.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fx.change >= 0 ? "+" : ""}{fx.change}%
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-white">{fx.price}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Center - Order Entry */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            {/* Stock Info */}
            <div className="mb-4 rounded-lg bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-white">{selectedStock.symbol}</div>
                  <div className="text-gray-400">{selectedStock.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-white font-mono">${selectedStock.price}</div>
                  <div className={`font-mono ${selectedStock.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {selectedStock.change >= 0 ? "+" : ""}{selectedStock.change}%
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-gray-400">
                <div>High: <span className="text-white">${selectedStock.high}</span></div>
                <div>Low: <span className="text-white">${selectedStock.low}</span></div>
                <div>Vol: <span className="text-white">{selectedStock.volume}</span></div>
              </div>
            </div>

            {/* Leverage */}
            <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-400">Leverage</span>
                <span className="font-mono text-white">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full accent-tiger-orange"
              />
            </div>

            {/* Buy/Sell */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setOrderSide("buy")}
                className={`rounded-lg py-3 font-bold transition-colors ${
                  orderSide === "buy" 
                    ? "bg-green-600 text-white" 
                    : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                }`}
              >
                🟢 Buy / Long
              </button>
              <button
                onClick={() => setOrderSide("sell")}
                className={`rounded-lg py-3 font-bold transition-colors ${
                  orderSide === "sell" 
                    ? "bg-red-600 text-white" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                }`}
              >
                🔴 Sell / Short
              </button>
            </div>

            {/* Quantity */}
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Quantity (Shares)</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
              />
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    className="rounded border border-white/10 py-2 text-xs text-gray-400 hover:bg-white/5 hover:text-white"
                    onClick={() => setQuantity(q.toString())}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              className={`w-full rounded-lg py-4 font-bold text-white ${
                orderSide === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {orderSide === "buy" ? "Buy" : "Sell"} {selectedStock.symbol}
            </button>

            {/* Order Summary */}
            <div className="mt-4 rounded-lg bg-white/5 p-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Position Value</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Margin Required</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Leverage</span>
                <span className="font-mono text-white">{leverage}x</span>
              </div>
            </div>
          </div>

          {/* Right - Info */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Market Hours</h3>
            
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-gray-400">
                <Clock className="h-4 w-4" />
                <span className="text-sm">US Markets</span>
              </div>
              <div className="mt-1 font-mono text-white">09:30 - 16:00 EST</div>
              <div className="text-xs text-gray-500">Mon-Fri</div>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-gray-400">
                <Info className="h-4 w-4" />
                <span className="text-sm">Overnight Trading</span>
              </div>
              <div className="mt-1 text-sm text-gray-400">
                Available 24/5 with wider spreads
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold text-white">Features</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-tiger-orange" />
                  Up to 20x leverage
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-tiger-orange" />
                  No commissions
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-tiger-orange" />
                  24/5 trading
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-tiger-orange" />
                  Long/Short positions
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}