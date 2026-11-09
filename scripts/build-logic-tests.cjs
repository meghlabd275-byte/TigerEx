'use strict';
/**
 * Compile the framework-free logic modules into `.test-build` so the test
 * runner can require them with plain Node.
 *
 * `tsc` alone is not enough: the sources use the `@/lib/...` path alias, which
 * TypeScript leaves untouched in the emitted JavaScript. The alias is rewritten
 * to a relative require here. Only modules that avoid `next/server` should be
 * added, so the tests stay independent of the Next.js runtime.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.test-build');

const MODULES = [
  'src/lib/db/pnl.ts',
  'src/lib/db/index.ts',
  'src/lib/db/portfolio.ts',
  'src/lib/db/convert.ts',
  'src/lib/markets/listing.ts',
  'src/lib/markets/futures.ts',
  'src/lib/markets/instruments.ts',
  'src/lib/trading/orderbook.ts',
  'src/lib/trading/fees.ts',
  'src/lib/trading/spot-engine.ts',
  'src/lib/trading/market-view.ts',
  'src/lib/trading/candles.ts',
  'src/lib/db/ledger.ts',
  'src/lib/db/referral.ts',
  'src/lib/trading/etf.ts',
  'src/lib/trading/copy.ts',
  'src/lib/trading/valuation.ts',
  'src/lib/trading/margin-engine.ts',
  'src/lib/trading/futures-engine.ts',
  'src/lib/trading/mark-price.ts',
  'src/lib/trading/risk-supervisor.ts',
  'src/lib/risk/engine.ts',
  'src/lib/oracle/aggregator.ts',
  'src/lib/options/pricing.ts',
  'src/lib/earn/products.ts',
  'src/lib/bots/strategies.ts',
  'src/lib/p2p/escrow.ts',
  'src/lib/security/guards.ts',
  'src/lib/wallet/address.ts',
  'src/lib/wallet/hd.ts',
  'src/lib/wallet/withdrawals.ts',
  'src/lib/wallet/transfers.ts',
  'src/lib/p2p/market.ts',
  'src/lib/earn/rewards.ts',
  'src/lib/trading/vip.ts',
  'src/lib/trading/fee-schedule.ts',
  'src/lib/security/account.ts',
  'src/lib/notifications/inbox.ts',
  'src/lib/otc/quote.ts',
  'src/lib/leaderboard/traders.ts',
  'src/lib/bots/instances.ts',
  'src/lib/earn/launchpool.ts',
  'src/lib/earn/holdings.ts',
  'src/lib/wallet/bridge.ts',
  'src/lib/account/subaccounts.ts',
  'src/lib/trading/copy-engine.ts',
  'src/lib/options/options-engine.ts',
  'src/lib/trading/etf-engine.ts',
  'src/lib/earn/subscriptions.ts',
  'src/lib/security/account-deletion.ts',
  'src/lib/security/session-rotate.ts',
  'src/lib/security/login-challenge.ts',
  'src/lib/p2p/profile.ts',
  'src/lib/api/api-auth.ts',
  'src/lib/security/ip-allowlist.ts',
  'src/lib/wallet/networks.ts',
  'src/lib/wallet/deposit.ts',
  'src/lib/auth/oidc.ts',
  'src/lib/auth/password.ts',
  'src/lib/auth/wallet-signature.ts',
  'src/lib/auth/wallet.ts',
  'src/lib/dex/amm.ts',
  'src/lib/dex/router.ts',
  'src/lib/dex/orders.ts',
  'src/lib/dex/fee-engine.ts',
  'src/lib/dex/staking.ts',
  'src/lib/dex/perps.ts',
  'src/lib/dex/margin.ts',
  'src/lib/dex/launchpad.ts',
  'src/lib/dex/bots.ts',
  'src/lib/dex/validation.ts',
  'src/lib/dex/pool-service.ts',
  'src/lib/dex/swap-service.ts',
  'src/lib/dex/liquidity-service.ts',
  'src/lib/dex/farm-service.ts',
  'src/lib/dex/perps-service.ts',
  'src/lib/dex/margin-service.ts',
  'src/lib/dex/launch-service.ts',
  'src/lib/dex/keeper.ts',
  'src/lib/dex/zap.ts',
  'src/lib/dex/vault.ts',
  'src/lib/dex/liquid-staking.ts',
  'src/lib/dex/mev.ts',
  'src/lib/dex/hooks.ts',
  'src/lib/dex/sniping.ts',
  'src/lib/dex/zap-service.ts',
  'src/lib/dex/vault-service.ts',
  'src/lib/dex/liquid-staking-service.ts',
  'src/lib/dex/mev-service.ts',
  'src/lib/dex/hook-service.ts',
  'src/lib/dex/sniping-service.ts',
];

fs.rmSync(OUT, { recursive: true, force: true });

// Each module is compiled with `src` as the rootDir so one module can import
// another; the emitted tree therefore mirrors `src`. It is flattened afterwards
// so tests can require `../../.test-build/<name>.js` directly.
fs.mkdirSync(OUT, { recursive: true });
for (const module of MODULES) {
  const absolute = path.join(ROOT, module);
  const tsconfig = {
    compilerOptions: {
      target: 'es2020',
      module: 'commonjs',
      moduleResolution: 'node',
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: OUT,
      rootDir: path.join(ROOT, 'src'),
      baseUrl: ROOT,
      paths: { '@/*': ['src/*'] },
      strict: false,
    },
    files: [absolute],
  };

  const tsconfigPath = path.join(OUT, `tsconfig.${path.basename(module, '.ts')}.json`);
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', tsconfigPath],
    { cwd: ROOT, stdio: 'inherit' },
  );
  fs.rmSync(tsconfigPath);
}

// Flatten the emitted tree, then rewrite `@/lib/<dir>/<name>` -> `./<name>` and
// the bare `@/lib/db` -> `./index`. Every module ends up beside the others, so
// the directory segment is dropped from every import.
const emitted = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) emitted.push(full);
  }
})(OUT);

const alias = /@\/lib\/[\w-]+\/([\w-]+)/g;
for (const full of emitted) {
  const flat = path.join(OUT, path.basename(full));
  const rewritten = fs
    .readFileSync(full, 'utf8')
    .replace(alias, './$1')
    .replace(/@\/lib\/db(["'])/g, './index$1');
  fs.writeFileSync(flat, rewritten);
  if (flat !== full) fs.rmSync(full);
}

// Remove the now-empty nested directories.
for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
  if (entry.isDirectory()) fs.rmSync(path.join(OUT, entry.name), { recursive: true, force: true });
}

console.log(`Built ${MODULES.length} logic modules into ${path.relative(ROOT, OUT)}`);
