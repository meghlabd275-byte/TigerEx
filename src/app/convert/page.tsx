"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, TrendingUp, Info, CheckCircle } from "lucide-react";

const CONVERT_PAIRS = [
  { from: "BTC", to: "USDT", rate: 67234.56 },
  { from: "ETH", to: "USDT", rate: 3456.78 },
  { from: "BNB", to: "USDT", rate: 567.89 },
  { from: "USDT", to: "BTC", rate: 0.00001487 },
  { from: "USDT", to: "ETH", rate: 0.000289 },
];

export default function ConvertPage() {
  const [fromCoin, setFromCoin] = useState("BTC");
  const [toCoin, setToCoin] = useState("USDT");
  const [amount, setAmount] = useState("");
  
  const getRate = () => {
    const pair = CONVERT_PAIRS.find(p => p.from === fromCoin && p.to === toCoin);
    return pair?.rate || 1;
  };

  const getReceive = () => {
    if (!amount) return "0.00";
    return (Number(amount) * getRate()).toFixed(2);
  };

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
        <h1 className="text-3xl font-bold text-white mb-2">Convert</h1>
        <p className="text-gray-400 mb-6">Instantly convert between crypto</p>

        <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4">
            <label className="mb-2 block text-sm text-gray-400">From</label>
            <div className="flex gap-2">
              <select value={fromCoin} onChange={(e) => setFromCoin(e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 text-white">
                {CONVERT_PAIRS.map(p => <option key={p.from} value={p.from}>{p.from}</option>)}
              </select>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
            </div>
          </div>

          <div className="flex justify-center mb-4">
            <button className="rounded-full bg-white/10 p-2">
              <ArrowRightLeft className="h-5 w-5 text-white" />
            </button>
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm text-gray-400">To</label>
            <div className="flex gap-2">
              <select value={toCoin} onChange={(e) => setToCoin(e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 text-white">
                {CONVERT_PAIRS.map(p => <option key={p.to} value={p.to}>{p.to}</option>)}
              </select>
              <div className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white">
                {getReceive()}
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-lg bg-white/5 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Rate</span>
              <span className="font-mono text-white">1 {fromCoin} = {getRate()} {toCoin}</span>
            </div>
          </div>

          <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">
            Convert Now
          </button>
        </div>
      </div>
    </div>
  );
}