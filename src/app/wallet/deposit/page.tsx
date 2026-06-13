"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, QrCode, ArrowDown, CheckCircle, Wallet } from "lucide-react";

const NETWORKS = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", network: "BTC", minDeposit: 0.0001 },
  { id: "eth", name: "Ethereum", symbol: "ETH", network: "ERC-20", minDeposit: 0.01 },
  { id: "bsc", name: "BNB Smart Chain", symbol: "BNB", network: "BEP-20", minDeposit: 0.01 },
  { id: "trx", name: "Tron", symbol: "USDT", network: "TRC-20", minDeposit: 10 },
];

export default function DepositPage() {
  const [selected, setSelected] = useState(NETWORKS[1]);
  const [copied, setCopied] = useState(false);
  const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/wallet" className="text-sm text-tiger-orange">Wallet</Link>
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-white mb-2">Deposit</h1>
        <p className="text-gray-400 mb-6">Get your deposit address</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
          {NETWORKS.map((net) => (
            <button key={net.id} onClick={() => setSelected(net)}
              className={`rounded-lg border p-3 text-center ${selected.id === net.id ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"}`}>
              <div className="font-bold text-white">{net.symbol}</div>
              <div className="text-xs text-gray-400">{net.network}</div>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 text-center">
            <div className="mb-2 text-sm text-gray-400">Deposit {selected.symbol} on {selected.network}</div>
            <div className="text-sm text-red-400">Only send {selected.symbol} to this address</div>
          </div>

          <div className="mb-4 rounded-lg bg-white p-4">
            <div className="flex justify-center">
              <QrCode className="h-32 w-32 text-black" />
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm text-gray-400 mb-1">Deposit Address</div>
            <div className="font-mono text-sm text-white break-all">{address}</div>
          </div>

          <button onClick={handleCopy} className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white flex items-center justify-center gap-2">
            {copied ? <CheckCircle className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            {copied ? "Copied!" : "Copy Address"}
          </button>

          <div className="mt-4 text-sm text-gray-400">
            <div>Min deposit: {selected.minDeposit} {selected.symbol}</div>
            <div className="mt-1">Deposits require {selected.network === "BTC" ? "3" : "1"} confirmations</div>
          </div>
        </div>
      </div>
    </div>
  );
}