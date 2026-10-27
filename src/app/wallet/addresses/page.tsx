"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Copy, Trash2, Wallet, RefreshCw } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface AddressEntry {
  id: string;
  label?: string;
  name?: string;
  address: string;
  network?: string;
  coin?: string;
  asset?: string;
  memo?: string;
}

export default function AddressesPage() {
  const addressBook = useApiResource<unknown>("/api/address-book");
  const entries = useMemo(() => toArray<AddressEntry>(addressBook.data), [addressBook.data]);

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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-white">Address Book</h1>
            <p className="text-gray-400">Manage your saved addresses</p>
          </div>
          <button
            onClick={addressBook.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <button
          onClick={() => setShowAdd(!showAdd)}
          className="mb-4 flex items-center gap-2 rounded-lg bg-tiger-orange px-4 py-2 font-bold text-white"
        >
          <Plus className="h-4 w-4" /> Add Address
        </button>

        {showAdd && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2">
              <label className="mb-1 block text-sm text-gray-400">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My Wallet"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
            </div>
            <div className="mb-2">
              <label className="mb-1 block text-sm text-gray-400">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-white"
              />
            </div>
            <button className="rounded-lg bg-tiger-orange px-4 py-2 text-white">Save</button>
          </div>
        )}

        {addressBook.loading && <p className="text-sm text-gray-500">Loading addresses…</p>}
        {addressBook.error && (
          <p className="text-sm text-red-400">Could not load addresses: {addressBook.error}</p>
        )}
        {!addressBook.loading && !addressBook.error && entries.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-gray-500">
            <Wallet className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p>No saved addresses yet.</p>
          </div>
        )}

        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between">
                <div className="font-medium text-white">{entry.label || entry.name || "Untitled"}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(entry.address)}
                    className="text-gray-400 hover:text-white"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button className="text-red-400 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-1 break-all font-mono text-sm text-gray-400">{entry.address}</div>
              <div className="mt-1 text-sm text-gray-400">
                {[entry.coin || entry.asset, entry.network].filter(Boolean).join(" - ")}
                {entry.memo ? ` · memo ${entry.memo}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
