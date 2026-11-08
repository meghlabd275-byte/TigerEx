'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { toArray } from '@/lib/useApiResource';

/**
 * Live coverage of the venue's own listings.
 *
 * Each figure is a count of what the exchange has actually listed, read from
 * the same endpoints the trading views use. Nothing here is a marketing number:
 * a category with no listing reports zero, and a failing endpoint is shown as an
 * error rather than a blank success.
 */
const SOURCES: Array<{ key: string; label: string; path: string; href: string }> = [
  { key: 'spot', label: 'Spot pairs', path: '/api/markets', href: '/spot' },
  { key: 'futures', label: 'Futures & perpetual contracts', path: '/api/futures/contracts', href: '/futures' },
  { key: 'options', label: 'Options contracts', path: '/api/options/contracts', href: '/options' },
  { key: 'margin', label: 'Margin pools', path: '/api/margin/markets', href: '/margin' },
  { key: 'tradfi', label: 'TradFi instruments', path: '/api/tradfi/markets', href: '/tradfi' },
  { key: 'earn', label: 'Earn products', path: '/api/earn/products', href: '/earn' },
];

interface Coverage {
  key: string;
  label: string;
  href: string;
  count: number | null;
  error: string | null;
}

export default function FeaturesPage() {
  const [coverage, setCoverage] = useState<Coverage[]>(
    SOURCES.map((source) => ({ key: source.key, label: source.label, href: source.href, count: null, error: null })),
  );
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all(
      SOURCES.map(async (source) => {
        try {
          const response = await fetch(source.path, { cache: 'no-store' });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            return { ...source, count: null, error: body?.error?.message ?? `status ${response.status}` };
          }
          return { ...source, count: toArray<unknown>(body).length, error: null };
        } catch (err: unknown) {
          return { ...source, count: null, error: err instanceof Error ? err.message : 'Request failed' };
        }
      }),
    ).then((results) => {
      setCoverage(results.map(({ key, label, href, count, error }) => ({ key, label, href, count, error })));
      setLoading(false);
    });
  };

  useEffect(load, []);

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">What is listed on TigerEx</h1>
            <p className="text-gray-400">Counts read live from the exchange&apos;s own listings.</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {coverage.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="rounded-xl bg-[#14141A] p-4 transition hover:bg-[#1E1E24]"
            >
              <p className="text-sm text-gray-400">{item.label}</p>
              <p className="mt-1 text-2xl font-bold">
                {loading ? '…' : item.error ? '—' : item.count}
              </p>
              {item.error && <p className="mt-1 text-xs text-red-400">{item.error}</p>}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
