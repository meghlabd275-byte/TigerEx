"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUp, AlertTriangle, CheckCircle, Wallet } from "lucide-react";

const COINS = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", min: 0.0001, fee: 0.0005 },
  { id: "eth", name: "Ethereum", symbol: "ETH", min: 0.01, fee: 0.005 },
  { id: "usdt", name: "Tether", symbol: "USDT", min: 10, fee: 5 },
];

export default function WithdrawPage() {
  const [selected, setSelected] = useState(COINS[1]);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");

  const getFee = () => selected.fee;
  const getReceive = () => amount ? (Number(amount) - getFee()).toFixed(6) : "0.00";

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
        <h1 className="text-3xl font-bold text-white mb-2">Withdraw</h1>
        <p className="text-gray-400 mb-6">Withdraw crypto to external wallet</p>

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
            <label className="mb-2 block text-sm text-gray-400">Recipient Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter {selected.symbol} address"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm text-gray-400">Amount ({selected.symbol})</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
          </div>

          <div className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <div className="text-sm text-yellow-400">
                Ensure the address is correct. Wrong addresses may result in permanent loss of funds.
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-lg bg-white/5 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Network Fee</span>
              <span className="font-mono text-white">{getFee()} {selected.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">You will receive</span>
              <span className="font-mono text-white">{getReceive()} {selected.symbol}</span>
            </div>
          </div>

          <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white flex items-center justify-center gap-2">
            <ArrowUp className="h-5 w-5" />
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}