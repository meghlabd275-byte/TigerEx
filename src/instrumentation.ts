/**
 * Server instrumentation.
 *
 * Runs once when a Next.js server instance starts. It applies the deployment's
 * own configuration: it registers the chains the operator declared, lists the
 * markets the operator declared, and — when enabled — starts the in-process
 * maintenance timer that advances deposits, withdrawals, funding, liquidation
 * and the DEX keeper on a clock.
 *
 * Nothing is seeded when the environment is unset: a chain stays unlisted, no
 * market is created, and the timer does not start. The bootstrap reaches the
 * database, which only exists in the Node.js runtime, so it is guarded by a
 * positive `NEXT_RUNTIME` equality. Next.js substitutes that value per runtime,
 * so the Edge compilation sees a constant-false branch and drops the import
 * rather than trying to bundle a native module.
 */
export async function register(): Promise<void> {
  // Next.js recognises this exact positive comparison and drops the block from
  // the Edge compilation, so the native modules below never enter that bundle.
  // Everything node-only therefore lives inside this block.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { bootstrapChainsFromEnv } = await import('@/lib/chains/bootstrap');
    const { registered, skipped } = bootstrapChainsFromEnv();

    for (const chain of registered) {
      console.log(`✅ Chain registered: ${chain}`);
    }
    for (const entry of skipped) {
      // Skipped is the expected state for an unconfigured chain, so it is
      // logged as information rather than as an error.
      console.log(`ℹ️  Chain not registered: ${entry.chain} (${entry.reason})`);
    }

    const { seedMarkets } = await import('@/lib/markets/seed');
    const seeded = seedMarkets();
    if (seeded.configured) {
      for (const symbol of seeded.created) console.log(`✅ Market listed: ${symbol}`);
      for (const { symbol, error } of seeded.invalid) {
        console.error(`❌ Market not listed: ${symbol} (${error})`);
      }
    }

    // The in-process maintenance timer is opt-in through
    // TIGEREX_SCHEDULER_INTERVAL_MS so a deployment that runs the cycle
    // externally (a CronJob hitting /api/worker/tick) does not run it twice. The
    // interval is floored at five seconds so a misconfiguration cannot spin it.
    const configuredInterval = Number(process.env.TIGEREX_SCHEDULER_INTERVAL_MS);
    if (Number.isFinite(configuredInterval) && configuredInterval > 0) {
      const intervalMs = Math.max(5000, configuredInterval);
      const timer = setInterval(() => {
        void (async () => {
          try {
            const { runScheduledCycle } = await import('@/lib/ops/scheduler');
            const report = await runScheduledCycle();
            for (const job of report.jobs) {
              if (!job.ok) console.error(`❌ Maintenance job failed: ${job.job} (${job.error})`);
            }
          } catch (error) {
            console.error('❌ Maintenance cycle failed:', error);
          }
        })();
      }, intervalMs);
      // Do not hold the event loop open for the timer alone.
      if (typeof timer.unref === 'function') timer.unref();
      console.log(`✅ Maintenance timer started (every ${intervalMs}ms)`);
    }
  }
}
