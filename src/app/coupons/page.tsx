"use client";

import { useState } from "react";
import Link from "next/link";
import { Tag, Gift, CheckCircle, Clock, ArrowRight } from "lucide-react";

const COUPONS = [
  { code: "WELCOME50", amount: 50, type: "USDT", minDeposit: 100, expires: "2024-12-31", claimed: true, used: false },
  { code: "DEPOSIT20", amount: 20, type: "USDT", minDeposit: 200, expires: "2024-09-30", claimed: false, used: false },
  { code: "TRADE10", amount: 10, type: "USDT", minDeposit: 0, expires: "2024-08-15", claimed: false, used: false },
];

export default function CouponsPage() {
  const [code, setCode] = useState("");
  const [claimed, setClaimed] = useState(COUPONS);

  const handleClaim = (couponCode: string) => {
    setClaimed(claimed.map(c => c.code === couponCode ? { ...c, claimed: true } : c));
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
        <h1 className="text-3xl font-bold text-white mb-2">Coupons</h1>
        <p className="text-gray-400 mb-6">Claim and redeem coupons</p>

        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-bold text-white mb-4">Claim Coupon</h3>
          <div className="flex gap-2">
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter coupon code"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white" />
            <button className="rounded-lg bg-tiger-orange px-6 py-3 font-bold text-white">Claim</button>
          </div>
        </div>

        <h3 className="text-lg font-bold text-white mb-4">Your Coupons</h3>
        <div className="space-y-3">
          {claimed.map((coupon, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between">
                <div>
                  <div className="font-mono font-bold text-white">{coupon.code}</div>
                  <div className="text-sm text-gray-400">Min deposit: {coupon.minDeposit} USDT</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-green-400">{coupon.amount} {coupon.type}</div>
                  <div className="text-sm text-gray-400">Expires: {coupon.expires}</div>
                </div>
              </div>
              <div className="mt-2 flex justify-between">
                <span className={`text-sm ${coupon.claimed ? "text-green-400" : "text-gray-400"}`}>
                  {coupon.claimed ? "✓ Claimed" : "Not claimed"}
                </span>
                {!coupon.claimed && (
                  <button onClick={() => handleClaim(coupon.code)} className="text-sm text-tiger-orange">Claim now →</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}