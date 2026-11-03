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
  'src/lib/trading/etf.ts',
  'src/lib/trading/copy.ts',
  'src/lib/risk/engine.ts',
  'src/lib/oracle/aggregator.ts',
  'src/lib/options/pricing.ts',
  'src/lib/earn/products.ts',
  'src/lib/bots/strategies.ts',
  'src/lib/p2p/escrow.ts',
  'src/lib/security/guards.ts',
];

fs.rmSync(OUT, { recursive: true, force: true });

// Each module is compiled on its own with its own directory as the root, so
// the emitted files stay flat in OUT regardless of which source directory a
// module lives in. Tests then require `../../.test-build/<name>.js` without
// mirroring the source tree.
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
      rootDir: path.dirname(absolute),
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

// Rewrite `@/lib/db/thing` -> `./thing` and `@/lib/db` -> `./index`.
const alias = /@\/lib\/db\/([\w-]+)/g;
for (const file of fs.readdirSync(OUT)) {
  if (!file.endsWith('.js')) continue;
  const full = path.join(OUT, file);
  const rewritten = fs
    .readFileSync(full, 'utf8')
    .replace(alias, './$1')
    .replace(/@\/lib\/db(["'])/g, './index$1');
  fs.writeFileSync(full, rewritten);
}

console.log(`Built ${MODULES.length} logic modules into ${path.relative(ROOT, OUT)}`);
