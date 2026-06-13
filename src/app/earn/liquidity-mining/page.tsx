"use client";

import { useState } from "react";
import Link from "next/link";
import { Droplets, TrendingUp, Clock, ArrowRight } from "lucide-react";

const POOLS = [
  { pair: "NEB-USDT", apy: 45.6, tvl: 2.3M, rewards: "NEB", bonus: true },
  { pair: "CVT-ETH", apy: 32.4, tvl: 1.8M, rewards: "CVT", bonus: false },
  { pair: "ETH-USDT", apy: 18.9, tvl: 8.5M, rewards: "ETH", bonus: false },
];

export default function LiquidityMiningPage() {
  const [selected, setSelected] = useState(POOLS[0]);
  const [amount, setAmount] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">TigerEx</span>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-white mb-2">Liquidity Mining</h1>
        <p className="text-gray-400 mb-6">Provide liquidity and earn rewards</p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            {POOLS.map((pool, i) => (
              <button key={i} onClick={() => setSelected(pool)}
                className={`w-full rounded-lg border p-4 text-left ${selected.pair === pool.pair ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex justify-between">
                  <span className="font-bold text-white">{pool.pair}</span>
                  <span className="text-green-400 font-mono">{pool.apy}% APY</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">TVL: ${pool.tvl}</div>
              </button>
            ))}
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="font-bold text-white mb-4">Add Liquidity to {selected.pair}</h3>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" 
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white mb-4" />
            <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">Add Liquidity</button>
          </div>
        </div>
      </div>
    </div>
  );
}