"use client";

import { useState } from "react";
import Link from "next/link";
import { Dropin, ArrowRight, Clock } from "lucide-react";

const FARMS = [
  { pair: "NEB/USDT", apy: 125.5, tvl: 2.5, reward: "NEB", type: "hot" },
  { pair: "CVT/ETH", apy: 89.2, tvl: 1.2, reward: "CVT", type: "normal" },
  { pair: "USDT/BNB", apy: 45.6, tvl: 5.8, reward: "BNB", type: "normal" },
  { pair: "ETH/USDT", apy: 23.4, tvl: 12.3, reward: "ETH", type: "normal" },
];

export default function LaunchPoolPage() {
  const [selected, setSelected] = useState(FARMS[0]);
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
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/earn" className="text-sm text-tiger-orange">Earn</Link>
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-white mb-2">Launch Pool</h1>
        <p className="text-gray-400 mb-6">Farm tokens by staking liquidity</p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            {FARMS.map((farm, i) => (
              <button key={i} onClick={() => setSelected(farm)}
                className={`w-full rounded-lg border p-4 text-left ${selected.pair === farm.pair ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex justify-between">
                  <span className="font-bold text-white">{farm.pair}</span>
                  <span className="text-green-400 font-mono">{farm.apy}% APY</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">TVL: ${farm.tvl}M</div>
              </button>
            ))}
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="font-bold text-white mb-4">Stake in {selected.pair}</h3>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" 
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white mb-4" />
            <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">Stake</button>
          </div>
        </div>
      </div>
    </div>
  );
}