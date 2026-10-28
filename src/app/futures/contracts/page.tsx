'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface Contract {
  id: string;
  symbol: string;
  contract_type?: string;
  contract_size?: number;
  price_precision?: number;
  quantity_precision?: number;
  min_quantity?: number;
  max_quantity?: number;
  max_leverage?: number;
  status?: string;
}

function formatNumber(value: number | undefined | null, digits = 8): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function FuturesContractsPage() {
  const contracts = useApiResource<unknown>('/api/futures/contracts');
  const list = useMemo(() => toArray<Contract>(contracts.data), [contracts.data]);
  const [selectedType, setSelectedType] = useState('all');

  const types = useMemo(() => {
    const found = new Set<string>();
    for (const contract of list) {
      if (contract.contract_type) found.add(contract.contract_type);
    }
    return ['all', ...Array.from(found)];
  }, [list]);

  const filtered =
    selectedType === 'all' ? list : list.filter((c) => c.contract_type === selectedType);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Futures Contract Specifications</h1>
          <button
            onClick={contracts.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {contracts.loading && <p className="text-sm text-gray-400">Loading contracts…</p>}
        {contracts.error && (
          <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
            Contracts are unavailable: {contracts.error}
          </div>
        )}

        {!contracts.loading && !contracts.error && (
          <>
            {list.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-4">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`rounded-lg px-4 py-2 ${
                      selectedType === type ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                  >
                    {type === 'all' ? 'All Contracts' : type}
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="rounded-lg bg-gray-800 px-6 py-10 text-center text-gray-400">
                No futures contracts are listed. Contracts appear here once an admin lists them.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg bg-gray-800">
                <table className="min-w-full">
                  <thead className="bg-gray-700">
                    <tr>
                      {['Symbol', 'Type', 'Contract Size', 'Price Precision', 'Quantity Precision', 'Min Qty', 'Max Qty', 'Max Leverage'].map(
                        (heading) => (
                          <th
                            key={heading}
                            className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-300"
                          >
                            {heading}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {filtered.map((c) => (
                      <tr key={c.id || c.symbol} className="hover:bg-gray-750">
                        <td className="px-6 py-4 font-medium">{c.symbol}</td>
                        <td className="px-6 py-4">{c.contract_type || '—'}</td>
                        <td className="px-6 py-4">{formatNumber(c.contract_size)}</td>
                        <td className="px-6 py-4">{c.price_precision ?? '—'}</td>
                        <td className="px-6 py-4">{c.quantity_precision ?? '—'}</td>
                        <td className="px-6 py-4">{formatNumber(c.min_quantity)}</td>
                        <td className="px-6 py-4">{formatNumber(c.max_quantity)}</td>
                        <td className="px-6 py-4">{c.max_leverage ? `${c.max_leverage}x` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
