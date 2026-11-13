/**
 * Health, readiness and liveness probes.
 *
 * A probe must report the truth about a dependency: a database that cannot be
 * queried is unhealthy, not a zero. Every check therefore performs a real
 * operation and returns the failure rather than swallowing it, and the aggregate
 * is unhealthy when any *required* dependency is down.
 *
 * The module is free of `next/server` so the checks can be exercised directly
 * by the logic test runner.
 */

import { getDb } from '@/lib/db';

export type CheckStatus = 'ok' | 'fail';

export interface CheckResult {
  status: CheckStatus;
  /** Human-readable detail. Never contains secret material. */
  detail?: string;
  /** Milliseconds the check took. */
  latencyMs?: number;
}

export interface HealthReport {
  status: CheckStatus;
  /** Process uptime, so an operator can see how long this instance has run. */
  uptimeSeconds: number;
  checks: Record<string, CheckResult>;
}

function timed<T>(fn: () => T): { value: T; latencyMs: number } {
  const start = Date.now();
  const value = fn();
  return { value, latencyMs: Date.now() - start };
}

/**
 * Database check: run a real query and require a row back.
 *
 * `SELECT 1` is used rather than a table read so the probe does not fail merely
 * because a schema has not been seeded yet — that is a readiness concern, not a
 * liveness one.
 */
export function checkDatabase(): CheckResult {
  try {
    const { latencyMs } = timed(() => {
      const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
      if (!row || row.ok !== 1) throw new Error('database returned no row');
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return { status: 'fail', detail: error instanceof Error ? error.message : 'database unavailable' };
  }
}

/**
 * Readiness check: the venue can only trade if at least one market is listed.
 * This is deliberately separate from liveness, because a node that is up but
 * has no markets is not ready to serve orders.
 */
export function checkMarketsListed(): CheckResult {
  try {
    const { value, latencyMs } = timed(() => {
      const row = getDb()
        .prepare("SELECT COUNT(*) AS count FROM trading_pairs WHERE status = 'active'")
        .get() as { count?: number } | undefined;
      return Number(row?.count ?? 0);
    });
    if (value <= 0) {
      return { status: 'fail', detail: 'no active trading pairs are listed', latencyMs };
    }
    return { status: 'ok', detail: `${value} active pairs`, latencyMs };
  } catch (error) {
    return { status: 'fail', detail: error instanceof Error ? error.message : 'listing check failed' };
  }
}

/**
 * Aggregate a set of checks.
 *
 * `required` lists the checks whose failure makes the whole report fail. A check
 * that is not required (for example the market listing) is reported but does not
 * by itself take the process out of rotation.
 */
export function healthReport(
  checks: Record<string, CheckResult>,
  required: string[],
  startedAt: number,
): HealthReport {
  const failed = required.filter((name) => checks[name]?.status !== 'ok');
  return {
    status: failed.length === 0 ? 'ok' : 'fail',
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    checks,
  };
}

/** Liveness: is the process able to answer at all. */
export function liveness(startedAt: number): HealthReport {
  return healthReport({ process: { status: 'ok' } }, ['process'], startedAt);
}

/**
 * Readiness: can the process actually serve trading traffic.
 *
 * The market listing is required, not advisory: an instance whose database is
 * reachable but which has no listed markets cannot price or trade anything, so
 * it must not be given traffic.
 */
export function readiness(startedAt: number): HealthReport {
  const checks = {
    database: checkDatabase(),
    markets: checkMarketsListed(),
  };
  return healthReport(checks, ['database', 'markets'], startedAt);
}
