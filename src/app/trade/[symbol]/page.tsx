import SpotTradingPage from '@/app/spot/page';

/**
 * Pair-addressed spot terminal.
 *
 * The URL carries the market, for example `/trade/BTC-USDT`, which is the form
 * every navigation entry uses. The dash is the venue's URL separator for the
 * slash in the canonical symbol, so `BTC-USDT` opens `BTC/USDT`. An unrecognised
 * segment is passed through unchanged and the terminal falls back to the first
 * listed market rather than inventing a pair.
 */
export default async function TradeSymbolPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const decoded = decodeURIComponent(symbol ?? '').toUpperCase();
  const initialSymbol = decoded.includes('/') ? decoded : decoded.replace('-', '/');

  return <SpotTradingPage initialSymbol={initialSymbol} />;
}
