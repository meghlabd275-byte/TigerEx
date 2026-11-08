'use client';

import React, { useMemo, useState } from 'react';
import { Lock, Zap, Shield, Coins, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface EarnProduct {
  id: string;
  name?: string;
  symbol?: string;
  asset?: string;
  apy?: number;
  duration?: string;
  duration_days?: number;
  min_amount?: number;
  locked?: boolean;
  type?: string;
}

interface SavingsHolding {
  id: string;
  symbol?: string;
  asset?: string;
  amount?: number;
  apy?: number;
  rewards?: number;
  status?: string;
}

function symbolOf(product: EarnProduct): string {
  return product.symbol || product.asset || '—';
}

function apyLabel(product: EarnProduct): string {
  if (product.apy === undefined || product.apy === null || Number.isNaN(product.apy)) return '—';
  const percent = Math.abs(product.apy) <= 1 ? product.apy * 100 : product.apy;
  return `${percent.toFixed(2)}%`;
}

function isLocked(product: EarnProduct): boolean {
  if (product.locked !== undefined) return product.locked;
  const kind = (product.type || '').toLowerCase();
  if (kind) return kind === 'locked' || kind === 'fixed';
  return (product.duration_days ?? 0) > 0;
}

function durationLabel(product: EarnProduct): string {
  if (product.duration) return product.duration;
  const days = product.duration_days ?? 0;
  return days > 0 ? `${days} days` : 'Flexible';
}

export default function EarnPage() {
  const [selectedType, setSelectedType] = useState('all');

  const products = useApiResource<unknown>('/api/earn/products');
  const holdings = useApiResource<unknown>('/api/savings/holdings');

  const productList = useMemo(() => toArray<EarnProduct>(products.data), [products.data]);
  const holdingList = useMemo(() => toArray<SavingsHolding>(holdings.data), [holdings.data]);

  const filteredProducts = useMemo(() => {
    if (selectedType === 'all') return productList;
    if (selectedType === 'flexible') return productList.filter((p) => !isLocked(p));
    return productList.filter((p) => isLocked(p));
  }, [productList, selectedType]);

  const avgApy = useMemo(() => {
    if (productList.length === 0) return null;
    const sum = productList.reduce((acc, p) => {
      const value = p.apy === undefined ? 0 : Math.abs(p.apy) <= 1 ? p.apy * 100 : p.apy;
      return acc + value;
    }, 0);
    return sum / productList.length;
  }, [productList]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Earn</h1>
          <button
            onClick={() => {
              products.reload();
              holdings.reload();
            }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <p className="text-gray-400 mb-6">Earn passive income on your crypto</p>

        {products.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load earn products: {products.error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Earned</p>
            <p className="text-xl font-bold text-green-500">
              {holdings.loading
                ? '…'
                : holdingList
                    .reduce((sum, h) => sum + (h.rewards ?? 0), 0)
                    .toLocaleString(undefined, { maximumFractionDigits: 8 })}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Active Investments</p>
            <p className="text-xl font-bold">
              {holdings.loading ? '…' : holdingList.length}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg. APY</p>
            <p className="text-xl font-bold text-[#FF6B35]">
              {avgApy === null ? '—' : `${avgApy.toFixed(2)}%`}
            </p>
          </div>
        </div>

        {holdings.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load your holdings: {holdings.error}
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'All', icon: <Coins className="w-4 h-4" /> },
            { id: 'flexible', label: 'Flexible', icon: <Zap className="w-4 h-4" /> },
            { id: 'locked', label: 'Fixed', icon: <Lock className="w-4 h-4" /> },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
                selectedType === type.id ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {type.icon} {type.label}
            </button>
          ))}
        </div>

        {/* Products */}
        {products.loading && <p className="text-sm text-gray-500">Loading products…</p>}
        {!products.loading && !products.error && filteredProducts.length === 0 && (
          <div className="bg-[#14141A] rounded-xl p-8 text-center text-gray-500">
            No earn products are available for this filter.
          </div>
        )}
        <div className="grid gap-3">
          {filteredProducts.map((product) => {
            const locked = isLocked(product);
            return (
              <div
                key={product.id}
                className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        locked ? 'bg-purple-500/20' : 'bg-green-500/20'
                      }`}
                    >
                      {locked ? (
                        <Lock className="w-5 h-5 text-purple-500" />
                      ) : (
                        <Zap className="w-5 h-5 text-green-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{product.name || symbolOf(product)}</p>
                      <p className="text-xs text-gray-500">
                        {durationLabel(product)}
                        {product.min_amount !== undefined &&
                          ` · Min ${product.min_amount} ${symbolOf(product)}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-green-500">{apyLabel(product)}</p>
                    <p className="text-xs text-gray-500">APY</p>
                  </div>
                  <button className="ml-4 px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg text-sm">
                    Subscribe
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Secure Savings</p>
            <p className="text-xs text-gray-500 mt-1">
              Your funds are held by TigerEx custody. Fixed-term products have early redemption
              options.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
