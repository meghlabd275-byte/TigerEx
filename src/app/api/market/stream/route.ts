import { NextRequest } from 'next/server';
import { symbolParam } from '@/lib/api/route-guards';
import { readMarketSnapshot, buildStreamFrame, snapshotFingerprint } from '@/lib/trading/market-stream';

/**
 * Real-time market-data stream (Server-Sent Events).
 *
 * Emits the live order book, trade tape and ticker for one symbol, read from the
 * venue's own tables. Frames are diffed by fingerprint, so an unchanged market
 * sends nothing. SSE is used so the same handler works under the Next.js Node
 * runtime without a custom upgrade path.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TICK_MS = 1000;

export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'VALIDATION_FAILED', message: 'A symbol such as BTC/RUSD is required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastFingerprint = '';
      const send = (payload: string) => controller.enqueue(encoder.encode(payload));

      send(': connected\n\n');
      const push = () => {
        try {
          const snapshot = readMarketSnapshot(symbol);
          const frame = buildStreamFrame(lastFingerprint, snapshot);
          if (!frame) return;
          lastFingerprint = snapshotFingerprint(snapshot);
          send(`event: market\ndata: ${JSON.stringify(frame)}\n\n`);
        } catch (error) {
          // A read failure must not kill the stream; report it and keep the
          // socket open so a transient database blip recovers on the next tick.
          send(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'stream error' })}\n\n`);
        }
      };

      push();
      timer = setInterval(push, TICK_MS);

      request.signal.addEventListener('abort', () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
