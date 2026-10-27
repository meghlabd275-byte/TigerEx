"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { User, Star, Shield, Clock, RefreshCw } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface P2PAd {
  id: string;
  userId?: string;
  user?: string;
  type?: string;
  asset?: string;
  fiatCurrency?: string;
  priceType?: string;
  fixedPrice?: number;
  price?: number;
  minAmount?: number;
  maxAmount?: number;
  paymentMethods?: string[];
  status?: string;
  completedOrders?: number;
  rating?: number;
  avgCompletionTime?: number;
  terms?: string;
}

function adPrice(ad: P2PAd): number | null {
  const value = ad.fixedPrice ?? ad.price;
  return value === undefined || value === null || Number.isNaN(value) ? null : value;
}

function adRating(ad: P2PAd): string {
  if (ad.rating === undefined || ad.rating === null) return "—";
  const percent = ad.rating <= 1 ? ad.rating * 100 : ad.rating;
  return `${percent.toFixed(1)}%`;
}

function shortUser(ad: P2PAd): string {
  const id = ad.user || ad.userId || "—";
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default function P2PPage() {
  const ads = useApiResource<unknown>("/api/p2p/ads");
  const methods = useApiResource<unknown>("/api/p2p/paymentMethods");

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [crypto, setCrypto] = useState("USDT");
  const [fiat, setFiat] = useState("USD");
  const [payment, setPayment] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const adList = useMemo(() => toArray<P2PAd>(ads.data), [ads.data]);
  const methodList = useMemo(() => {
    const raw = toArray<{ name?: string; method?: string }>(methods.data).map(
      (m) => m.name || m.method || ""
    );
    return ["All", ...raw.filter(Boolean)];
  }, [methods.data]);

  const filteredAds = useMemo(
    () =>
      adList.filter((ad) => {
        if (side === "buy" && (ad.type || "").toLowerCase() !== "sell") return false;
        if (side === "sell" && (ad.type || "").toLowerCase() !== "buy") return false;
        if (ad.asset && ad.asset.toUpperCase() !== crypto.toUpperCase()) return false;
        if (ad.fiatCurrency && ad.fiatCurrency.toUpperCase() !== fiat.toUpperCase()) return false;
        if (payment !== "All" && !(ad.paymentMethods || []).includes(payment)) return false;
        return true;
      }),
    [adList, side, crypto, fiat, payment]
  );

  const selected = filteredAds.find((ad) => ad.id === selectedId) ?? null;

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
            <Link href="/markets" className="text-sm text-gray-300 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/trade/BTC-USDT" className="text-sm text-gray-300 hover:text-white transition-colors">
              Spot
            </Link>
            <Link href="/p2p" className="text-sm text-tiger-orange hover:text-white transition-colors">
              P2P
            </Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">
              Earn
            </Link>
            <Link href="/wallet" className="text-sm text-gray-300 hover:text-white transition-colors">
              Wallet
            </Link>
          </nav>

          <button
            onClick={ads.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">P2P Trading</h1>
          <p className="text-gray-400">Buy and sell crypto directly with other users</p>
        </div>

        {ads.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load P2P ads: {ads.error}
          </div>
        )}

        {/* Buy/Sell Tabs */}
        <div className="mb-6 grid max-w-md grid-cols-2 gap-4">
          <button
            onClick={() => setSide("buy")}
            className={`rounded-lg py-3 font-bold transition-colors ${
              side === "buy"
                ? "bg-green-600 text-white"
                : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
            }`}
          >
            Buy {crypto}
          </button>
          <button
            onClick={() => setSide("sell")}
            className={`rounded-lg py-3 font-bold transition-colors ${
              side === "sell"
                ? "bg-red-600 text-white"
                : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
            }`}
          >
            Sell {crypto}
          </button>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <select
            value={crypto}
            onChange={(e) => setCrypto(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white"
          >
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="USDC">USDC</option>
          </select>
          <select
            value={fiat}
            onChange={(e) => setFiat(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="BDT">BDT</option>
          </select>
          <select
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white"
          >
            {methodList.map((pm) => (
              <option key={pm} value={pm}>
                {pm}
              </option>
            ))}
          </select>
        </div>

        {/* P2P Ads */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <div className="grid grid-cols-5 border-b border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-400">
            <div>Advertiser</div>
            <div className="text-right">Price/{crypto}</div>
            <div className="text-right">Limits</div>
            <div className="text-right">Payment</div>
            <div className="text-right">Action</div>
          </div>

          {ads.loading && <p className="px-4 py-6 text-sm text-gray-500">Loading ads…</p>}
          {!ads.loading && !ads.error && filteredAds.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">
              No P2P ads match these filters.
            </p>
          )}

          <div className="max-h-[400px] overflow-y-auto">
            {filteredAds.map((ad) => {
              const price = adPrice(ad);
              return (
                <div
                  key={ad.id}
                  className={`grid cursor-pointer grid-cols-5 items-center border-b border-white/5 px-4 py-4 hover:bg-white/5 ${
                    selectedId === ad.id ? "bg-tiger-orange/20" : ""
                  }`}
                  onClick={() => setSelectedId(ad.id)}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                        <User className="h-4 w-4 text-gray-400" />
                      </div>
                      <div>
                        <div className="font-medium text-white">{shortUser(ad)}</div>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          {adRating(ad)} • {ad.completedOrders ?? 0} trades
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono text-lg text-white">
                    {price === null ? "—" : `${price.toLocaleString()} ${ad.fiatCurrency || fiat}`}
                  </div>
                  <div className="text-right text-gray-300">
                    {(ad.minAmount ?? 0).toLocaleString()} - {(ad.maxAmount ?? 0).toLocaleString()}
                  </div>
                  <div className="text-right text-gray-300">
                    {(ad.paymentMethods || []).join(", ") || "—"}
                  </div>
                  <div className="text-right">
                    <button
                      className={`rounded-lg px-4 py-2 font-medium ${
                        side === "buy" ? "bg-green-600 text-white" : "bg-red-600 text-white"
                      }`}
                    >
                      {side === "buy" ? "Buy" : "Sell"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Ad Details */}
        {selected && (
          <div className="mt-6 rounded-xl border border-tiger-orange bg-tiger-orange/20 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">
                  {side === "buy" ? "Buy" : "Sell"} {selected.asset || crypto} with{" "}
                  {shortUser(selected)}
                </h3>
                <div className="mt-2 flex items-center gap-4 text-gray-400">
                  <div className="flex items-center gap-1">
                    <Shield className="h-4 w-4 text-green-400" />
                    <span>Escrow protected</span>
                  </div>
                  {selected.avgCompletionTime ? (
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{selected.avgCompletionTime} min avg. completion</span>
                    </div>
                  ) : null}
                </div>
                {selected.terms && (
                  <p className="mt-2 max-w-lg text-sm text-gray-400">{selected.terms}</p>
                )}
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-white">
                  {adPrice(selected) === null
                    ? "—"
                    : adPrice(selected)!.toLocaleString()}
                </div>
                <div className="text-sm text-gray-400">
                  {selected.fiatCurrency || fiat} per {selected.asset || crypto}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* P2P Info */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Shield className="mb-2 h-8 w-8 text-green-400" />
            <h3 className="font-semibold text-white">Escrow Protection</h3>
            <p className="text-sm text-gray-400">
              Your funds are held by the escrow system until the trade is complete.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Clock className="mb-2 h-8 w-8 text-tiger-orange" />
            <h3 className="font-semibold text-white">Fast Settlements</h3>
            <p className="text-sm text-gray-400">
              Most trades complete within minutes with instant payment methods.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Star className="mb-2 h-8 w-8 text-yellow-400" />
            <h3 className="font-semibold text-white">Verified Traders</h3>
            <p className="text-sm text-gray-400">
              Trade with verified users with proven track records and ratings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
