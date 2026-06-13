"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Lock, 
  Unlock, 
  TrendingUp, 
  Clock,
  ArrowRight,
  Wallet,
  Info,
  CheckCircle
} from "lucide-react";

const STAKING_PRODUCTS = [
  { 
    id: 1, 
    symbol: "ETH", 
    name: "Ethereum", 
    apy: 4.2, 
    lockPeriod: 0, 
    minStake: 0.01,
    totalStaked: 24567890,
    category: "flexible"
  },
  { 
    id: 2, 
    symbol: "BNB", 
    name: "BNB", 
    apy: 5.8, 
    lockPeriod: 30, 
    minStake: 0.1,
    totalStaked: 12345678,
    category: "locked"
  },
  { 
    id: 3, 
    symbol: "SOL", 
    name: "Solana", 
    apy: 6.5, 
    lockPeriod: 60, 
    minStake: 1,
    totalStaked: 8901234,
    category: "locked"
  },
  { 
    id: 4, 
    symbol: "DOT", 
    name: "Polkadot", 
    apy: 12.5, 
    lockPeriod: 90, 
    minStake: 10,
    totalStaked: 5678901,
    category: "locked"
  },
];

export default function StakingPage() {
  const [selectedProduct, setSelectedProduct] = useState<typeof STAKING_PRODUCTS[0]>(STAKING_PRODUCTS[0]);
  const [stakeAmount, setStakeAmount] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");

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
            <Link href="/markets" className="text-sm text-gray-300 hover:text-white">Markets</Link>
            <Link href="/earn" className="text-sm text-tiger-orange hover:text-white">Earn</Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white">Wallet</Link>
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
          <h1 className="text-3xl font-bold text-white">Staking</h1>
          <p className="text-gray-400">Stake your tokens and earn rewards</p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Staked</div>
            <div className="text-2xl font-bold text-white">$45.2M</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Rewards</div>
            <div className="text-2xl font-bold text-green-400">$2.3M</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">APY Range</div>
            <div className="text-2xl font-bold text-white">4-15%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Active Stakers</div>
            <div className="text-2xl font-bold text-white">12,456</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Products */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <h3 className="mb-4 text-lg font-semibold text-white">Staking Products</h3>
            
            <div className="space-y-3">
              {STAKING_PRODUCTS.map((product) => (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selectedProduct.symbol === product.symbol 
                      ? "border-tiger-orange bg-tiger-orange/10" 
                      : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                        <span className="font-bold text-white">{product.symbol[0]}</span>
                      </div>
                      <div>
                        <div className="font-medium text-white">{product.symbol}</div>
                        <div className="text-sm text-gray-400">{product.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-green-400">{product.apy}%</div>
                      <div className="text-xs text-gray-400">APY</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-gray-400">
                      {product.lockPeriod === 0 ? "Flexible" : `${product.lockPeriod} days lock`}
                    </span>
                    <span className="text-gray-400">
                      Min: {product.minStake} {product.symbol}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Stake Form */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">
              {selectedProduct.lockPeriod === 0 ? "Flexible" : "Locked"} Staking
            </h3>

            {/* Mode Toggle */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode("stake")}
                className={`rounded-lg py-2 font-medium ${
                  mode === "stake" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"
                }`}
              >
                <Lock className="mr-1 inline h-4 w-4" />
                Stake
              </button>
              <button
                onClick={() => setMode("unstake")}
                className={`rounded-lg py-2 font-medium ${
                  mode === "unstake" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"
                }`}
              >
                <Unlock className="mr-1 inline h-4 w-4" />
                Unstake
              </button>
            </div>

            {/* Info */}
            <div className="mb-4 rounded-lg bg-white/5 p-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">APY</span>
                <span className="text-green-400 font-mono">{selectedProduct.apy}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Lock Period</span>
                <span className="text-white">{selectedProduct.lockPeriod === 0 ? "Flexible" : `${selectedProduct.lockPeriod} days`}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Min Stake</span>
                <span className="text-white">{selectedProduct.minStake} {selectedProduct.symbol}</span>
              </div>
            </div>

            {/* Amount Input */}
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Amount ({selectedProduct.symbol})</label>
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
              />
            </div>

            {/* Submit */}
            <button
              className={`w-full rounded-lg py-3 font-bold ${
                mode === "stake" ? "bg-tiger-orange hover:bg-tiger-orange/90" : "bg-white/10 text-white"
              }`}
            >
              {mode === "stake" ? "Stake Now" : "Unstake"}
            </button>

            {/* Rewards */}
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Est. Daily Reward</span>
                <span className="font-mono text-green-400">--</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}