/**
 * Server instrumentation.
 *
 * Runs once when a Next.js server instance starts. Its only job is to apply the
 * deployment's own chain configuration to the registry: when a TigerSmartChain
 * node URL is present in the environment, the chain and its tokens are listed
 * so the wallet view and the address issuer serve it. Nothing is seeded when the
 * environment is unset — the chain stays unlisted and every call fails closed.
 *
 * The bootstrap reaches the database, which only exists in the Node.js runtime,
 * so it is guarded by a positive `NEXT_RUNTIME` equality. Next.js substitutes
 * that value per runtime, so the Edge compilation sees a constant-false branch
 * and drops the import rather than trying to bundle a native module.
 */
export async function register(): Promise<void> {
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
  }
}
