import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { exchangeStats } from '@/lib/db/analytics';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Runtime system status for the console.
 *
 * Every field is measured here: the process uptime and memory, the exchange's
 * own counters, and whether each venue is currently paused. Nothing is proxied
 * to a backend that may not be configured.
 */

const START_TIME = Date.now();

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const memory = process.memoryUsage();
  const db = getDb();

  const controls = db
    .prepare('SELECT scope, paused, reason, updated_at FROM exchange_controls ORDER BY scope')
    .all() as Array<{ scope: string; paused: number; reason: string | null; updated_at: string }>;

  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  return NextResponse.json(
    {
      success: true,
      data: {
        status: 'ok',
        service: 'tigerex-api',
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
        uptime_seconds: uptimeSeconds,
        heap_bytes: memory.heapUsed,
        rss_bytes: memory.rss,
        node_version: process.version,
        counters: exchangeStats() as unknown as Record<string, number>,
        controls: controls.map((row) => ({
          scope: row.scope,
          paused: row.paused === 1,
          reason: row.reason ?? null,
          updatedAt: row.updated_at,
        })),
      },
    },
    { headers: NO_STORE },
  );
}
