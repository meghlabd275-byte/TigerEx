"use client";

import { useState } from "react";
import Link from "next/link";
import { Gift, Users, DollarSign, Clock, ArrowRight, Share2 } from "lucide-react";

const REDPACKETS = [
  { id: 1, type: "fixed", amount: 100, count: 10, claimed: 7, user: "CryptoKing", coin: "USDT", status: "active" },
  { id: 2, type: "random", amount: 50, count: 5, claimed: 5, user: "TraderJoe", coin: "USDT", status: "ended" },
];

export default function RedPacketPage() {
  const [mode, setMode] = useState<"create" | "receive">("receive");
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("10");
  const [code, setCode] = useState("");

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
        <h1 className="text-3xl font-bold text-white mb-2">Red Packets</h1>
        <p className="text-gray-400 mb-6">Share crypto with friends</p>

        <div className="mb-6 flex gap-2">
          <button onClick={() => setMode("receive")} className={`px-6 py-2 rounded-lg ${mode === "receive" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"}`}>
            Receive
          </button>
          <button onClick={() => setMode("create")} className={`px-6 py-2 rounded-lg ${mode === "create" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"}`}>
            Create
          </button>
        </div>

        {mode === "receive" ? (
          <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Open Red Packet</h3>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter red packet code"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white mb-4" />
            <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">Open</button>
          </div>
        ) : (
          <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Create Red Packet</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Type</label>
              <div className="flex gap-2">
                <button onClick={() => {}} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-white">Fixed</button>
                <button onClick={() => {}} className="flex-1 rounded-lg bg-tiger-orange py-2 text-white">Random</button>
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Total Amount (USDT)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Number of Packets</label>
              <input type="number" value={count} onChange={(e) => setCount(e.target.value)} placeholder="10"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
            </div>
            <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">Create & Share</button>
          </div>
        )}

        <h3 className="text-lg font-bold text-white mt-8 mb-4">Recent Red Packets</h3>
        <div className="space-y-3">
          {REDPACKETS.map((rp, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between">
                <div>
                  <div className="font-bold text-white">{rp.type === "fixed" ? "Fixed" : "Random"} - {rp.user}</div>
                  <div className="text-sm text-gray-400">{rp.claimed}/{rp.count} claimed</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-white">{rp.amount} {rp.coin}</div>
                  <div className={`text-sm ${rp.status === "active" ? "text-green-400" : "text-gray-400"}`}>{rp.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}