'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { marketService } from '@/lib/api/client';
import type { Market, Ticker } from '@/lib/api/types';

function number(value: string | number | undefined): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function format(value: string | number | undefined, digits = 8): string { const parsed = Number(value); return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—'; }

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { const [rows, liveTickers] = await Promise.all([marketService.getMarkets(), marketService.getTickers()]); setMarkets(rows ?? []); setTickers(liveTickers ?? {}); }
    catch (cause) { setMarkets([]); setTickers({}); setError(cause instanceof Error ? cause.message : 'Live market data is unavailable.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => markets.filter((market) => market.status === 'online' && (!showFavorites || favorites.includes(market.symbol))).filter((market) => !searchQuery || market.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || market.base_currency.toLowerCase().includes(searchQuery.toLowerCase())), [favorites, markets, searchQuery, showFavorites]);

  return <main className="min-h-screen bg-[#0a0a14] text-white"><header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/10 bg-[#0d0d1a]/95 px-4"><div className="flex items-center gap-4"><Link href="/" className="text-xl font-bold">TigerEx</Link><h1 className="font-semibold">Markets</h1></div><button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm"><RefreshCw size={15} /> Refresh</button></header><section className="space-y-4 p-4">{error && <div role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">{error}</div>}<div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search live markets" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm" /></div><button onClick={() => setShowFavorites(!showFavorites)} className={`rounded-lg px-3 ${showFavorites ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/5 text-gray-400'}`}><Star size={18} fill={showFavorites ? 'currentColor' : 'none'} /></button></div><div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d1a]">{loading ? <p className="p-8 text-sm text-gray-500">Loading verified market metadata and tickers…</p> : rows.length === 0 ? <p className="p-8 text-sm text-gray-500">No live markets are configured. The exchange will not display synthetic prices.</p> : <div className="divide-y divide-white/5">{rows.map((market) => { const ticker = tickers[market.symbol]; const change = number(ticker?.price_change_percent); const favorite = favorites.includes(market.symbol); return <div key={market.symbol} className="grid grid-cols-4 items-center gap-3 p-4 hover:bg-white/5"><div className="flex items-center gap-2"><button onClick={() => setFavorites((current) => favorite ? current.filter((symbol) => symbol !== market.symbol) : [...current, market.symbol])} className="text-gray-500 hover:text-yellow-300"><Star size={16} fill={favorite ? 'currentColor' : 'none'} /></button><div><div className="font-medium">{market.symbol}</div><div className="text-xs text-gray-500">{market.base_currency}/{market.quote_currency}</div></div></div><div className="text-right">{format(ticker?.last_price)}</div><div className={`flex items-center justify-end gap-1 text-right ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>{change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{format(change, 4)}%</div><Link href={`/trading/${encodeURIComponent(market.symbol)}`} className="justify-self-end rounded bg-orange-500/20 px-3 py-1 text-sm text-orange-300">Trade</Link></div>; })}</div>}</div></section></main>;
}
