'use client';

import { useEffect, useMemo, useState } from 'react';

interface Derivative {
  symbol: string;
  type: string;
  status: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/$/, '');

export default function FuturesDerivativesPage() {
  const [selectedType, setSelectedType] = useState('perpetual');
  const [derivatives, setDerivatives] = useState<Derivative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadContracts() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_BASE + '/futures/contracts', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
          throw new Error(payload?.error?.message || 'Futures contract metadata is unavailable.');
        }
        setDerivatives(payload.data.filter((item: unknown): item is Derivative =>
          !!item && typeof item === 'object' &&
          typeof (item as Derivative).symbol === 'string' &&
          typeof (item as Derivative).type === 'string' &&
          typeof (item as Derivative).status === 'string'
        ));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setDerivatives([]);
          setError(cause instanceof Error ? cause.message : 'Unable to load futures contracts.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadContracts();
    return () => controller.abort();
  }, []);

  const filtered = useMemo(
    () => derivatives.filter(item => item.type.toLowerCase() === selectedType && item.status.toLowerCase() === 'active'),
    [derivatives, selectedType],
  );

  return (
    <main className="min-h-screen bg-gray-900 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-2 text-2xl font-bold">Futures Derivatives</h1>
        <p className="mb-6 text-sm text-gray-400">
          Contract metadata is loaded from TigerEx. Price, funding, volume and open-interest figures are withheld until connected to verified live feeds.
        </p>

        <div className="mb-6 flex flex-wrap gap-3">
          {['perpetual', 'delivery', 'quarterly'].map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`rounded-lg px-4 py-2 capitalize ${selectedType === type ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              {type}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
          <table className="min-w-full">
            <thead className="bg-gray-700">
              <tr>
                {['Symbol', 'Price', '24h Change', '24h Volume', 'Open Interest', 'Funding Rate', 'Next Funding', 'Execution'].map(label => (
                  <th key={label} className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-300">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading ? (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">Loading contract metadata…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">
                  No configured active {selectedType} contracts were returned by the backend.
                </td></tr>
              ) : filtered.map(contract => (
                <tr key={contract.symbol}>
                  <td className="px-4 py-4 font-medium">{contract.symbol}</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4 text-gray-500">—</td>
                  <td className="px-4 py-4">
                    <span className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300">Unavailable</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Futures orders are disabled by the backend until durable matching, margin accounting, and liquidation controls are connected.
        </p>
      </div>
    </main>
  );
}
