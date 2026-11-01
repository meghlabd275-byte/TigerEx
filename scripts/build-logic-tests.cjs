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
];

fs.rmSync(OUT, { recursive: true, force: true });

const tsconfig = {
  compilerOptions: {
    target: 'es2020',
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: OUT,
    baseUrl: ROOT,
    paths: { '@/*': ['src/*'] },
    strict: false,
  },
  files: MODULES.map((m) => path.join(ROOT, m)),
};

const tsconfigPath = path.join(OUT, 'tsconfig.json');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', tsconfigPath],
  { cwd: ROOT, stdio: 'inherit' },
);
fs.rmSync(tsconfigPath);

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
