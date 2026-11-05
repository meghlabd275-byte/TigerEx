'use client';

/**
 * Futures contract directory.
 *
 * Contract metadata and the live mark price, index price and funding rate come
 * from the exchange's own `futures_markets` and `funding_rates` rows. A contract
 * that has not been funded yet shows a dash for those columns rather than a
 * zero, which would be a fabricated price.
 */

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface Contract {
  id?: string;
  symbol: string;
  contract_type?: string;
  contractType?: string;
  listingType?: string;
  settlementAsset?: string;
  max_leverage?: number;
  maxLeverage?: number;
  funding_rate?: number | null;
  fundingRate?: number | null;
  mark_price?: number | null;
  markPrice?: number | null;
  index_price?: number | null;
  indexPrice?: number | null;
  status: string;
}

const LISTING_TYPES = ['perpetual', 'quarterly', 'bi_quarterly', 'delivery'] as const;

function formatPrice(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatRate(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(4)}%`;
}

export default function FuturesDerivativesPage() {
  const [selectedType, setSelectedType] = useState<string>('perpetual');
  const contracts = useApiResource<unknown>(`/api/futures/contracts?listingType=${selectedType}`);

  const derivatives = useMemo(() => toArray<Contract>(contracts.data), [contracts.data]);

  const filtered = useMemo(
    () => derivatives.filter((item) => String(item.status).toLowerCase() === 'active'),
    [derivatives],
  );

  return (
    <main className="min-h-screen bg-gray-900 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Futures Derivatives</h1>
          <button
            type="button"
            onClick={contracts.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <p className="mb-6 text-sm text-gray-400">
          Contract metadata, mark price, index price and funding rate are read from the exchange&apos;s
          own futures markets and funding history. A contract with no funding observation yet shows a
          dash.
        </p>

        <div className="mb-6 flex flex-wrap gap-3">
          {LISTING_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`rounded-lg px-4 py-2 capitalize ${
                selectedType === type ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {type.replace('_', ' ')}
            </button>
          ))}
        </div>

        {contracts.error && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            {contracts.error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
          <table className="min-w-full">
            <thead className="bg-gray-700">
              <tr>
                {['Symbol', 'Settlement', 'Max Leverage', 'Mark Price', 'Index Price', 'Funding Rate', 'Status'].map(
                  (label) => (
                    <th key={label} className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-300">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {contracts.loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-400">
                    Loading contract metadata…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-400">
                    No active {selectedType.replace('_', ' ')} contracts are listed.
                  </td>
                </tr>
              ) : (
                filtered.map((contract) => (
                  <tr key={contract.symbol}>
                    <td className="px-4 py-4 font-medium">{contract.symbol}</td>
                    <td className="px-4 py-4 text-gray-300">{contract.settlementAsset ?? '—'}</td>
                    <td className="px-4 py-4 text-gray-300">
                      {contract.maxLeverage ?? contract.max_leverage ?? '—'}x
                    </td>
                    <td className="px-4 py-4 text-gray-300">
                      {formatPrice(contract.markPrice ?? contract.mark_price)}
                    </td>
                    <td className="px-4 py-4 text-gray-300">
                      {formatPrice(contract.indexPrice ?? contract.index_price)}
                    </td>
                    <td className="px-4 py-4 text-gray-300">
                      {formatRate(contract.fundingRate ?? contract.funding_rate)}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded bg-gray-700 px-3 py-1.5 text-xs capitalize text-gray-300">
                        {contract.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
