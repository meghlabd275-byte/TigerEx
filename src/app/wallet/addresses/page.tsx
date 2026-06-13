"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Copy, Trash2, Edit2, Wallet } from "lucide-react";

const ADDRESS_BOOK = [
  { id: 1, label: "My Wallet", address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", network: "ETH", coin: "ETH" },
  { id: 2, label: "Hardware Wallet", address: "0x1234567890abcdef1234567890abcdef12345678", network: "ETH", coin: "BTC" },
  { id: 3, label: "MetaMask", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", network: "BTC", coin: "BTC" },
];

export default function AddressesPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");

  const handleCopy = (addr: string) => {
    navigator.clipboard.writeText(addr);
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
        <h1 className="text-3xl font-bold text-white mb-2">Address Book</h1>
        <p className="text-gray-400 mb-6">Manage your saved addresses</p>

        <button onClick={() => setShowAdd(!showAdd)} className="mb-4 rounded-lg bg-tiger-orange px-4 py-2 font-bold text-white flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Address
        </button>

        {showAdd && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2">
              <label className="mb-1 block text-sm text-gray-400">Label</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Wallet"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 px-3 text-white" />
            </div>
            <div className="mb-2">
              <label className="mb-1 block text-sm text-gray-400">Address</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x..."
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 px-3 font-mono text-white" />
            </div>
            <button className="rounded-lg bg-tiger-orange px-4 py-2 text-white">Save</button>
          </div>
        )}

        <div className="space-y-3">
          {ADDRESS_BOOK.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between">
                <div className="font-medium text-white">{entry.label}</div>
                <div className="flex gap-2">
                  <button onClick={() => handleCopy(entry.address)} className="text-gray-400 hover:text-white">
                    <Copy className="h-4 w-4" />
                  </button>
                  <button className="text-gray-400 hover:text-white">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button className="text-red-400 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-1 font-mono text-sm text-gray-400 break-all">{entry.address}</div>
              <div className="mt-1 text-sm text-gray-400">{entry.coin} - {entry.network}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}