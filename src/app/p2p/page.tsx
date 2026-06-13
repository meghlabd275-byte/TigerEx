"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  User, 
  Star, 
  Shield, 
  Clock,
  MessageCircle,
  Filter,
  Search,
  ArrowRight,
  Wallet,
  CreditCard,
  Banknote,
  Building
} from "lucide-react";

const P2P_ADS = [
  { id: 1, type: "buy", user: "CryptoTrader99", rating: 98.5, trades: 1250, price: 67200, limits: [100, 5000], payment: "Bank Transfer", period: 15 },
  { id: 2, type: "buy", user: "FastTrader", rating: 99.2, trades: 890, price: 67150, limits: [50, 3000], payment: "IMPS", period: 10 },
  { id: 3, type: "sell", user: "CoinSeller", rating: 97.8, trades: 2100, price: 67300, limits: [200, 10000], payment: "Paytm", period: 15 },
  { id: 4, type: "sell", user: "QuickFlip", rating: 96.5, trades: 560, price: 67350, limits: [100, 5000], payment: "UPI", period: 5 },
  { id: 5, type: "buy", user: "BulkBuyer", rating: 99.8, trades: 3400, price: 67100, limits: [500, 50000], payment: "Bank Transfer", period: 30 },
];

const PAYMENT_METHODS = ["All", "Bank Transfer", "IMPS", "UPI", "Paytm", "Google Pay", "PhonePe", "Cash"];

export default function P2PPage() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [crypto, setCrypto] = useState("USDT");
  const [fiat, setFiat] = useState("INR");
  const [payment, setPayment] = useState("All");
  const [amount, setAmount] = useState("");
  const [selectedAd, setSelectedAd] = useState<typeof P2P_ADS[0] | null>(null);

  const filteredAds = P2P_ADS.filter(ad => {
    if (ad.type !== side) return false;
    if (payment !== "All" && ad.payment !== payment) return false;
    return true;
  });

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
            <Link href="/p2p" className="text-sm text-tiger-orange hover:text-white transition-colors">P2P</Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">Earn</Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white transition-colors">Wallet</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <button className="text-sm text-gray-300 hover:text-white">Log In</button>
            </Link>
            <Link href="/register">
              <button className="rounded-lg bg-tiger-orange px-4 py-2 text-sm font-medium text-white hover:bg-tiger-orange/90">Sign Up</button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* P2P Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">P2P Trading</h1>
          <p className="text-gray-400">Buy and sell crypto directly with other users</p>
        </div>

        {/* Buy/Sell Tabs */}
        <div className="mb-6 grid grid-cols-2 gap-4 max-w-md">
          <button
            onClick={() => setSide("buy")}
            className={`rounded-lg py-3 font-bold transition-colors ${
              side === "buy" 
                ? "bg-green-600 text-white" 
                : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
            }`}
          >
            🟢 Buy USDT
          </button>
          <button
            onClick={() => setSide("sell")}
            className={`rounded-lg py-3 font-bold transition-colors ${
              side === "sell" 
                ? "bg-red-600 text-white" 
                : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
            }`}
          >
            🔴 Sell USDT
          </button>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <select 
            value={crypto}
            onChange={(e) => setCrypto(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 py-2 px-4 text-white"
          >
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="BNB">BNB</option>
          </select>
          <select 
            value={fiat}
            onChange={(e) => setFiat(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 py-2 px-4 text-white"
          >
            <option value="INR">INR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <select 
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 py-2 px-4 text-white"
          >
            {PAYMENT_METHODS.map(pm => (
              <option key={pm} value={pm}>{pm}</option>
            ))}
          </select>
        </div>

        {/* Amount Input */}
        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="mb-2 block text-sm text-gray-400">I want to spend</label>
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 text-xl font-mono text-white"
            />
            <div className="text-xl font-bold text-white">{fiat}</div>
          </div>
          <div className="mt-2 text-sm text-gray-400">
            You'll receive: <span className="text-white font-mono">
              {amount ? (Number(amount) / 67200).toFixed(4) : "0.0000"} {crypto}
            </span>
          </div>
        </div>

        {/* P2P Ads */}
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="grid grid-cols-5 border-b border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-400">
            <div>Advertiser</div>
            <div className="text-right">Price/{crypto}</div>
            <div className="text-right">Limits</div>
            <div className="text-right">Payment</div>
            <div className="text-right">Action</div>
          </div>
          
          <div className="max-h-[400px] overflow-y-auto">
            {filteredAds.map((ad) => (
              <div 
                key={ad.id}
                className={`grid grid-cols-5 items-center border-b border-white/5 px-4 py-4 hover:bg-white/5 cursor-pointer ${
                  selectedAd?.id === ad.id ? "bg-tiger-orange/20" : ""
                }`}
                onClick={() => setSelectedAd(ad)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                      <User className="h-4 w-4 text-gray-400" />
                    </div>
                    <div>
                      <div className="font-medium text-white">{ad.user}</div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {ad.rating}% • {ad.trades} trades
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono text-lg text-white">
                  {ad.price.toLocaleString()} {fiat}
                </div>
                <div className="text-right text-gray-300">
                  {ad.limits[0].toLocaleString()} - {ad.limits[1].toLocaleString()}
                </div>
                <div className="text-right text-gray-300">
                  {ad.payment}
                </div>
                <div className="text-right">
                  <button
                    className={`rounded-lg px-4 py-2 font-medium ${
                      ad.type === "buy" 
                        ? "bg-green-600 text-white" 
                        : "bg-red-600 text-white"
                    }`}
                  >
                    {ad.type === "buy" ? "Buy" : "Sell"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Ad Details */}
        {selectedAd && (
          <div className="mt-6 rounded-xl border border-tiger-orange bg-tiger-orange/20 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">
                  {selectedAd.type === "buy" ? "Buy" : "Sell"} {crypto} with {selectedAd.user}
                </h3>
                <div className="mt-2 flex items-center gap-4 text-gray-400">
                  <div className="flex items-center gap-1">
                    <Shield className="h-4 w-4 text-green-400" />
                    <span>Escrow protected</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{selectedAd.period} min to pay</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-white">{selectedAd.price.toLocaleString()}</div>
                <div className="text-sm text-gray-400">{fiat} per {crypto}</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="mb-2 block text-sm text-gray-400">Amount ({fiat})</label>
                <input
                  type="number"
                  placeholder="Enter amount"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">Amount ({crypto})</label>
                <input
                  type="number"
                  placeholder="0.00"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white"
                />
              </div>
              <div className="flex items-end">
                <button
                  className={`w-full rounded-lg py-3 font-bold ${
                    side === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                  } text-white`}
                >
                  {side === "buy" ? "Buy Now" : "Sell Now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* P2P Info */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Shield className="mb-2 h-8 w-8 text-green-400" />
            <h3 className="font-semibold text-white">Escrow Protection</h3>
            <p className="text-sm text-gray-400">Your funds are protected by our escrow system until the trade is complete.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Clock className="mb-2 h-8 w-8 text-tiger-orange" />
            <h3 className="font-semibold text-white">Fast Settlements</h3>
            <p className="text-sm text-gray-400">Most trades complete within minutes with instant payment methods.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Star className="mb-2 h-8 w-8 text-yellow-400" />
            <h3 className="font-semibold text-white">Verified Traders</h3>
            <p className="text-sm text-gray-400">Trade with verified users with proven track records and high ratings.</p>
          </div>
        </div>
      </div>
    </div>
  );
}