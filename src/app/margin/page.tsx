"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet,
  ArrowUpDown,
  AlertTriangle,
  Shield,
  Info,
  Calculator
} from "lucide-react";

const MARGIN_PAIRS = [
  { symbol: "BTC/USDT", maxBorrow: 50000, available: 25000, borrowed: 15000, rate: 0.0001 },
  { symbol: "ETH/USDT", maxBorrow: 10000, available: 5000, borrowed: 2000, rate: 0.0001 },
  { symbol: "SOL/USDT", maxBorrow: 5000, available: 2500, borrowed: 1000, rate: 0.0002 },
  { symbol: "BNB/USDT", maxBorrow: 2000, available: 1000, borrowed: 500, rate: 0.0001 },
];

const POSITIONS = [
  { id: 1, symbol: "BTC/USDT", side: "long", size: 0.5, entryPrice: 65000, currentPrice: 67234.56, pnl: 1117.28, liquidation: 58234 },
  { id: 2, symbol: "ETH/USDT", side: "long", size: 5.0, entryPrice: 3200, currentPrice: 3456.78, pnl: 1283.9, liquidation: 2890 },
];

export default function MarginPage() {
  const [marginMode, setMarginMode] = useState<"cross" | "isolated">("cross");
  const [selectedPair, setSelectedPair] = useState(MARGIN_PAIRS[0]);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("market");
  const [price, setPrice] = useState(67234.56);
  const [quantity, setQuantity] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");

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
            <Link href="/margin" className="text-sm text-tiger-orange hover:text-white transition-colors">Margin</Link>
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
        {/* Margin Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Margin Trading</h1>
            <p className="text-gray-400">Trade with leverage up to 10x</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setMarginMode("cross")}
                className={`rounded px-4 py-2 text-sm ${
                  marginMode === "cross" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                Cross Margin
              </button>
              <button
                onClick={() => setMarginMode("isolated")}
                className={`rounded px-4 py-2 text-sm ${
                  marginMode === "isolated" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                Isolated Margin
              </button>
            </div>
          </div>
        </div>

        {/* Account Summary */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Assets</div>
            <div className="text-2xl font-bold text-white">$45,234.56</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Liabilities</div>
            <div className="text-2xl font-bold text-white">$18,500.00</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Net Account Value</div>
            <div className="text-2xl font-bold text-white">$26,734.56</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Margin Ratio</div>
            <div className="text-2xl font-bold text-green-400">245.67%</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Left Sidebar - Assets */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">Borrow Assets</h3>
            <div className="space-y-2">
              {MARGIN_PAIRS.map((asset) => (
                <button
                  key={asset.symbol}
                  onClick={() => setSelectedPair(asset)}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                    selectedPair.symbol === asset.symbol 
                      ? "bg-tiger-orange/20 border border-tiger-orange" 
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{asset.symbol}</span>
                    <span className="text-xs text-gray-400">{(asset.rate * 100).toFixed(2)}%/day</span>
                  </div>
                  <div className="mt-2 text-sm">
                    <div className="flex justify-between text-gray-400">
                      <span>Available:</span>
                      <span className="text-white">${asset.available.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                      <span>Borrowed:</span>
                      <span className="text-white">${asset.borrowed.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                      <span>Max:</span>
                      <span className="text-white">${asset.maxBorrow.toLocaleString()}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Borrow Modal */}
            <div className="mt-4 rounded-lg border border-tiger-orange/50 bg-tiger-orange/10 p-4">
              <h4 className="mb-3 font-semibold text-white">Borrow {selectedPair.symbol}</h4>
              <input
                type="number"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                placeholder="Amount to borrow"
                className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 py-2 px-3 font-mono text-white"
              />
              <div className="flex items-center justify-between text-sm text-gray-400 mb-3">
                <span>Available:</span>
                <span className="text-white">${selectedPair.available.toLocaleString()}</span>
              </div>
              <button className="w-full rounded-lg bg-tiger-orange py-2 font-medium text-white hover:bg-tiger-orange/90">
                Borrow
              </button>
            </div>
          </div>

          {/* Center - Order Entry */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
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
                onClick={() => { setOrderType("market"); setPrice(67234.56); }}
                className={`flex-1 rounded py-2 text-sm font-medium ${
                  orderType === "market" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                Market
              </button>
              <button className="flex-1 rounded py-2 text-sm font-medium text-gray-400">Stop</button>
            </div>

            {/* Buy/Sell Buttons */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setOrderSide("buy")}
                className={`rounded-lg py-3 font-medium transition-colors ${
                  orderSide === "buy" 
                    ? "bg-green-600 text-white" 
                    : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                }`}
              >
                Buy / Long
              </button>
              <button
                onClick={() => setOrderSide("sell")}
                className={`rounded-lg py-3 font-medium transition-colors ${
                  orderSide === "sell" 
                    ? "bg-red-600 text-white" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                }`}
              >
                Sell / Short
              </button>
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
                <label className="mb-2 block text-sm text-gray-400">Quantity</label>
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
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Button */}
            <button
              className={`mt-4 w-full rounded-lg py-4 font-bold text-white ${
                orderSide === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {orderSide === "buy" ? "Buy" : "Sell"} {selectedPair.symbol}
            </button>

            {/* Margin Info */}
            <div className="mt-4 rounded-lg bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Cost</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Borrowed</span>
                <span className="font-mono text-white">$0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Total Position Value</span>
                <span className="font-mono text-white">$0.00</span>
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
                      <span className="text-xs text-gray-400">Margin</span>
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
                      <div className="mt-2 flex items-center justify-between text-xs text-red-400">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Liq: ${pos.liquidation.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button className="flex-1 rounded bg-white/10 py-1 text-xs text-white hover:bg-white/20">
                        Add
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
                <Wallet className="mx-auto mb-2 h-8 w-8" />
                <p>No open positions</p>
              </div>
            )}

            {/* Liquidation Warning */}
            <div className="mt-6 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
              <div className="flex items-center gap-2 text-yellow-400">
                <Shield className="h-5 w-5" />
                <span className="font-medium">Liquidation Protection</span>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                Your margin ratio is healthy. Add more collateral to avoid liquidation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}