"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Lock,
  Clock,
  Coins,
  Zap,
  Shield,
  PiggyBank,
  Rocket,
  RefreshCw,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface StakingPool {
  id: string;
  name?: string;
  asset?: string;
  network?: string;
  duration?: number;
  apy?: number;
  min_stake?: number;
  max_stake?: number;
  total_staked?: number;
  reward_pool?: number;
  status?: string;
}

interface EarnProduct {
  id: string;
  name?: string;
  asset?: string;
  product_type?: string;
  apy?: number;
  duration?: number;
  lock_period?: number;
  min_amount?: number;
  max_amount?: number;
  total_deposited?: number;
  total_rewards?: number;
  status?: string;
}

function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null || Number.isNaN(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function apyLabel(apy: number | undefined): string {
  if (apy === undefined || apy === null || Number.isNaN(apy)) return "—";
  const percent = Math.abs(apy) <= 1 ? apy * 100 : apy;
  return `${percent.toFixed(2)}%`;
}

export default function EarnPage() {
  const [activeTab, setActiveTab] = useState<"staking" | "earn">("staking");

  const pools = useApiResource<unknown>("/api/staking/pools");
  const products = useApiResource<unknown>("/api/earn/products");

  const poolList = useMemo(() => toArray<StakingPool>(pools.data), [pools.data]);
  const productList = useMemo(() => toArray<EarnProduct>(products.data), [products.data]);

  const bestApy = useMemo(() => {
    const values = [...poolList, ...productList]
      .map((item) => {
        const apy = (item as { apy?: number }).apy;
        if (apy === undefined || apy === null) return null;
        return Math.abs(apy) <= 1 ? apy * 100 : apy;
      })
      .filter((v): v is number => v !== null);
    return values.length ? Math.max(...values) : null;
  }, [poolList, productList]);

  const totalStaked = poolList.reduce((sum, p) => sum + (p.total_staked ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-500">
                  <span className="font-bold text-white">T</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx</span>
              </Link>
              <nav className="ml-8 hidden items-center space-x-4 md:flex">
                <Link href="/markets" className="text-gray-600 hover:text-orange-500 dark:text-gray-300">
                  Markets
                </Link>
                <Link href="/spot" className="text-gray-600 hover:text-orange-500 dark:text-gray-300">
                  Spot
                </Link>
                <Link href="/futures" className="text-gray-600 hover:text-orange-500 dark:text-gray-300">
                  Futures
                </Link>
                <Link href="/p2p" className="text-gray-600 hover:text-orange-500 dark:text-gray-300">
                  P2P
                </Link>
                <span className="font-medium text-orange-500">Earn</span>
              </nav>
            </div>
            <div className="flex items-center space-x-3">
              <Link href="/wallet" className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                <Wallet className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 p-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold">Earn Crypto Rewards</h1>
              <p className="mb-4 text-white/90">
                Stake and save to earn rewards on your crypto assets
              </p>
              <div className="flex items-center space-x-6">
                <div className="flex items-center">
                  <Shield className="mr-2 h-5 w-5" />
                  <span>Secure Staking</span>
                </div>
                <div className="flex items-center">
                  <Zap className="mr-2 h-5 w-5" />
                  <span>Transparent Rewards</span>
                </div>
                <div className="flex items-center">
                  <Coins className="mr-2 h-5 w-5" />
                  <span>Multiple Assets</span>
                </div>
              </div>
            </div>
            <Rocket className="h-32 w-32 text-white/30" />
          </div>
        </div>

        <div className="mb-8 flex space-x-4">
          {[
            { key: "staking", label: "Staking", icon: Lock },
            { key: "earn", label: "Earn", icon: PiggyBank },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as "staking" | "earn")}
              className={`flex items-center rounded-xl px-6 py-3 font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-orange-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              <tab.icon className="mr-2 h-5 w-5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Staking Tab */}
        {activeTab === "staking" && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Staking Pools</h2>
              <button
                onClick={pools.reload}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>

            {pools.error && (
              <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
                Could not load staking pools: {pools.error}
              </div>
            )}
            {pools.loading && <p className="text-sm text-gray-500">Loading staking pools…</p>}
            {!pools.loading && !pools.error && poolList.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                No staking pools are currently open.
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {poolList.map((pool) => (
                <div
                  key={pool.id}
                  className="rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-orange-500 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white">
                        {pool.asset || pool.name || "—"}
                      </h3>
                      <p className="text-sm text-gray-500">{pool.name || "Stake & Earn"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-500">{apyLabel(pool.apy)}</p>
                      <p className="text-xs text-gray-500">APY</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Lock Period</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {pool.duration ? `${pool.duration} days` : "Flexible"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Min Amount</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {pool.min_stake ?? "—"} {pool.asset}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total Staked</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatNumber(pool.total_staked)} {pool.asset}
                      </span>
                    </div>
                  </div>

                  <button className="mt-4 w-full rounded-lg bg-gradient-to-r from-orange-500 to-red-500 py-3 font-medium text-white transition-all hover:from-orange-600 hover:to-red-600">
                    Stake Now
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Earn Tab */}
        {activeTab === "earn" && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Earn Products</h2>
              <button
                onClick={products.reload}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>

            {products.error && (
              <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
                Could not load earn products: {products.error}
              </div>
            )}
            {products.loading && <p className="text-sm text-gray-500">Loading earn products…</p>}
            {!products.loading && !products.error && productList.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                No earn products are currently available.
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {productList.map((product) => {
                const kind = (product.product_type || "flexible").toLowerCase();
                return (
                  <div
                    key={product.id}
                    className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">
                          {product.name || product.asset}
                        </h3>
                        <p className="text-sm text-gray-500">{product.asset}</p>
                      </div>
                      <span
                        className={`rounded px-2 py-1 text-xs font-medium ${
                          kind === "fixed"
                            ? "bg-blue-100 text-blue-600"
                            : kind === "flexible"
                              ? "bg-green-100 text-green-600"
                              : "bg-purple-100 text-purple-600"
                        }`}
                      >
                        {kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </span>
                    </div>

                    <div className="py-4 text-center">
                      <p className="text-3xl font-bold text-green-500">{apyLabel(product.apy)}</p>
                      <p className="text-sm text-gray-500">APY</p>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Duration</span>
                        <span className="text-gray-900 dark:text-white">
                          {(product.duration ?? 0) > 0
                            ? `${product.duration} days`
                            : "Flexible"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Min Amount</span>
                        <span className="text-gray-900 dark:text-white">
                          {product.min_amount ?? "—"} {product.asset}
                        </span>
                      </div>
                    </div>

                    <button className="mt-4 w-full rounded-lg bg-gradient-to-r from-orange-500 to-red-500 py-3 font-medium text-white transition-all hover:from-orange-600 hover:to-red-600">
                      Subscribe
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Staking Pools", value: String(poolList.length), icon: Lock },
            { label: "Earn Products", value: String(productList.length), icon: PiggyBank },
            { label: "Total Staked", value: formatNumber(totalStaked), icon: Coins },
            { label: "Best APY", value: bestApy === null ? "—" : `${bestApy.toFixed(2)}%`, icon: Zap },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-800"
            >
              <stat.icon className="mx-auto mb-2 h-8 w-8 text-orange-500" />
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
