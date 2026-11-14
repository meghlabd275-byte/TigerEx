/**
 * Scheduled maintenance cycle.
 *
 * A live venue must advance on a clock, not only when a user opens a page:
 * deposits have to be scanned and confirmed, withdrawals watched until they are
 * mined, perpetual funding settled, and positions liquidated when they breach
 * maintenance margin. This module runs those jobs in one idempotent cycle.
 *
 * The cycle is safe to run concurrently — every job claims its work with a
 * guarded status update or is naturally idempotent — and it reports each job's
 * outcome so a failure is visible rather than swallowed. A job that throws does
 * not stop the others.
 *
 * The module is free of `next/server`; the HTTP worker route and the in-process
 * timer both call `runScheduledCycle`.
 */

import { getDb } from '@/lib/db';
import { scanAllChains, confirmDeposits, reverseReorgedDeposits } from '@/lib/wallet/scanner';
import { syncBroadcastWithdrawals } from '@/lib/wallet/payout';
import { runSettlementCycle } from '@/lib/trading/settlement';
import { scanPositions, processQueue } from '@/lib/trading/risk-supervisor';
import { runKeeperCycle } from '@/lib/dex/keeper';
import { runReconciliation } from '@/lib/compliance/reserves';
import { runSurveillanceCycle } from '@/lib/compliance/surveillance';
import { scanForAmlCases } from '@/lib/compliance/aml';

export interface JobResult {
  job: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
  durationMs: number;
}

export interface CycleReport {
  startedAt: string;
  durationMs: number;
  jobs: JobResult[];
}

/**
 * Distributed lock so two instances do not run the cycle at once.
 *
 * The lock is a single row keyed by name; a holder older than `ttlSeconds` is
 * considered stale and may be taken over, so a crashed instance does not wedge
 * the cycle forever.
 */
function acquireLock(name: string, ttlSeconds: number): boolean {
  const db = getDb();
  return db.transaction(() => {
    const now = db.prepare("SELECT datetime('now') AS now").get() as { now: string };
    const row = db
      .prepare('SELECT holder, expires_at FROM scheduler_locks WHERE name = ?')
      .get(name) as { holder: string; expires_at: string } | undefined;

    if (row) {
      const expired = db
        .prepare("SELECT datetime(?) <= datetime('now') AS expired")
        .get(row.expires_at) as { expired: number };
      if (expired.expired !== 1) return false;
    }

    const holder = `${process.pid}-${Date.now()}`;
    db.prepare(
      `INSERT INTO scheduler_locks (name, holder, expires_at, updated_at)
       VALUES (?, ?, datetime('now', ?), datetime('now'))
       ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at, updated_at = datetime('now')`,
    ).run(name, holder, `+${ttlSeconds} seconds`);
    return true;
  })();
}

function releaseLock(name: string): void {
  getDb().prepare('DELETE FROM scheduler_locks WHERE name = ?').run(name);
}

async function runJob(job: string, fn: () => Promise<unknown> | unknown): Promise<JobResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { job, ok: true, detail, durationMs: Date.now() - start };
  } catch (error) {
    return {
      job,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Run every maintenance job once.
 *
 * When another instance holds the lock the cycle returns an empty job list, so
 * a redundant trigger is a no-op rather than a duplicate run.
 */
export async function runScheduledCycle(): Promise<CycleReport> {
  const startedAt = new Date().toISOString();
  const start = Date.now();

  if (!acquireLock('maintenance', 120)) {
    return { startedAt, durationMs: Date.now() - start, jobs: [] };
  }

  try {
    const jobs: JobResult[] = [];
    jobs.push(await runJob('deposits.scan', () => scanAllChains()));
    jobs.push(await runJob('deposits.confirm', () => confirmDeposits()));
    jobs.push(await runJob('deposits.reorg', () => reverseReorgedDeposits()));
    jobs.push(await runJob('withdrawals.sync', () => syncBroadcastWithdrawals()));
    jobs.push(await runJob('settlement.cycle', () => runSettlementCycle()));
    jobs.push(await runJob('risk.scan', () => scanPositions()));
    jobs.push(await runJob('risk.process', () => processQueue()));
    jobs.push(await runJob('dex.keeper', () => runKeeperCycle()));

    // Watch the venue's own markets for manipulation. The pass is idempotent per
    // minute, so a redundant cycle raises nothing new.
    jobs.push(
      await runJob('surveillance.scan', () => {
        const result = runSurveillanceCycle();
        return { scanned: result.scanned, raised: result.alerts.length };
      }),
    );

    // Turn recorded signals (surveillance alerts, large or structured
    // withdrawals) into AML cases. Idempotent per (user, source, summary), so a
    // redundant cycle touches the same open case rather than stacking new ones.
    jobs.push(
      await runJob('aml.scan', () => {
        const cases = scanForAmlCases();
        return { touched: cases.length };
      }),
    );

    // Reconcile user liabilities against recorded treasury holdings every cycle.
    // A shortfall is reported (and surfaced to the operator) rather than hidden.
    jobs.push(
      await runJob('reserves.reconcile', () => {
        const result = runReconciliation();
        if (!result.ok) {
          throw new Error(
            `reserve shortfall: ${result.entries
              .filter((e) => !e.covered)
              .map((e) => `${e.asset} short ${(e.userLiabilities - e.recordedAssets).toFixed(8)}`)
              .join(', ')}`,
          );
        }
        return { assets: result.entries.length };
      }),
    );

    return { startedAt, durationMs: Date.now() - start, jobs };
  } finally {
    releaseLock('maintenance');
  }
}
