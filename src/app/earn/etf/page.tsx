"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, TrendingUp, ArrowRight, Wallet } from "lucide-react";

const ETF_DATA = [
  { symbol: "BTCETF", name: "Bitcoin ETF", price: 45.67, change: 3.45, volume: 12.5M },
  { symbol: "ETHETF", name: "Ethereum ETF", price: 23.45, change: 2.34, volume: 8.9M },
  { symbol: "AIETF", name: "AI Tech ETF", price: 12.34, change: 5.67, volume: 5.6M },
];

export default function ETFPage() {
  const [selected, setSelected] = useState(ETF_DATA[0]);
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState("buy");

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
        <h1 className="text-3xl font-bold text-white mb-2">ETF Trading</h1>
        <p className="text-gray-400 mb-6">Trade crypto-backed ETFs</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {ETF_DATA.map((etf) => (
              <button key={etf.symbol} onClick={() => setSelected(etf)}
                className={`w-full rounded-lg border p-4 text-left ${selected.symbol === etf.symbol ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex justify-between">
                  <span className="font-bold text-white">{etf.symbol}</span>
                  <span className={`font-mono ${etf.change >= 0 ? "text-green-400" : "text-red-400"}`}>{etf.change >= 0 ? "+" : ""}{etf.change}%</span>
                </div>
                <div className="text-sm text-gray-400">{etf.name}</div>
                <div className="font-mono text-white mt-1">${etf.price}</div>
              </button>
            ))}
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="font-bold text-white mb-4">Trade {selected.symbol}</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setSide("buy")} className={`py-2 font-bold rounded ${side === "buy" ? "bg-green-600 text-white" : "bg-green-600/20 text-green-400"}`}>Buy</button>
              <button onClick={() => setSide("sell")} className={`py-2 font-bold rounded ${side === "sell" ? "bg-red-600 text-white" : "bg-red-600/20 text-red-400"}`}>Sell</button>
            </div>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white mb-4" />
            <button className={`w-full rounded-lg py-3 font-bold ${side === "buy" ? "bg-green-600" : "bg-red-600"} text-white`}>
              {side === "buy" ? "Buy" : "Sell"} {selected.symbol}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}