"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Download, Upload, Clock } from "lucide-react";

const TRANSACTIONS = [
  { id: 1, type: "deposit", coin: "USDT", amount: 1000, time: "2024-06-10 14:30", status: "completed", tx: "0x123...abc" },
  { id: 2, type: "withdraw", coin: "BTC", amount: 0.05, time: "2024-06-09 10:15", status: "completed", tx: "0x456...def" },
  { id: 3, type: "transfer", coin: "ETH", amount: 1.5, time: "2024-06-08 16:45", status: "completed", user: "john@example.com" },
  { id: 4, type: "trade", coin: "USDT", amount: -250, time: "2024-06-07 09:20", status: "completed", pair: "BTC/USDT" },
  { id: 5, type: "deposit", coin: "ETH", amount: 2.0, time: "2024-06-06 11:00", status: "pending", tx: "0x789...ghi" },
];

export default function HistoryPage() {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? TRANSACTIONS : TRANSACTIONS.filter(t => t.type === filter);

  const getIcon = (type: string) => {
    switch(type) {
      case "deposit": return <ArrowDownLeft className="h-4 w-4 text-green-400" />;
      case "withdraw": return <ArrowUpRight className="h-4 w-4 text-red-400" />;
      case "transfer": return <ArrowRightLeft className="h-4 w-4 text-blue-400" />;
      default: return <Download className="h-4 w-4 text-tiger-orange" />;
    }
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
        <h1 className="text-3xl font-bold text-white mb-2">Transaction History</h1>
        <p className="text-gray-400 mb-6">View all your transactions</p>

        <div className="mb-4 flex gap-2">
          {["all", "deposit", "withdraw", "transfer", "trade"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-2 text-sm ${filter === f ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="grid grid-cols-5 border-b border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-400">
            <div>Type</div>
            <div>Asset</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Date</div>
            <div className="text-right">Status</div>
          </div>
          {filtered.map((tx) => (
            <div key={tx.id} className="grid grid-cols-5 items-center border-b border-white/5 px-4 py-4 hover:bg-white/5">
              <div className="flex items-center gap-2">
                {getIcon(tx.type)}
                <span className="text-white capitalize">{tx.type}</span>
              </div>
              <div className="font-medium text-white">{tx.coin}</div>
              <div className={`text-right font-mono ${tx.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                {tx.amount >= 0 ? "+" : ""}{tx.amount}
              </div>
              <div className="text-right text-gray-400">{tx.time}</div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-1 text-xs ${tx.status === "completed" ? "bg-green-600/20 text-green-400" : "bg-yellow-600/20 text-yellow-400"}`}>
                  {tx.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <button className="mt-4 w-full rounded-lg border border-white/10 py-3 text-gray-400 hover:text-white">
          Load More
        </button>
      </div>
    </div>
  );
}