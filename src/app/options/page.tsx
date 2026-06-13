"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  TrendingUp, 
  TrendingDown, 
  ArrowUpDown,
  Clock,
  Calculator,
  Info,
  Target
} from "lucide-react";

const OPTIONS_DATA = [
  { 
    symbol: "BTC", 
    expiry: "2024-06-28", 
    strikes: [60000, 62000, 64000, 66000, 68000, 70000],
    current: 67234.56 
  },
  { 
    symbol: "ETH", 
    expiry: "2024-06-28", 
    strikes: [3000, 3200, 3400, 3600, 3800, 4000],
    current: 3456.78 
  },
];

const OPTION_CHAINS: Record<string, { call: { price: number; iv: number; volume: number }[], put: { price: number; iv: number; volume: number }[] }> = {
  "BTC-2024-06-28": {
    call: [
      { price: 8234.56, iv: 45.2, volume: 234 },
      { price: 6234.56, iv: 38.5, volume: 456 },
      { price: 4234.56, iv: 32.1, volume: 678 },
      { price: 2234.56, iv: 28.4, volume: 890 },
      { price: 1234.56, iv: 25.6, volume: 1234 },
      { price: 534.56, iv: 24.2, volume: 1567 },
    ],
    put: [
      { price: 534.56, iv: 24.2, volume: 1567 },
      { price: 1234.56, iv: 25.6, volume: 1234 },
      { price: 2234.56, iv: 28.4, volume: 890 },
      { price: 3234.56, iv: 32.1, volume: 678 },
      { price: 4234.56, iv: 38.5, volume: 456 },
      { price: 5234.56, iv: 45.2, volume: 234 },
    ],
  },
};

export default function OptionsPage() {
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedExpiry, setSelectedExpiry] = useState("2024-06-28");
  const [optionType, setOptionType] = useState<"call" | "put">("call");
  const [positionSide, setPositionSide] = useState<"buy" | "sell">("buy");

  const currentPrice = selectedAsset === "BTC" ? 67234.56 : 3456.78;
  const chain = OPTION_CHAINS[`${selectedAsset}-${selectedExpiry}`] || OPTION_CHAINS["BTC-2024-06-28"];
  const strikes = selectedAsset === "BTC" ? [60000, 62000, 64000, 66000, 68000, 70000] : [3000, 3200, 3400, 3600, 3800, 4000];

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
            <Link href="/futures" className="text-sm text-gray-300 hover:text-white transition-colors">Futures</Link>
            <Link href="/margin" className="text-sm text-gray-300 hover:text-white transition-colors">Margin</Link>
            <Link href="/options" className="text-sm text-tiger-orange hover:text-white transition-colors">Options</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/wallet">
              <button className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/5">Wallet</button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Options Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Options Trading</h1>
            <p className="text-gray-400">Call and Put options with real-time Greeks</p>
          </div>
          
          <div className="flex items-center gap-4">
            <select 
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 py-2 px-4 text-white"
            >
              <option value="BTC">BTC Options</option>
              <option value="ETH">ETH Options</option>
            </select>
            <select 
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 py-2 px-4 text-white"
            >
              <option value="2024-06-28">Jun 28, 2024</option>
              <option value="2024-07-05">Jul 05, 2024</option>
              <option value="2024-07-26">Jul 26, 2024</option>
            </select>
          </div>
        </div>

        {/* Account Summary */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Options Value</div>
            <div className="text-2xl font-bold text-white">$12,456.78</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Unrealized PnL</div>
            <div className="text-2xl font-bold text-green-400">$2,345.67</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Available Balance</div>
            <div className="text-2xl font-bold text-white">$45,234.56</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Open Positions</div>
            <div className="text-2xl font-bold text-white">3</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Left Sidebar - Asset Selection */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Underlying</h3>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-white">{selectedAsset}/USDT</div>
                <div className="mt-2 text-xl font-mono text-green-400">${currentPrice.toLocaleString()}</div>
                <div className="mt-1 text-sm text-gray-400">Current Price</div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-3 text-sm font-semibold text-white">Quick Stats</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">24h Change</span>
                  <span className="text-green-400">+2.34%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">24h Vol</span>
                  <span className="text-white">$2.4B</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Open Interest</span>
                  <span className="text-white">$456M</span>
                </div>
              </div>
            </div>

            {/* Buy/Sell */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setPositionSide("buy")}
                className={`rounded-lg py-2 font-medium transition-colors ${
                  positionSide === "buy" 
                    ? "bg-green-600 text-white" 
                    : "bg-green-600/20 text-green-400"
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setPositionSide("sell")}
                className={`rounded-lg py-2 font-medium transition-colors ${
                  positionSide === "sell" 
                    ? "bg-red-600 text-white" 
                    : "bg-red-600/20 text-red-400"
                }`}
              >
                Sell
              </button>
            </div>
          </div>

          {/* Center - Option Chain */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Option Chain</h3>
              <div className="flex rounded-lg border border-white/10 bg-white/5 p-1">
                <button
                  onClick={() => setOptionType("call")}
                  className={`rounded px-4 py-1 text-sm ${
                    optionType === "call" ? "bg-white/10 text-white" : "text-gray-400"
                  }`}
                >
                  Call
                </button>
                <button
                  onClick={() => setOptionType("put")}
                  className={`rounded px-4 py-1 text-sm ${
                    optionType === "put" ? "bg-white/10 text-white" : "text-gray-400"
                  }`}
                >
                  Put
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-3 py-2 text-left text-sm font-medium text-gray-400">Strike</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">Price</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">IV</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">Delta</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">Volume</th>
                    <th className="px-3 py-2 text-center text-sm font-medium text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((strike, idx) => {
                    const option = optionType === "call" ? chain.call[idx] : chain.put[idx];
                    const inTheMoney = optionType === "call" ? currentPrice > strike : currentPrice < strike;
                    return (
                      <tr key={strike} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-3">
                          <span className={`font-mono ${inTheMoney ? "text-green-400 font-bold" : "text-white"}`}>
                            ${strike.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-white">
                          ${option?.price.toFixed(2) || "0.00"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-300">
                          {option?.iv.toFixed(1) || "0.0"}%
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-300">
                          {inTheMoney ? (optionType === "call" ? "0.65" : "-0.35") : "0.12"}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-300">
                          {option?.volume || 0}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1">
                            <button className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30">
                              Buy
                            </button>
                            <button className="rounded bg-red-600/20 px-2 py-1 text-xs text-red-400 hover:bg-red-600/30">
                              Sell
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Sidebar - Greeks & Info */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Greeks</h3>
            
            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm text-gray-400">Delta (Δ)</div>
                <div className="text-xl font-mono text-white">0.65</div>
                <div className="text-xs text-gray-500">Option price sensitivity</div>
              </div>
              
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm text-gray-400">Gamma (Γ)</div>
                <div className="text-xl font-mono text-white">0.0023</div>
                <div className="text-xs text-gray-500">Delta change rate</div>
              </div>
              
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm text-gray-400">Theta (Θ)</div>
                <div className="text-xl font-mono text-white">-12.45</div>
                <div className="text-xs text-gray-500">Time decay per day</div>
              </div>
              
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm text-gray-400">Vega (ν)</div>
                <div className="text-xl font-mono text-white">23.56</div>
                <div className="text-xs text-gray-500">Volatility sensitivity</div>
              </div>
            </div>

            {/* Expiry Countdown */}
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-gray-400">
                <Clock className="h-4 w-4" />
                <span className="text-sm">Time to Expiry</span>
              </div>
              <div className="mt-2 font-mono text-xl text-white">14d 6h 23m</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}