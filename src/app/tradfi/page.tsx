'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface TradFiInstrument {
  id: string;
  symbol: string;
  instrumentType: string;
  settlementAsset: string;
  priceSource: string;
  referenceSymbol: string;
  tickSize: number;
  maxLeverage: number;
  makerFeeBps: number;
  takerFeeBps: number;
  tradingHours: string;
  lastPrice: number | null;
  status: string;
}

function fmt(value: number | null | undefined, digits = 6): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function TradFiPage() {
  const markets = useApiResource<unknown>('/api/tradfi/markets');
  const instruments = useMemo(() => toArray<TradFiInstrument>(markets.data), [markets.data]);

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">TradFi</h1>
            <p className="text-gray-400">
              Stocks, forex, commodities and indices listed on the exchange. A last price is shown only
              once the instrument has traded here.
            </p>
          </div>
          <button
            onClick={markets.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {markets.loading && <p className="text-sm text-gray-500">Loading instruments…</p>}
        {markets.error && <p className="text-sm text-red-400">Could not load instruments: {markets.error}</p>}
        {!markets.loading && !markets.error && instruments.length === 0 && (
          <p className="text-sm text-gray-500">No TradFi instruments are listed yet.</p>
        )}

        {instruments.length > 0 && (
          <div className="overflow-x-auto rounded-xl bg-[#14141A] p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Settles in</th>
                  <th className="pb-2">Reference</th>
                  <th className="pb-2 text-right">Last price</th>
                  <th className="pb-2 text-right">Max leverage</th>
                  <th className="pb-2 text-right">Maker / Taker</th>
                  <th className="pb-2">Hours</th>
                </tr>
              </thead>
              <tbody>
                {instruments.map((instrument) => (
                  <tr key={instrument.id} className="border-t border-white/5">
                    <td className="py-2">{instrument.symbol}</td>
                    <td className="py-2 capitalize">{instrument.instrumentType}</td>
                    <td className="py-2">{instrument.settlementAsset}</td>
                    <td className="py-2 text-xs text-gray-400">{instrument.referenceSymbol || instrument.priceSource}</td>
                    <td className="py-2 text-right">{fmt(instrument.lastPrice)}</td>
                    <td className="py-2 text-right">{instrument.maxLeverage}x</td>
                    <td className="py-2 text-right">
                      {(instrument.makerFeeBps / 100).toFixed(4)}% / {(instrument.takerFeeBps / 100).toFixed(4)}%
                    </td>
                    <td className="py-2 text-xs capitalize text-gray-400">{instrument.tradingHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
