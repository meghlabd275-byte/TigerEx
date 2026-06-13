"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Rocket, 
  Clock, 
  TrendingUp, 
  Users,
  ArrowRight,
  Zap,
  Shield,
  Globe,
  Award
} from "lucide-react";

const PREMARKET_TOKENS = [
  { 
    id: 1, 
    name: "Nebula AI", 
    symbol: "NEB", 
    price: 0.025,
    targetPrice: 0.15,
    allocation: 500000,
    raised: 2500000,
    hardCap: 5000000,
    endsIn: "2d 14h",
    status: "live",
    description: "AI-powered decentralized computing network",
    participants: 4523
  },
  { 
    id: 2, 
    name: "ChainVault", 
    symbol: "CVT", 
    price: 0.0012,
    targetPrice: 0.008,
    allocation: 1000000,
    raised: 1200000,
    hardCap: 2000000,
    endsIn: "5d 8h",
    status: "live",
    description: "Next-gen cross-chain vault protocol",
    participants: 2341
  },
  { 
    id: 3, 
    name: "QuantumFi", 
    symbol: "QFI", 
    price: 0.045,
    targetPrice: 0.35,
    allocation: 250000,
    raised: 0,
    hardCap: 3000000,
    endsIn: "10d 0h",
    status: "upcoming",
    description: "Quantum-resistant DeFi ecosystem",
    participants: 0
  },
  { 
    id: 4, 
    name: "MetaTrade", 
    symbol: "MTX", 
    price: 0.0034,
    targetPrice: 0.025,
    allocation: 750000,
    raised: 2800000,
    hardCap: 3000000,
    endsIn: "Ended",
    status: "ended",
    description: "Social trading platform with AI signals",
    participants: 8923
  },
];

export default function PreMarketPage() {
  const [selectedToken, setSelectedToken] = useState<typeof PREMARKET_TOKENS[0] | null>(null);
  const [allocation, setAllocation] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      {/* Header */}
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
            <Link href="/markets" className="text-sm text-gray-300 hover:text-white transition-colors">Markets</Link>
            <Link href="/trade/BTC-USDT" className="text-sm text-gray-300 hover:text-white transition-colors">Spot</Link>
            <Link href="/premarket" className="text-sm text-tiger-orange hover:text-white transition-colors">Pre-market</Link>
            <Link href="/alpha" className="text-sm text-gray-300 hover:text-white transition-colors">Alpha</Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">Earn</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <button className="rounded-lg bg-tiger-orange px-4 py-2 text-sm font-medium text-white hover:bg-tiger-orange/90">Sign Up</button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8 relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600/20 to-tiger-orange/20 p-8">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-tiger-orange/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-purple-400 mb-2">
              <Rocket className="h-5 w-5" />
              <span className="text-sm font-medium">Pre-Market</span>
            </div>
            <h1 className="text-4xl font-bold text-white">Early Access Sales</h1>
            <p className="mt-2 max-w-xl text-gray-300">
              Get exclusive access to new tokens before they list on exchanges. Participate in IEOs and early token sales.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Raised</div>
            <div className="text-2xl font-bold text-white">$12.5M</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Total Participants</div>
            <div className="text-2xl font-bold text-white">15,234</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Avg. ROI</div>
            <div className="text-2xl font-bold text-green-400">+456%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Live Sales</div>
            <div className="text-2xl font-bold text-white">2</div>
          </div>
        </div>

        {/* Active Sales */}
        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-bold text-white">Active Sales</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PREMARKET_TOKENS.filter(t => t.status === "live").map((token) => (
              <div 
                key={token.id}
                onClick={() => setSelectedToken(token)}
                className={`cursor-pointer rounded-xl border bg-white/5 p-6 transition-colors hover:bg-white/10 ${
                  selectedToken?.id === token.id ? "border-tiger-orange" : "border-white/10"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-tiger-orange">
                      <span className="font-bold text-white">{token.symbol[0]}</span>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-white">{token.name}</div>
                      <div className="text-sm text-gray-400">${token.symbol}</div>
                    </div>
                  </div>
                  <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {token.endsIn}
                  </span>
                </div>

                <p className="mt-3 text-sm text-gray-400">{token.description}</p>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Progress</span>
                    <span className="text-white font-mono">{Math.round(token.raised / token.hardCap * 100)}%</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-white/10">
                    <div 
                      className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-tiger-orange" 
                      style={{ width: `${(token.raised / token.hardCap) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-gray-400">Price</div>
                    <div className="font-mono text-white">${token.price}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Target</div>
                    <div className="font-mono text-white">${token.targetPrice}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Allocation</div>
                    <div className="font-mono text-white">{token.allocation.toLocaleString()}</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-1 text-sm text-gray-400">
                    <Users className="h-4 w-4" />
                    {token.participants.toLocaleString()} participants
                  </div>
                  <button className="flex items-center gap-1 text-sm text-tiger-orange hover:text-white">
                    View Details <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Sales */}
        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-bold text-white">Upcoming Sales</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PREMARKET_TOKENS.filter(t => t.status === "upcoming").map((token) => (
              <div key={token.id} className="rounded-xl border border-white/10 bg-white/5 p-6 opacity-75">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <span className="font-bold text-white">{token.symbol[0]}</span>
                  </div>
                  <div>
                    <div className="text-xl font-bold text-white">{token.name}</div>
                    <div className="text-sm text-gray-400">${token.symbol}</div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-gray-400">{token.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-gray-400">Starts in {token.endsIn}</div>
                  <button className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/5">
                    Enable Notification
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How It Works */}
        <div>
          <h2 className="mb-4 text-2xl font-bold text-white">How Pre-Market Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tiger-orange/20 text-tiger-orange">
                1
              </div>
              <h3 className="mt-3 font-semibold text-white">Complete KYC</h3>
              <p className="text-sm text-gray-400">Verify your identity to participate in sales.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tiger-orange/20 text-tiger-orange">
                2
              </div>
              <h3 className="mt-3 font-semibold text-white">Hold Tokens</h3>
              <p className="text-sm text-gray-400">Maintain balance to qualify for allocation.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tiger-orange/20 text-tiger-orange">
                3
              </div>
              <h3 className="mt-3 font-semibold text-white">Join Sales</h3>
              <p className="text-sm text-gray-400">Purchase tokens at early stage prices.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tiger-orange/20 text-tiger-orange">
                4
              </div>
              <h3 className="mt-3 font-semibold text-white">Trade at Listing</h3>
              <p className="text-sm text-gray-400">Sell or hold when tokens list on exchange.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}