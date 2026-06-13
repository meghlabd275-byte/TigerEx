"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Rocket, 
  Clock, 
  Users,
  ArrowRight,
  CheckCircle,
  Info,
  TrendingUp
} from "lucide-react";

const LAUNCHPAD_TOKENS = [
  { 
    id: 1, 
    name: "Nebula AI", 
    symbol: "NEB",
    price: 0.025,
    listingPrice: 0.15,
    allocation: 500000,
    hardCap: 5000000,
    participants: 4523,
    endsIn: "2d 14h",
    status: "live",
    roi: "500%"
  },
  { 
    id: 2, 
    name: "ChainVault", 
    symbol: "CVT",
    price: 0.0012,
    listingPrice: 0.008,
    allocation: 1000000,
    hardCap: 2000000,
    participants: 2341,
    endsIn: "5d 8h",
    status: "live",
    roi: "567%"
  },
];

export default function LaunchpadPage() {
  const [selectedToken, setSelectedToken] = useState<typeof LAUNCHPAD_TOKENS[0]>(LAUNCHPAD_TOKENS[0]);
  const [allocation, setAllocation] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
                <span className="text-xl font-bold text-white">T</span>
              </div>
              <span className="text-xl font-bold text-white">TigerEx</span>
            </Link>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/earn" className="text-sm text-tiger-orange hover:text-white">Earn</Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white">Wallet</Link>
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">Launchpad</h1>
          <p className="text-gray-400">Participate in exclusive token sales</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <h3 className="mb-4 text-lg font-semibold text-white">Active Sales</h3>
            <div className="space-y-3">
              {LAUNCHPAD_TOKENS.map((token) => (
                <button
                  key={token.id}
                  onClick={() => setSelectedToken(token)}
                  className={`w-full rounded-lg border p-4 text-left ${
                    selectedToken.id === token.id ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-tiger-orange">
                        <span className="font-bold text-white">{token.symbol[0]}</span>
                      </div>
                      <div>
                        <div className="font-bold text-white">{token.name}</div>
                        <div className="text-sm text-gray-400">${token.symbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm text-gray-400">
                        <Clock className="h-4 w-4" />
                        {token.endsIn}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">ROI</span>
                      <span className="text-green-400 font-mono">{token.roi}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Participants</span>
                      <span className="text-white">{token.participants.toLocaleString()}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">{selectedToken.name} Sale</h3>
            <div className="mb-4 rounded-lg bg-white/5 p-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Price</span>
                <span className="font-mono text-white">${selectedToken.price}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Listing Price</span>
                <span className="font-mono text-white">${selectedToken.listingPrice}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Your Allocation</span>
                <span className="font-mono text-white">{selectedToken.allocation.toLocaleString()} {selectedToken.symbol}</span>
              </div>
            </div>
            <div className="mb-4">
              <input
                type="number"
                value={allocation}
                onChange={(e) => setAllocation(e.target.value)}
                placeholder="Amount in USDT"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
              />
            </div>
            <button className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">
              Participate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}