"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Tag, RefreshCw, CheckCircle } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface Coupon {
  id: string;
  code?: string;
  type?: string;
  amount?: number;
  currency?: string;
  min_requirement?: number;
  expires_at?: string;
  used_at?: string | null;
  status?: string;
}

interface RedeemResponse {
  success?: boolean;
  data?: Coupon;
  error?: string | { message?: string };
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "";
}

function formatExpiry(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function CouponsPage() {
  const coupons = useApiResource<unknown>("/api/coupons");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const list = useMemo(() => toArray<Coupon>(coupons.data), [coupons.data]);

  const redeem = async () => {
    if (!code.trim()) return;
    setResult(null);
    setSubmitting(true);
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("tigerex_access_token")
          : null;
      const response = await fetch("/api/coupons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await response.json()) as RedeemResponse;
      if (response.ok && data.success !== false) {
        setResult({ ok: true, message: "Coupon redeemed." });
        setCode("");
        coupons.reload();
      } else {
        setResult({
          ok: false,
          message: errorText(data.error) || "Could not redeem this coupon.",
        });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Could not redeem this coupon.",
      });
    } finally {
      setSubmitting(false);
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
          <button
            onClick={coupons.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="mb-2 text-3xl font-bold text-white">Coupons</h1>
        <p className="mb-6 text-gray-400">Redeem coupon codes issued to your account</p>

        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-4 text-lg font-bold text-white">Redeem Coupon</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter coupon code"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
            />
            <button
              onClick={redeem}
              disabled={submitting || !code.trim()}
              className="rounded-lg bg-tiger-orange px-6 py-3 font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Redeeming…" : "Redeem"}
            </button>
          </div>
          {result && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
                result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              {result.ok && <CheckCircle className="h-5 w-5" />}
              <span>{result.message}</span>
            </div>
          )}
        </div>

        <h3 className="mb-4 text-lg font-bold text-white">Your Coupons</h3>

        {coupons.loading && <p className="text-sm text-gray-500">Loading coupons…</p>}
        {coupons.error && (
          <p className="text-sm text-red-400">Could not load coupons: {coupons.error}</p>
        )}
        {!coupons.loading && !coupons.error && list.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-gray-500">
            <Tag className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p>You have no coupons.</p>
          </div>
        )}

        <div className="space-y-3">
          {list.map((coupon) => {
            const used = coupon.status === "used" || Boolean(coupon.used_at);
            return (
              <div key={coupon.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex justify-between">
                  <div>
                    <div className="font-mono font-bold text-white">{coupon.code || coupon.id}</div>
                    <div className="text-sm text-gray-400">
                      {coupon.type ? `Type: ${coupon.type}` : ""}
                      {coupon.min_requirement
                        ? ` • Min. requirement: ${coupon.min_requirement} ${coupon.currency || ""}`
                        : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-green-400">
                      {coupon.amount ?? "—"} {coupon.currency || ""}
                    </div>
                    <div className="text-sm text-gray-400">
                      Expires: {formatExpiry(coupon.expires_at)}
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  <span className={`text-sm ${used ? "text-gray-400" : "text-green-400"}`}>
                    {used ? "Used" : coupon.status || "Active"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
