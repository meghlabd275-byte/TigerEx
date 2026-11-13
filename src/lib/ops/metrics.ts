/**
 * Prometheus metrics exposition.
 *
 * The values are read from this venue's own database and process, so a scrape
 * reflects the exchange's real state rather than a fabricated series. Only
 * counts and gauges are exposed — never a balance, an address, an email or any
 * other per-user datum, so a scrape endpoint cannot become a data leak.
 *
 * The module is free of `next/server` so the renderer can be exercised directly
 * by the logic test runner.
 */

import { getDb } from '@/lib/db';

export interface MetricSample {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  value: number;
}

/**
 * Count rows in a table, or return `null` when the table is absent.
 *
 * A missing table is reported as an absent series rather than a zero, so an
 * operator can tell "no orders yet" from "the orders table is missing".
 */
function countOf(table: string, where = ''): number | null {
  try {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
      .get() as { count?: number } | undefined;
    const value = Number(row?.count);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Collect the exchange's operational metrics. */
export function collectMetrics(now = Date.now()): MetricSample[] {
  const samples: MetricSample[] = [];

  const push = (name: string, help: string, type: MetricSample['type'], value: number | null) => {
    if (value === null) return;
    samples.push({ name, help, type, value });
  };

  push('tigerex_users_total', 'Registered user accounts', 'gauge', countOf('users'));
  push('tigerex_orders_total', 'Orders recorded', 'counter', countOf('orders'));
  push('tigerex_orders_open_total', 'Orders currently open', 'gauge', countOf('orders', "WHERE status = 'open'"));
  push('tigerex_trades_total', 'Spot trades settled', 'counter', countOf('spot_trades'));
  push('tigerex_pairs_active_total', 'Active spot trading pairs', 'gauge', countOf('trading_pairs', "WHERE status = 'active'"));
  push('tigerex_deposits_pending_total', 'Deposits awaiting confirmation', 'gauge', countOf('deposits', "WHERE status = 'pending'"));
  push('tigerex_withdrawals_pending_total', 'Withdrawals awaiting approval', 'gauge', countOf('withdrawals', "WHERE status = 'pending'"));

  const memory = process.memoryUsage();
  push('tigerex_process_resident_memory_bytes', 'Resident memory size in bytes', 'gauge', memory.rss);
  push('tigerex_process_heap_used_bytes', 'Heap memory used in bytes', 'gauge', memory.heapUsed);
  push('tigerex_process_uptime_seconds', 'Process uptime in seconds', 'gauge', Math.floor(process.uptime()));
  push('tigerex_scrape_timestamp_seconds', 'Unix time of this scrape', 'gauge', Math.floor(now / 1000));

  return samples;
}

/**
 * Render samples in the Prometheus text exposition format.
 *
 * The `# HELP` and `# TYPE` lines precede each series exactly once, which is
 * what the format requires.
 */
export function renderPrometheus(samples: MetricSample[]): string {
  const lines: string[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.value)) continue;
    lines.push(`# HELP ${sample.name} ${sample.help}`);
    lines.push(`# TYPE ${sample.name} ${sample.type}`);
    lines.push(`${sample.name} ${sample.value}`);
  }
  return `${lines.join('\n')}\n`;
}
