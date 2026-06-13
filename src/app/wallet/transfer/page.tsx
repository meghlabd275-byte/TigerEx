"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, User, Wallet, CheckCircle, AlertTriangle } from "lucide-react";

const COINS = [
  { id: "usdt", name: "Tether", symbol: "USDT" },
  { id: "btc", name: "Bitcoin", symbol: "BTC" },
  { id: "eth", name: "Ethereum", symbol: "ETH" },
];

export default function TransferPage() {
  const [selected, setSelected] = useState(COINS[0]);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<"internal" | "external">("internal");

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
        <h1 className="text-3xl font-bold text-white mb-2">Transfer</h1>
        <p className="text-gray-400 mb-6">Transfer between wallets</p>

        <div className="mb-4 flex rounded-lg border border-white/10 bg-white/5 p-1">
          <button onClick={() => setMode("internal")} className={`flex-1 rounded py-2 ${mode === "internal" ? "bg-white/10 text-white" : "text-gray-400"}`}>
            <User className="mr-1 inline h-4 w-4" /> Internal
          </button>
          <button onClick={() => setMode("external")} className={`flex-1 rounded py-2 ${mode === "external" ? "bg-white/10 text-white" : "text-gray-400"}`}>
            <Wallet className="mr-1 inline h-4 w-4" /> External
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {COINS.map((coin) => (
            <button key={coin.id} onClick={() => setSelected(coin)}
              className={`rounded-lg border p-3 text-center ${selected.id === coin.id ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
              <div className="font-bold text-white">{coin.symbol}</div>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4">
            <label className="mb-2 block text-sm text-gray-400">
              {mode === "internal" ? "Recipient Email/Username" : "Recipient Address"}
            </label>
            <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} 
              placeholder={mode === "internal" ? "email@example.com" : "0x..."}
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm text-gray-400">Amount ({selected.symbol})</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
          </div>

          <div className="mb-4 rounded-lg bg-white/5 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Fee</span>
              <span className="font-mono text-white">0 {selected.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">You send</span>
              <span className="font-mono text-white">{amount || "0.00"} {selected.symbol}</span>
            </div>
          </div>

          <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white flex items-center justify-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Transfer
          </button>
        </div>
      </div>
    </div>
  );
}