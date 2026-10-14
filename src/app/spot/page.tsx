"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type Market = { symbol: string; baseCurrency?: string; quoteCurrency?: string; status?: string };
type Ticker = { lastPrice?: number; price?: number; priceChangePercent?: number; priceChange?: number; highPrice?: number; lowPrice?: number; volume?: number; quoteVolume?: number };
type Level = { price: number; quantity: number };
type Trade = { id?: string; tradeId?: string; price: number; quantity?: number; qty?: number; time?: number | string; timestamp?: number | string; isBuyerMaker?: boolean; side?: string };
type Candle = { time: number | string; open: number; high: number; low: number; close: number; volume?: number };

function payload(value: any): any {
  return value && typeof value === "object" && "data" in value ? value.data : value;
}
function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function symbolName(market: any): string {
  return String(market?.symbol ?? market?.marketSymbol ?? market?.market ?? "");
}
function parseLevels(value: any): Level[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: any) => {
    const price = numberValue(Array.isArray(entry) ? entry[0] : entry?.price);
    const quantity = numberValue(Array.isArray(entry) ? entry[1] : entry?.quantity ?? entry?.qty ?? entry?.amount);
    return price !== null && quantity !== null ? { price, quantity } : null;
  }).filter((entry: Level | null): entry is Level => entry !== null);
}
function parseTrades(value: any): Trade[] {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.trades) ? value.trades : [];
  return rows.filter((row: any) => numberValue(row?.price) !== null);
}
function parseCandles(value: any): Candle[] {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.candles) ? value.candles : Array.isArray(value?.klines) ? value.klines : [];
  return rows.map((row: any) => {
    if (Array.isArray(row)) return { time: row[0], open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
    return { time: row.time ?? row.timestamp ?? row.openTime, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: numberValue(row.volume) ?? undefined };
  }).filter((row: Candle) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

export default function SpotTradingPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [symbol, setSymbol] = useState("");
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [balances, setBalances] = useState<any[] | null>(null);
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET" | "STOP_LIMIT">("LIMIT");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const requestJson = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? "Exchange service unavailable (" + response.status + ")");
    if (body?.success === false) throw new Error(body?.error?.message ?? body?.error ?? "Exchange service unavailable");
    return payload(body);
  }, []);

  const loadMarkets = useCallback(async () => {
    const data = await requestJson("/api/markets");
    const rows = Array.isArray(data) ? data : Array.isArray(data?.markets) ? data.markets : Array.isArray(data?.symbols) ? data.symbols : [];
    const valid = rows.map((row: any) => ({ symbol: symbolName(row), baseCurrency: row.baseCurrency, quoteCurrency: row.quoteCurrency, status: row.status }))
      .filter((row: Market) => row.symbol && (!row.status || ["TRADING", "ACTIVE", "ONLINE"].includes(String(row.status).toUpperCase())));
    setMarkets(valid);
    setSymbol((current) => current && valid.some((market: Market) => market.symbol === current) ? current : valid[0]?.symbol ?? "");
  }, [requestJson]);

  const loadMarketData = useCallback(async (marketSymbol: string) => {
    if (!marketSymbol) return;
    const encoded = encodeURIComponent(marketSymbol);
    const results = await Promise.allSettled([
      requestJson("/api/ticker/24hr?symbol=" + encoded),
      requestJson("/api/depth?symbol=" + encoded + "&limit=20"),
      requestJson("/api/trades?symbol=" + encoded + "&limit=20"),
      requestJson("/api/candles?symbol=" + encoded + "&interval=1m&limit=100"),
    ]);
    const [tickerResult, depthResult, tradesResult, candlesResult] = results;
    if (tickerResult.status === "fulfilled") {
      const value = payload(tickerResult.value);
      const candidate = Array.isArray(value) ? value.find((row: any) => symbolName(row) === marketSymbol) : value?.ticker ?? value;
      setTicker(candidate && typeof candidate === "object" ? candidate : null);
    } else setTicker(null);
    if (depthResult.status === "fulfilled") {
      const value = payload(depthResult.value);
      setBids(parseLevels(value?.bids));
      setAsks(parseLevels(value?.asks));
    } else { setBids([]); setAsks([]); }
    setTrades(tradesResult.status === "fulfilled" ? parseTrades(payload(tradesResult.value)) : []);
    setCandles(candlesResult.status === "fulfilled" ? parseCandles(payload(candlesResult.value)) : []);
  }, [requestJson]);

  const loadBalances = useCallback(async () => {
    const token = localStorage.getItem("tigerex_access_token");
    if (!token) { setBalances(null); return; }
    try {
      const data = await requestJson("/api/wallet/balance", { headers: { Authorization: "Bearer " + token } });
      setBalances(Array.isArray(data?.balances) ? data.balances : Array.isArray(data) ? data : null);
    } catch { setBalances(null); }
  }, [requestJson]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!markets.length) await loadMarkets();
      if (symbol) await loadMarketData(symbol);
      await loadBalances();
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Exchange data is unavailable.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [loadBalances, loadMarketData, loadMarkets, markets.length, symbol]);

  useEffect(() => {
    let active = true;
    const initial = async () => {
      setLoading(true);
      try { await loadMarkets(); } catch (error) { if (active) setStatus(error instanceof Error ? error.message : "Market service is unavailable."); }
      if (active) setLoading(false);
    };
    void initial();
    return () => { active = false; };
  }, [loadMarkets]);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    const run = async () => {
      try {
        await loadMarketData(symbol);
        if (active) setStatus("");
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Market data is unavailable.");
      }
    };
    void run();
    const interval = window.setInterval(() => { if (active) void run(); }, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [loadMarketData, symbol]);

  useEffect(() => { void loadBalances(); }, [loadBalances]);

  const lastPrice = numberValue(ticker?.lastPrice ?? ticker?.price);
  const priceChange = numberValue(ticker?.priceChangePercent ?? ticker?.priceChange);
  const high24h = numberValue(ticker?.highPrice);
  const low24h = numberValue(ticker?.lowPrice);
  const volume24h = numberValue(ticker?.quoteVolume ?? ticker?.volume);
  const baseCurrency = useMemo(() => {
    const market = markets.find((entry) => entry.symbol === symbol);
    if (market?.baseCurrency) return market.baseCurrency;
    return symbol.includes("/") ? symbol.split("/")[0] : symbol.replace(/USDT$|USDC$|USD$|BTC$|ETH$/, "");
  }, [markets, symbol]);
  const quoteCurrency = useMemo(() => {
    const market = markets.find((entry) => entry.symbol === symbol);
    if (market?.quoteCurrency) return market.quoteCurrency;
    return symbol.includes("/") ? symbol.split("/")[1] ?? "" : "";
  }, [markets, symbol]);
  const total = useMemo(() => {
    const p = orderType === "MARKET" ? lastPrice : numberValue(price);
    const q = numberValue(quantity);
    return p !== null && q !== null && p > 0 && q > 0 ? p * q : null;
  }, [lastPrice, orderType, price, quantity]);
  const balanceFor = (currency: string) => balances?.find((entry: any) => String(entry.coin ?? entry.currency ?? "").toUpperCase() === currency.toUpperCase());
  const availableQuote = numberValue(balanceFor(quoteCurrency)?.free ?? balanceFor(quoteCurrency)?.available);
  const availableBase = numberValue(balanceFor(baseCurrency)?.free ?? balanceFor(baseCurrency)?.available);

  async function submitOrder() {
    setStatus("");
    const token = localStorage.getItem("tigerex_access_token");
    if (!token) { setStatus("Sign in before submitting an order."); return; }
    const qty = numberValue(quantity);
    const limitPrice = orderType === "MARKET" ? undefined : numberValue(price);
    const stop = orderType === "STOP_LIMIT" ? numberValue(stopPrice) : undefined;
    if (!symbol || qty === null || qty <= 0 || (orderType !== "MARKET" && (limitPrice === null || limitPrice === undefined || limitPrice <= 0)) || (orderType === "STOP_LIMIT" && (stop === null || stop === undefined || stop <= 0))) {
      setStatus("Enter a valid market, quantity, and required price fields.");
      return;
    }
    setSubmitting(true);
    try {
      await requestJson("/api/spot/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ symbol, marketSymbol: symbol, side: side.toLowerCase(), orderType: orderType.toLowerCase(), quantity: qty, ...(limitPrice !== undefined ? { price: limitPrice } : {}), ...(stop !== undefined ? { stopPrice: stop } : {}) }),
      });
      setStatus("Order request accepted by the exchange service.");
      setQuantity("");
      await loadBalances();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Order was not accepted.");
    } finally { setSubmitting(false); }
  }

  const fmt = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const maxBid = Math.max(0, ...bids.map((row) => row.price * row.quantity));
  const maxAsk = Math.max(0, ...asks.map((row) => row.price * row.quantity));

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold">TigerEx</Link>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Market</span>
            <select aria-label="Trading market" value={symbol} onChange={(event) => setSymbol(event.target.value)} className="rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700" disabled={!markets.length}>
              {!markets.length && <option value="">No markets available</option>}
              {markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh</button>
          <ThemeToggle />
          <Link href="/wallet" aria-label="Wallet" className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800"><Wallet size={20} /></Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1800px] space-y-4 p-4">
        {status && <div role="status" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><span>{status}</span></div>}
        <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:grid-cols-2 lg:grid-cols-5">
          <div><div className="text-xs text-gray-500">Last price ({quoteCurrency || "quote"})</div><div className="text-2xl font-semibold">{fmt(lastPrice)}</div></div>
          <div><div className="text-xs text-gray-500">24h change</div><div className={(priceChange ?? 0) >= 0 ? "text-lg text-emerald-600" : "text-lg text-red-600"}>{priceChange === null ? "—" : fmt(priceChange) + "%"}</div></div>
          <div><div className="text-xs text-gray-500">24h high</div><div className="text-lg">{fmt(high24h)}</div></div>
          <div><div className="text-xs text-gray-500">24h low</div><div className="text-lg">{fmt(low24h)}</div></div>
          <div><div className="text-xs text-gray-500">24h volume</div><div className="text-lg">{fmt(volume24h)}</div></div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading exchange markets…</p>}
        {!loading && !markets.length && <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700"><p className="font-medium">No live markets are available</p><p className="mt-2 text-sm text-gray-500">Trading remains unavailable until the configured market-data service returns verified market metadata.</p></div>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 font-semibold">Candles · 1 minute</h2>
              {candles.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{candles.slice(-8).map((candle, index) => <div key={String(candle.time) + index} className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-800"><div className="text-gray-500">{String(candle.time)}</div><div>O {fmt(candle.open)}</div><div>H {fmt(candle.high)}</div><div>L {fmt(candle.low)}</div><div className={candle.close >= candle.open ? "text-emerald-600" : "text-red-600"}>C {fmt(candle.close)}</div></div>)}</div> : <p className="py-8 text-center text-sm text-gray-500">Candle data unavailable from the live market-data service.</p>}
            </section>
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 font-semibold">Recent trades</h2>
              {trades.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-500"><th className="pb-2">Price</th><th className="pb-2">Quantity</th><th className="pb-2">Time</th></tr></thead><tbody>{trades.slice(0, 20).map((trade, index) => <tr key={String(trade.id ?? trade.tradeId ?? trade.timestamp ?? index)}><td className="py-1">{fmt(numberValue(trade.price))}</td><td className="py-1">{fmt(numberValue(trade.quantity ?? trade.qty), 6)}</td><td className="py-1">{String(trade.time ?? trade.timestamp ?? "—")}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-sm text-gray-500">No live trades returned for this market.</p>}
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 font-semibold">Order book</h2>
              <div className="grid grid-cols-3 pb-2 text-xs text-gray-500"><span>Price</span><span className="text-right">Quantity</span><span className="text-right">Total</span></div>
              <div className="space-y-1">{asks.slice(0, 10).reverse().map((level, index) => <div key={"a" + index} className="relative grid grid-cols-3 text-xs"><span className="absolute inset-y-0 right-0 bg-red-500/10" style={{ width: (maxAsk ? (level.price * level.quantity / maxAsk) * 100 : 0) + "%" }} /><span className="relative text-red-600">{fmt(level.price)}</span><span className="relative text-right">{fmt(level.quantity, 6)}</span><span className="relative text-right">{fmt(level.price * level.quantity)}</span></div>)}</div>
              <div className="my-3 border-y border-gray-200 py-3 text-center text-xl font-semibold dark:border-gray-800">{fmt(lastPrice)}</div>
              <div className="space-y-1">{bids.slice(0, 10).map((level, index) => <div key={"b" + index} className="relative grid grid-cols-3 text-xs"><span className="absolute inset-y-0 right-0 bg-emerald-500/10" style={{ width: (maxBid ? (level.price * level.quantity / maxBid) * 100 : 0) + "%" }} /><span className="relative text-emerald-600">{fmt(level.price)}</span><span className="relative text-right">{fmt(level.quantity, 6)}</span><span className="relative text-right">{fmt(level.price * level.quantity)}</span></div>)}</div>
              {!bids.length && !asks.length && <p className="py-4 text-center text-sm text-gray-500">Order book unavailable from the live market-data service.</p>}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 grid grid-cols-2 gap-2"><button onClick={() => setSide("BUY")} className={"rounded py-2 font-semibold " + (side === "BUY" ? "bg-emerald-600 text-white" : "bg-gray-100 dark:bg-gray-800")}>Buy</button><button onClick={() => setSide("SELL")} className={"rounded py-2 font-semibold " + (side === "SELL" ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-800")}>Sell</button></div>
              <div className="mb-3 grid grid-cols-3 gap-1">{(["LIMIT", "MARKET", "STOP_LIMIT"] as const).map((type) => <button key={type} onClick={() => setOrderType(type)} className={"rounded px-1 py-2 text-xs " + (orderType === type ? "bg-orange-500 text-white" : "bg-gray-100 dark:bg-gray-800")}>{type === "STOP_LIMIT" ? "Stop-limit" : type}</button>)}</div>
              {orderType !== "MARKET" && <label className="mb-3 block text-sm">Limit price ({quoteCurrency})<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-700" placeholder="Enter limit price" /></label>}
              {orderType === "STOP_LIMIT" && <label className="mb-3 block text-sm">Stop price ({quoteCurrency})<input inputMode="decimal" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-700" placeholder="Enter stop price" /></label>}
              <label className="mb-3 block text-sm">Quantity ({baseCurrency || "base asset"})<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-700" placeholder="Enter quantity" /></label>
              <div className="mb-3 flex justify-between text-sm"><span className="text-gray-500">Estimated total</span><span>{fmt(total)} {quoteCurrency}</span></div>
              <div className="mb-4 space-y-1 text-xs text-gray-500"><div className="flex justify-between"><span>Available {quoteCurrency || "quote"}</span><span>{availableQuote === null ? "Unavailable" : fmt(availableQuote)}</span></div><div className="flex justify-between"><span>Available {baseCurrency || "base"}</span><span>{availableBase === null ? "Unavailable" : fmt(availableBase)}</span></div></div>
              <button disabled={submitting || !symbol || !markets.length} onClick={() => void submitOrder()} className={"w-full rounded py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 " + (side === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700")}>{submitting ? "Submitting…" : side === "BUY" ? "Place buy order" : "Place sell order"}</button>
              <p className="mt-2 text-xs text-gray-500">Orders are submitted only to the configured exchange API. An unavailable or unconfigured backend is shown as an error; no simulated fill is displayed.</p>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
