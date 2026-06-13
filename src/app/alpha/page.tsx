"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  TrendingUp, 
  TrendingDown, 
  Zap,
  Clock,
  Star,
  ArrowRight,
  Sparkles,
  Rocket,
  Target,
  Award,
  Bell
} from "lucide-react";

const ALPHA_TOKENS = [
  { id: 1, name: "New Era Token", symbol: "NEW", price: 0.0123, change: 125.6, volume: 2.3M, listing: "2024-06-15", status: "upcoming", description: "DeFi protocol with AI-powered trading" },
  { id: 2, name: "ChainLink Pro", symbol: "CLP", price: 0.0456, change: 89.4, volume: 1.2M, listing: "2024-06-12", status: "new", description: "Cross-chain oracle solution" },
  { id: 3, name: "MetaVerse X", symbol: "MVX", price: 0.2345, change: 56.7, volume: 5.6M, listing: "2024-06-10", status: "new", description: "Next-gen NFT marketplace" },
  { id: 4, name: "Quantum Chain", symbol: "QTM", price: 1.2345, change: 234.5, volume: 12.3M, listing: "2024-06-08", status: "hot", description: "Quantum-resistant blockchain" },
  { id: 5, name: "AI Trader", symbol: "AIT", price: 0.0567, change: 178.9, volume: 8.9M, listing: "2024-06-05", status: "hot", description: "AI-powered trading signals" },
];

const ALPHA_SIGNALS = [
  { id: 1, symbol: "BTC", signal: "BUY", entry: 65000, target: 72000, current: 67234.56, confidence: 92, reason: "Bullish divergence on RSI" },
  { id: 2, symbol: "ETH", signal: "BUY", entry: 3200, target: 4000, current: 3456.78, confidence: 88, reason: "Breakout above resistance" },
  { id: 3, symbol: "SOL", signal: "SELL", entry: 150, target: 120, current: 145.67, confidence: 75, reason: "Overbought conditions" },
];

export default function AlphaPage() {
  const [filter, setFilter] = useState("all");

  const filteredTokens = filter === "all" ? ALPHA_TOKENS : ALPHA_TOKENS.filter(t => t.status === filter);

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
            <Link href="/alpha" className="text-sm text-tiger-orange hover:text-white transition-colors">Alpha</Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">Earn</Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white transition-colors">Wallet</Link>
          </nav>

          <div className="flex items-center gap-3">
            <button className="rounded-lg border border-white/20 p-2 text-gray-400 hover:text-white">
              <Bell className="h-5 w-5" />
            </button>
            <Link href="/login">
              <button className="rounded-lg bg-tiger-orange px-4 py-2 text-sm font-medium text-white hover:bg-tiger-orange/90">Sign Up</button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Alpha Header */}
        <div className="mb-8 relative overflow-hidden rounded-2xl bg-gradient-to-r from-tiger-orange/20 to-purple-600/20 p-8">
          <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-transparent to-transparent" />
          <div className="relative">
            <div className="flex items-center gap-2 text-tiger-orange mb-2">
              <Sparkles className="h-5 w-5" />
              <span className="text-sm font-medium">Alpha Trading</span>
            </div>
            <h1 className="text-4xl font-bold text-white">Discover Alpha</h1>
            <p className="mt-2 max-w-xl text-gray-300">
              Stay ahead with early token listings, trading signals, and alpha opportunities from our research team.
            </p>
            <div className="mt-4 flex gap-3">
              <button className="rounded-lg bg-tiger-orange px-6 py-2 font-medium text-white hover:bg-tiger-orange/90">
                Enable Notifications
              </button>
              <button className="rounded-lg border border-white/20 px-6 py-2 font-medium text-white hover:bg-white/5">
                View Research
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Alpha ROI (30d)</div>
            <div className="text-2xl font-bold text-green-400">+156.7%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">New Listings</div>
            <div className="text-2xl font-bold text-white">23</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Active Signals</div>
            <div className="text-2xl font-bold text-white">12</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-gray-400">Win Rate</div>
            <div className="text-2xl font-bold text-green-400">78%</div>
          </div>
        </div>

        {/* Trading Signals */}
        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-bold text-white">Trading Signals</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {ALPHA_SIGNALS.map((signal) => (
              <div key={signal.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-white">{signal.symbol}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                      signal.signal === "BUY" ? "bg-green-600" : "bg-red-600"
                    } text-white`}>
                      {signal.signal}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Target className="h-3 w-3" />
                    {signal.confidence}% confidence
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Entry</span>
                    <span className="text-white font-mono">${signal.entry.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Target</span>
                    <span className="text-white font-mono">${signal.target.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Current</span>
                    <span className="text-white font-mono">${signal.current.toLocaleString()}</span>
                  </div>
                </div>
                <div className="mt-3 rounded bg-white/5 p-2 text-xs text-gray-400">
                  {signal.reason}
                </div>
                <button className="mt-3 w-full rounded-lg border border-white/10 py-2 text-sm text-white hover:bg-white/5">
                  View Analysis
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* New Token Listings */}
        <div>
          <h2 className="mb-4 text-2xl font-bold text-white">New Token Listings</h2>
          
          {/* Filters */}
          <div className="mb-4 flex gap-2">
            {["all", "upcoming", "new", "hot"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-4 py-2 text-sm ${
                  filter === f 
                    ? "bg-tiger-orange text-white" 
                    : "bg-white/5 text-gray-300 hover:bg-white/10"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Tokens */}
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="grid grid-cols-6 border-b border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-400">
              <div className="col-span-2">Token</div>
              <div className="text-right">Price</div>
              <div className="text-right">24h Change</div>
              <div className="text-right">Volume</div>
              <div className="text-right">Status</div>
            </div>
            {filteredTokens.map((token) => (
              <div key={token.id} className="grid grid-cols-6 items-center border-b border-white/5 px-4 py-4 hover:bg-white/5">
                <div className="col-span-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-tiger-orange to-purple-600">
                      <span className="font-bold text-white">{token.symbol[0]}</span>
                    </div>
                    <div>
                      <div className="font-medium text-white">{token.name}</div>
                      <div className="text-sm text-gray-400">${token.symbol}</div>
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono text-white">${token.price}</div>
                <div className={`text-right font-mono ${token.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {token.change >= 0 ? "+" : ""}{token.change}%
                </div>
                <div className="text-right text-gray-300">${token.volume}M</div>
                <div className="text-right">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    token.status === "hot" ? "bg-red-600 text-white" :
                    token.status === "new" ? "bg-green-600 text-white" :
                    "bg-yellow-600 text-white"
                  }`}>
                    {token.status === "hot" && <Zap className="mr-1 inline h-3 w-3" />}
                    {token.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How Alpha Works */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Rocket className="mb-2 h-8 w-8 text-tiger-orange" />
            <h3 className="font-semibold text-white">Early Access</h3>
            <p className="text-sm text-gray-400">Get access to tokens before they list on major exchanges.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Target className="mb-2 h-8 w-8 text-green-400" />
            <h3 className="font-semibold text-white">Trading Signals</h3>
            <p className="text-sm text-gray-400">AI-powered trading signals with entry and exit points.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Award className="mb-2 h-8 w-8 text-yellow-400" />
            <h3 className="font-semibold text-white">Research Reports</h3>
            <p className="text-sm text-gray-400">In-depth analysis and reports from our research team.</p>
          </div>
        </div>
      </div>
    </div>
  );
}