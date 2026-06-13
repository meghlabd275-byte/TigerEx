"use client";

import { useState } from "react";
import Link from "next/link";
import { Cloud, TrendingUp, Clock, Wallet, ArrowRight } from "lucide-react";

const PACKAGES = [
  { id: 1, name: "Starter", hash: 10, price: 99, daily: 2.5, contract: 180 },
  { id: 2, name: "Standard", hash: 50, price: 399, daily: 14.5, contract: 180 },
  { id: 3, name: "Professional", hash: 100, price: 699, daily: 32.0, contract: 180 },
];

export default function CloudMiningPage() {
  const [selected, setSelected] = useState(PACKAGES[0]);

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
        <h1 className="text-3xl font-bold text-white mb-2">Cloud Mining</h1>
        <p className="text-gray-400 mb-6">Mine crypto without hardware</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="text-sm text-gray-400">Total Mined</div>
            <div className="text-2xl font-bold text-white">0.5 BTC</div>
          </div>
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="text-sm text-gray-400">Active Contracts</div>
            <div className="text-2xl font-bold text-white">3</div>
          </div>
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="text-sm text-gray-400">Est. Daily</div>
            <div className="text-2xl font-bold text-green-400">$45.00</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PACKAGES.map((pkg) => (
            <button key={pkg.id} onClick={() => setSelected(pkg)}
              className={`rounded-xl border p-6 text-left ${selected.id === pkg.id ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
              <h3 className="text-xl font-bold text-white">{pkg.name}</h3>
              <div className="mt-2 text-3xl font-bold text-white">{pkg.hash} TH/s</div>
              <div className="mt-4 text-sm text-gray-400">Daily: ${pkg.daily}</div>
              <div className="text-sm text-gray-400">Contract: {pkg.contract} days</div>
              <div className="mt-4 text-xl font-bold text-tiger-orange">${pkg.price}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-bold text-white mb-4">Purchase Contract</h3>
          <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">Buy Now - ${selected.price}</button>
        </div>
      </div>
    </div>
  );
}