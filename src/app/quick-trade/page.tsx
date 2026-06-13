"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Zap, 
  ArrowUpDown, 
  Star, 
  Clock,
  Wallet,
  TrendingUp,
  TrendingDown
} from "lucide-react";

const POPULAR_PAIRS = [
  { symbol: "BTC/USDT", price: 67234.56, change: 2.34, star: true },
  { symbol: "ETH/USDT", price: 3456.78, change: 1.89, star: true },
  { symbol: "BNB/USDT", price: 567.89, change: 0.45, star: false },
  { symbol: "SOL/USDT", price: 145.67, change: 5.67, star: true },
  { symbol: "XRP/USDT", price: 0.5234, change: -2.34, star: false },
  { symbol: "DOGE/USDT", price: 0.1234, change: 8.90, star: true },
];

const QUICK_AMOUNTS = [25, 50, 100, 250, 500, 1000];

export default function QuickTradePage() {
  const [selectedPair, setSelectedPair] = useState(POPULAR_PAIRS[0]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [fiatAmount, setFiatAmount] = useState("");

  const calculateReceive = () => {
    if (!fiatAmount) return "0.00";
    const receive = Number(fiatAmount) / selectedPair.price;
    return receive.toFixed(selectedPair.price < 1 ? 6 : 4);
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
            <Link href="/quick-trade" className="text-sm text-tiger-orange hover:text-white transition-colors">Quick Trade</Link>
            <Link href="/trade/BTC-USDT" className="text-sm text-gray-300 hover:text-white transition-colors">Trade</Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white transition-colors">Wallet</Link>
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
        <div className="mb-8 text-center">
          <div className="mb-2 flex items-center justify-center gap-2 text-tiger-orange">
            <Zap className="h-6 w-6" />
            <span className="text-sm font-medium">Quick Trade</span>
          </div>
          <h1 className="text-4xl font-bold text-white">Lightning Fast Trading</h1>
          <p className="mt-2 text-gray-400">Buy and sell crypto in seconds with one click</p>
        </div>

        {/* Main Card */}
        <div className="mx-auto max-w-lg">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            {/* Pair Selection */}
            <div className="mb-6">
              <label className="mb-2 block text-sm text-gray-400">Trading Pair</label>
              <div className="flex flex-wrap gap-2">
                {POPULAR_PAIRS.map((pair) => (
                  <button
                    key={pair.symbol}
                    onClick={() => setSelectedPair(pair)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                      selectedPair.symbol === pair.symbol 
                        ? "bg-tiger-orange text-white" 
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    <span>{pair.symbol}</span>
                    {pair.star && <Star className="h-3 w-3 fill-current" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Buy/Sell Toggle */}
            <div className="mb-6 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSide("buy")}
                className={`flex items-center justify-center gap-2 rounded-lg py-4 font-bold text-lg transition-colors ${
                  side === "buy" 
                    ? "bg-green-600 text-white" 
                    : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                }`}
              >
                <TrendingUp className="h-5 w-5" />
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={`flex items-center justify-center gap-2 rounded-lg py-4 font-bold text-lg transition-colors ${
                  side === "sell" 
                    ? "bg-red-600 text-white" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                }`}
              >
                <TrendingDown className="h-5 w-5" />
                Sell
              </button>
            </div>

            {/* Current Price */}
            <div className="mb-6 rounded-lg bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400">{selectedPair.symbol}</div>
                  <div className="text-2xl font-bold text-white font-mono">
                    ${selectedPair.price.toLocaleString()}
                  </div>
                </div>
                <div className={`text-right font-mono ${selectedPair.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {selectedPair.change >= 0 ? "+" : ""}{selectedPair.change}%
                  <div className="text-sm text-gray-400">24h change</div>
                </div>
              </div>
            </div>

            {/* Amount Input */}
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Spend (USDT)</label>
              <input
                type="number"
                value={fiatAmount}
                onChange={(e) => setFiatAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-4 px-4 text-2xl font-mono text-white"
              />
            </div>

            {/* Quick Amounts */}
            <div className="mb-6 grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setFiatAmount(amt.toString())}
                  className="rounded-lg border border-white/10 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                >
                  {amt} USDT
                </button>
              ))}
            </div>

            {/* Receive Amount */}
            <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">You receive</span>
                <span className="text-xl font-bold text-white font-mono">
                  {calculateReceive()} {selectedPair.symbol.split("/")[0]}
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              className={`w-full rounded-lg py-4 font-bold text-white ${
                side === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {side === "buy" ? "🟢 Buy Now" : "🔴 Sell Now"}
            </button>

            {/* Info */}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>Instant execution</span>
              </div>
              <div className="flex items-center gap-1">
                <Wallet className="h-3 w-3" />
                <span>0.1% fee</span>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <Zap className="mb-2 h-6 w-6 text-tiger-orange" />
              <h3 className="font-semibold text-white">Instant</h3>
              <p className="text-sm text-gray-400">Lightning-fast order execution</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <ArrowUpDown className="mb-2 h-6 w-6 text-tiger-orange" />
              <h3 className="font-semibold text-white">Simple</h3>
              <p className="text-sm text-gray-400">One-screen trading experience</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}