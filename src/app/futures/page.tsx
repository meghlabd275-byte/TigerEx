"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  TrendingUp, 
  TrendingDown, 
  Info,
  Settings,
  ArrowUpDown,
  Clock,
  Zap,
  Target,
  AlertTriangle
} from "lucide-react";

const FUTURES_PAIRS = [
  { symbol: "BTC/USDT", price: 67234.56, change: 2.34, funding: 0.0100, openInterest: 245.6M, volume: 12.4B },
  { symbol: "ETH/USDT", price: 3456.78, change: 1.89, funding: 0.0100, openInterest: 89.4M, volume: 8.9B },
  { symbol: "SOL/USDT", price: 145.67, change: 5.67, funding: 0.0200, openInterest: 12.3M, volume: 2.1B },
  { symbol: "BNB/USDT", price: 567.89, change: -0.45, funding: 0.0100, openInterest: 8.9M, volume: 1.2B },
  { symbol: "XRP/USDT", price: 0.5234, change: -2.34, funding: 0.0100, openInterest: 5.6M, volume: 890M },
  { symbol: "DOGE/USDT", price: 0.1234, change: 8.90, funding: 0.0300, openInterest: 3.4M, volume: 567M },
];

const POSITIONS = [
  { id: 1, symbol: "BTC/USDT", side: "long", size: 0.5, entryPrice: 65000, currentPrice: 67234.56, pnl: 1117.28, leverage: 10 },
  { id: 2, symbol: "ETH/USDT", side: "short", size: 2.0, entryPrice: 3600, currentPrice: 3456.78, pnl: 286.44, leverage: 5 },
];

export default function FuturesPage() {
  const [leverage, setLeverage] = useState(10);
  const [selectedPair, setSelectedPair] = useState(FUTURES_PAIRS[0]);
  const [orderSide, setOrderSide] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState(selectedPair.price);
  const [quantity, setQuantity] = useState("");

  const calculatePnL = (entry: number, current: number, size: number, isLong: boolean, lev: number) => {
    const multiplier = isLong ? 1 : -1;
    const pnl = ((current - entry) / entry) * size * lev * multiplier;
    return pnl;
  };

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
            <Link href="/futures" className="text-sm text-tiger-orange hover:text-white transition-colors">Futures</Link>
            <Link href="/margin" className="text-sm text-gray-300 hover:text-white transition-colors">Margin</Link>
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
        {/* Futures Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Futures Trading</h1>
            <p className="text-gray-400">Perpetual contracts with up to 125x leverage</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-1">
              <button className="rounded px-4 py-2 text-sm text-gray-300 hover:text-white">USDT-M</button>
              <button className="rounded bg-white/10 px-4 py-2 text-sm text-white">COIN-M</button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Left Sidebar - Markets */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Markets</h3>
            <div className="space-y-2">
              {FUTURES_PAIRS.map((pair) => (
                <button
                  key={pair.symbol}
                  onClick={() => { setSelectedPair(pair); setPrice(pair.price); }}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                    selectedPair.symbol === pair.symbol 
                      ? "bg-tiger-orange/20 border border-tiger-orange" 
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{pair.symbol}</span>
                    <span className={`font-mono ${pair.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pair.change >= 0 ? "+" : ""}{pair.change}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-mono text-gray-300">${pair.price.toLocaleString()}</span>
                    <span className="text-gray-400 text-xs">Vol: {pair.volume}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Center - Order Entry */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            {/* Position Info */}
            <div className="mb-4 rounded-lg bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400">Selected Pair</div>
                  <div className="text-xl font-bold text-white">{selectedPair.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400">Mark Price</div>
                  <div className="text-xl font-bold text-white font-mono">${selectedPair.price.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-400">Funding Rate: <span className="text-white">{selectedPair.funding}%</span></span>
                <span className="text-gray-400">Open Interest: <span className="text-white">{selectedPair.openInterest}</span></span>
              </div>
            </div>

            {/* Order Type Tabs */}
            <div className="mb-4 flex rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setOrderType("limit")}
                className={`flex-1 rounded py-2 text-sm font-medium ${
                  orderType === "limit" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                Limit
              </button>
              <button
                onClick={() => { setOrderType("market"); setPrice(selectedPair.price); }}
                className={`flex-1 rounded py-2 text-sm font-medium ${
                  orderType === "market" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                Market
              </button>
              <button className="flex-1 rounded py-2 text-sm font-medium text-gray-400">Stop</button>
            </div>

            {/* Long/Short Buttons */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setOrderSide("long")}
                className={`rounded-lg py-3 font-medium transition-colors ${
                  orderSide === "long" 
                    ? "bg-green-600 text-white" 
                    : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                }`}
              >
                🟢 Long
              </button>
              <button
                onClick={() => setOrderSide("short")}
                className={`rounded-lg py-3 font-medium transition-colors ${
                  orderSide === "short" 
                    ? "bg-red-600 text-white" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                }`}
              >
                🔴 Short
              </button>
            </div>

            {/* Leverage Slider */}
            <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-400">Leverage</span>
                <span className="font-mono text-white">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="125"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="mb-2 w-full accent-tiger-orange"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
                <span>100x</span>
                <span>125x</span>
              </div>
            </div>

            {/* Price and Quantity */}
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-gray-400">Price (USDT)</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  disabled={orderType === "market"}
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">Quantity (Contracts)</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    className="rounded border border-white/10 py-2 text-xs text-gray-400 hover:bg-white/5 hover:text-white"
                    onClick={() => setQuantity((Number(price) * pct * 1000 / selectedPair.price).toFixed(2))}
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Button */}
            <button
              className={`mt-4 w-full rounded-lg py-4 font-bold text-white ${
                orderSide === "long" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {orderSide === "long" ? "🟢 Open Long" : "🔴 Open Short"} @ ${price.toLocaleString()}
            </button>

            {/* Estimated Cost */}
            <div className="mt-4 rounded-lg bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Est. Position Value</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Est. Margin Required</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Est. Liquidation Price</span>
                <span className="font-mono text-red-400">--</span>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Positions */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Open Positions</h3>
            
            {POSITIONS.length > 0 ? (
              <div className="space-y-3">
                {POSITIONS.map((pos) => (
                  <div key={pos.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${pos.side === "long" ? "text-green-400" : "text-red-400"}`}>
                          {pos.side === "long" ? "🟢" : "🔴"}
                        </span>
                        <span className="font-medium text-white">{pos.symbol}</span>
                      </div>
                      <span className="text-xs text-gray-400">{pos.leverage}x</span>
                    </div>
                    <div className="mt-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Size</span>
                        <span className="font-mono text-white">{pos.size}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Entry</span>
                        <span className="font-mono text-white">${pos.entryPrice.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">PnL</span>
                        <span className={`font-mono ${pos.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button className="flex-1 rounded bg-white/10 py-1 text-xs text-white hover:bg-white/20">
                        Add Margin
                      </button>
                      <button className="flex-1 rounded bg-white/10 py-1 text-xs text-white hover:bg-white/20">
                        Close
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-400">
                <Target className="mx-auto mb-2 h-8 w-8" />
                <p>No open positions</p>
              </div>
            )}

            {/* Funding History */}
            <div className="mt-6">
              <h4 className="mb-3 text-sm font-semibold text-white">Funding Countdown</h4>
              <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                <Clock className="h-5 w-5 text-gray-400" />
                <span className="font-mono text-white">02:34:56</span>
                <span className="text-xs text-gray-400">Next funding</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}