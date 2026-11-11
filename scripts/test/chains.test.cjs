'use strict';
/**
 * Chain registry and on-chain read tests.
 *
 * These exercise the real code paths: the ABI codec, the fail-closed URL and
 * input validation, the registry's database reads and writes, and the
 * TigerSmartChain registration. The on-chain read is driven through an injected
 * transport so the JSON-RPC request the exchange builds and the response it
 * accepts are the real ones; a node that reports the wrong chain id, or returns
 * a malformed result, must fail closed rather than yield a balance.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-chains-')), 'chains.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const { getDb, generateId } = require(path.join(BUILD, 'index.js'));
const rpc = require(path.join(BUILD, 'evm-rpc.js'));
const registry = require(path.join(BUILD, 'registry.js'));
const onchain = require(path.join(BUILD, 'onchain.js'));
const tsc = require(path.join(BUILD, 'tigersmartchain.js'));
const networks = require(path.join(BUILD, 'chain-networks.js'));
const bootstrap = require(path.join(BUILD, 'bootstrap.js'));
const depositNetworks = require(path.join(BUILD, 'networks.js'));
const { depositAddress, DepositError } = require(path.join(BUILD, 'deposit.js'));

const db = getDb();

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const RUSD_ADDRESS = '0x1111111111111111111111111111111111111111';

function fakeNode({ chainId = '0x1a0a', balances = {}, symbol = '0x', decimals = '0x' } = {}) {
  // chainId defaults to 6666 (0x1a0a).
  return async (url, init) => {
    const request = JSON.parse(init.body);
    const respond = (result) => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: request.id, result }),
    });

    if (request.method === 'eth_chainId') return respond(chainId);
    if (request.method === 'eth_blockNumber') return respond('0x10');
    if (request.method === 'eth_getBalance') {
      return respond(balances.native ?? '0x0');
    }
    if (request.method === 'eth_call') {
      const { to, data } = request.params[0];
      const selector = data.slice(0, 10);
      if (selector === rpc.ERC20_SELECTORS.balanceOf) {
        const key = String(to).toLowerCase();
        return respond(balances[key] ?? '0x0');
      }
      if (selector === rpc.ERC20_SELECTORS.symbol) return respond(symbol);
      if (selector === rpc.ERC20_SELECTORS.decimals) return respond(decimals);
    }
    return respond('0x0');
  };
}

// ---------------------------------------------------------------------------
// ABI codec
// ---------------------------------------------------------------------------

test('encodeBalanceOf pads the address to a 32-byte word', () => {
  const data = rpc.encodeBalanceOf('0x0000000000000000000000000000000000000001');
  assert.equal(data.slice(0, 10), '0x70a08231');
  assert.equal(data.length, 10 + 64);
  assert.ok(data.endsWith('1'.padStart(64, '0')));
});

test('encodeBalanceOf rejects a non-address', () => {
  assert.throws(() => rpc.encodeBalanceOf('0x123'), rpc.EvmRpcError);
});

test('formatUnits keeps integer precision beyond Number range', () => {
  // 1 USDT (6 decimals) and a very large amount that would lose precision as a
  // float.
  assert.equal(rpc.formatUnits(1_000_000n, 6), '1');
  assert.equal(rpc.formatUnits(1_500_000n, 6), '1.5');
  assert.equal(rpc.formatUnits(0n, 18), '0');
  assert.equal(
    rpc.formatUnits(123456789012345678901234567890n, 18),
    '123456789012.34567890123456789',
  );
});

test('formatUnits rejects a negative amount and bad decimals', () => {
  assert.throws(() => rpc.formatUnits(-1n, 18), rpc.EvmRpcError);
  assert.throws(() => rpc.formatUnits(1n, -1), rpc.EvmRpcError);
  assert.throws(() => rpc.formatUnits(1n, 1.5), rpc.EvmRpcError);
});

test('decodeAbiString reads a canonical string and a bytes32 string', () => {
  // "USDT" as a canonical ABI string: offset 32, length 4, data padded.
  const canonical =
    '0x' +
    '20'.padStart(64, '0') +
    '4'.padStart(64, '0') +
    Buffer.from('USDT').toString('hex').padEnd(64, '0');
  assert.equal(rpc.decodeAbiString(canonical), 'USDT');

  const bytes32 = '0x' + Buffer.from('TGR').toString('hex').padEnd(64, '0');
  assert.equal(rpc.decodeAbiString(bytes32), 'TGR');

  assert.equal(rpc.decodeAbiString('0x'), null);
  assert.equal(rpc.decodeAbiString('0xzz'), null);
});

test('hexToBigInt and decodeUint8 parse only well-formed quantities', () => {
  assert.equal(rpc.hexToBigInt('0x1a0a'), 6666n);
  assert.equal(rpc.hexToBigInt('0x'), null);
  assert.equal(rpc.hexToBigInt('nope'), null);
  assert.equal(rpc.decodeUint8('0x12'), 18);
  assert.equal(rpc.decodeUint8('0x100'), null);
});

// ---------------------------------------------------------------------------
// RPC URL validation
// ---------------------------------------------------------------------------

test('requireRpcUrl accepts https and refuses credentials or plaintext in production', () => {
  assert.equal(rpc.requireRpcUrl('https://rpc.example.org'), 'https://rpc.example.org/');

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => rpc.requireRpcUrl('http://rpc.example.org'), rpc.EvmRpcError);
    assert.throws(() => rpc.requireRpcUrl('https://user:pass@rpc.example.org'), rpc.EvmRpcError);
    assert.throws(() => rpc.requireRpcUrl(''), rpc.EvmRpcError);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('jsonRpc fails closed on a JSON-RPC error member', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'boom' } }),
  });
  await assert.rejects(
    () => rpc.jsonRpc('https://rpc.example.org', 'eth_chainId', [], { fetchImpl }),
    /boom/,
  );
});

test('jsonRpc fails closed on a non-2xx status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(
    () => rpc.jsonRpc('https://rpc.example.org', 'eth_chainId', [], { fetchImpl }),
    rpc.EvmRpcError,
  );
});

// ---------------------------------------------------------------------------
// Registry validation
// ---------------------------------------------------------------------------

test('validateChainInput requires an https rpc url and a sane chain id', () => {
  const base = {
    chainKey: 'tigersmartchain',
    name: 'TigerSmartChain',
    chainType: 'evm',
    chainId: 6666,
    nativeSymbol: 'TGR',
    rpcUrl: 'https://rpc.tigersmartchain.example',
  };
  const ok = registry.validateChainInput(base);
  assert.ok('chain' in ok);
  assert.equal(ok.chain.chainId, 6666);
  assert.equal(ok.chain.nativeDecimals, 18);

  assert.ok('error' in registry.validateChainInput({ ...base, chainId: -1 }));
  assert.ok('error' in registry.validateChainInput({ ...base, rpcUrl: 'ftp://x' }));
  assert.ok('error' in registry.validateChainInput({ ...base, chainKey: 'Bad Key' }));
  assert.ok('error' in registry.validateChainInput({ ...base, status: 'live' }));
});

test('validateTokenInput requires a contract address for a non-native EVM token', () => {
  registry.upsertChain({
    chainKey: 'tigersmartchain',
    name: 'TigerSmartChain',
    chainType: 'evm',
    chainId: 6666,
    nativeSymbol: 'TGR',
    rpcUrl: 'https://rpc.tigersmartchain.example',
  });

  const native = registry.validateTokenInput({
    chainKey: 'tigersmartchain',
    symbol: 'TGR',
    name: 'Tiger Coin',
    decimals: 18,
  });
  assert.ok('token' in native);
  assert.equal(native.token.contractAddress, null);

  const missing = registry.validateTokenInput({
    chainKey: 'tigersmartchain',
    symbol: 'RUSD',
    name: 'Royal Tiger USD',
    decimals: 18,
  });
  assert.ok('error' in missing);

  const listed = registry.validateTokenInput({
    chainKey: 'tigersmartchain',
    symbol: 'RUSD',
    name: 'Royal Tiger USD',
    decimals: 18,
    contractAddress: RUSD_ADDRESS,
  });
  assert.ok('token' in listed);
  assert.equal(listed.token.contractAddress, RUSD_ADDRESS);

  // A token cannot be listed on a chain that is not listed.
  assert.ok(
    'error' in
      registry.validateTokenInput({ chainKey: 'nosuchchain', symbol: 'X', name: 'X', decimals: 18 }),
  );
});

// ---------------------------------------------------------------------------
// Registry CRUD against the database
// ---------------------------------------------------------------------------

test('a chain can be listed, read back, and removed when unused', () => {
  registry.upsertChain({
    chainKey: 'ethereum',
    name: 'Ethereum',
    chainType: 'evm',
    chainId: 1,
    nativeSymbol: 'ETH',
    rpcUrl: 'https://rpc.ethereum.example',
  });
  const chain = registry.getChain('ethereum');
  assert.ok(chain);
  assert.equal(chain.chainId, 1);

  registry.removeChain('ethereum');
  assert.equal(registry.getChain('ethereum'), null);
});

test('a chain holding a listed token cannot be removed', () => {
  registry.upsertChain({
    chainKey: 'polygon',
    name: 'Polygon',
    chainType: 'evm',
    chainId: 137,
    nativeSymbol: 'POL',
    rpcUrl: 'https://rpc.polygon.example',
  });
  registry.upsertToken({
    chainKey: 'polygon',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    contractAddress: USDT_ADDRESS,
  });

  assert.throws(() => registry.removeChain('polygon'), registry.ChainError);
  registry.removeToken('polygon', 'USDT');
  registry.removeChain('polygon');
  assert.equal(registry.getChain('polygon'), null);
});

// ---------------------------------------------------------------------------
// TigerSmartChain descriptor
// ---------------------------------------------------------------------------

test('TigerSmartChain config is absent until a node URL is configured', () => {
  delete process.env.TIGEREX_TSC_RPC_URL;
  delete process.env.TIGEREX_TSC_TESTNET_RPC_URL;
  assert.equal(tsc.tigerSmartChainConfig('mainnet'), null);
  assert.throws(() => tsc.registerTigerSmartChain('mainnet'), /TIGEREX_TSC_RPC_URL/);
});

test('TigerSmartChain registers TGR and, when configured, RUSD', () => {
  process.env.TIGEREX_TSC_RPC_URL = 'https://rpc.tigersmartchain.example';
  process.env.TIGEREX_TSC_RUSD_ADDRESS = RUSD_ADDRESS;
  try {
    const { chain, tokens } = tsc.registerTigerSmartChain('mainnet');
    assert.equal(chain.chainKey, 'tigersmartchain');
    assert.equal(chain.chainId, 6666);
    assert.equal(chain.nativeSymbol, 'TGR');

    const symbols = tokens.map((t) => t.symbol).sort();
    assert.deepEqual(symbols, ['RUSD', 'TGR']);
    const rusd = tokens.find((t) => t.symbol === 'RUSD');
    assert.equal(rusd.contractAddress, RUSD_ADDRESS);
    assert.equal(tsc.tigerSmartChainRegistered('mainnet'), true);
  } finally {
    delete process.env.TIGEREX_TSC_RPC_URL;
    delete process.env.TIGEREX_TSC_RUSD_ADDRESS;
  }
});

test('TigerSmartChain addresses are treated as EVM addresses', () => {
  assert.equal(networks.isEvmChainNetwork('tigersmartchain'), true);
  assert.equal(networks.isEvmChainNetwork('TGR'), true);
  assert.equal(networks.isEvmChainNetwork('solana'), false);
});

test('registering TigerSmartChain enables deposits for its tokens only', () => {
  process.env.TIGEREX_TSC_RPC_URL = 'https://rpc.tigersmartchain.example';
  process.env.TIGEREX_TSC_RUSD_ADDRESS = RUSD_ADDRESS;
  process.env.TIGEREX_CUSTODY_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  try {
    tsc.registerTigerSmartChain('mainnet');

    // Both tokens are depositable on the chain, and nothing else is.
    assert.equal(depositNetworks.networkEnabled('TGR', 'TIGERSMARTCHAIN'), true);
    assert.equal(depositNetworks.networkEnabled('RUSD', 'TIGERSMARTCHAIN'), true);
    assert.equal(depositNetworks.networkEnabled('BTC', 'TIGERSMARTCHAIN'), false);

    // The deposit address derives from the custody seed at an EVM address.
    const userId = generateId();
    db.prepare(
      `INSERT INTO users (user_id, email, password_hash, status, kyc_level, kyc_status)
       VALUES (?, ?, 'x', 'active', 'level_1', 'approved')`,
    ).run(userId, `${userId}@example.com`);
    const address = depositAddress(userId, 'TGR', 'TIGERSMARTCHAIN');
    assert.match(address.address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(address.network, 'TIGERSMARTCHAIN');
  } finally {
    delete process.env.TIGEREX_TSC_RPC_URL;
    delete process.env.TIGEREX_TSC_RUSD_ADDRESS;
    delete process.env.TIGEREX_CUSTODY_MNEMONIC;
  }
});

test('an unlisted chain cannot be deposited to', () => {
  assert.equal(depositNetworks.networkEnabled('TGR', 'NOSUCHCHAIN'), false);
  assert.throws(
    () => depositAddress(generateId(), 'TGR', 'NOSUCHCHAIN'),
    (error) => error instanceof DepositError && error.code === 'UNSUPPORTED_NETWORK',
  );
});

// ---------------------------------------------------------------------------
// Environment bootstrap
// ---------------------------------------------------------------------------

test('the bootstrap registers nothing when no node URL is configured', () => {
  delete process.env.TIGEREX_TSC_RPC_URL;
  delete process.env.TIGEREX_TSC_TESTNET_RPC_URL;
  const result = bootstrap.bootstrapChainsFromEnv();
  assert.deepEqual(result.registered, []);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.every((entry) => /RPC_URL/.test(entry.reason)));
});

test('the bootstrap registers the configured chain', () => {
  process.env.TIGEREX_TSC_TESTNET_RPC_URL = 'https://rpc.testnet.tigersmartchain.example';
  try {
    const result = bootstrap.bootstrapChainsFromEnv();
    assert.ok(result.registered.some((entry) => entry.startsWith('tigersmartchain-testnet')));
    assert.equal(tsc.tigerSmartChainRegistered('testnet'), true);
  } finally {
    delete process.env.TIGEREX_TSC_TESTNET_RPC_URL;
  }
});

test('the bootstrap reports a bad node URL as a skip, not a crash', () => {
  process.env.TIGEREX_TSC_RPC_URL = 'not-a-url';
  try {
    const result = bootstrap.bootstrapChainsFromEnv();
    assert.ok(!result.registered.some((entry) => entry.startsWith('tigersmartchain ')));
    assert.ok(result.skipped.some((entry) => entry.chain === 'tigersmartchain'));
  } finally {
    delete process.env.TIGEREX_TSC_RPC_URL;
  }
});

// ---------------------------------------------------------------------------
// On-chain reads
// ---------------------------------------------------------------------------

test('a balance is read from the node and formatted with the token decimals', async () => {
  registry.upsertChain({
    chainKey: 'readtest',
    name: 'Read Test',
    chainType: 'evm',
    chainId: 6666,
    nativeSymbol: 'TGR',
    rpcUrl: 'https://rpc.readtest.example',
  });
  registry.upsertToken({
    chainKey: 'readtest',
    symbol: 'TGR',
    name: 'Tiger Coin',
    decimals: 18,
  });
  registry.upsertToken({
    chainKey: 'readtest',
    symbol: 'RUSD',
    name: 'Royal Tiger USD',
    decimals: 6,
    contractAddress: RUSD_ADDRESS,
  });

  const chain = registry.getChain('readtest');
  const balances = await onchain.readChainBalances(chain, '0x00000000000000000000000000000000000000AA', {
    fetchImpl: fakeNode({
      balances: { native: '0xde0b6b3a7640000', [RUSD_ADDRESS.toLowerCase()]: '0xf4240' },
    }),
  });

  const tgr = balances.find((b) => b.symbol === 'TGR');
  const rusd = balances.find((b) => b.symbol === 'RUSD');
  assert.equal(tgr.amount, '1');
  assert.equal(tgr.isNative, true);
  assert.equal(rusd.amount, '1');
  assert.equal(rusd.decimals, 6);
  assert.equal(rusd.contractAddress, RUSD_ADDRESS);
});

test('a node reporting the wrong chain id fails closed', async () => {
  registry.upsertChain({
    chainKey: 'mismatch',
    name: 'Mismatch',
    chainType: 'evm',
    chainId: 6666,
    nativeSymbol: 'TGR',
    rpcUrl: 'https://rpc.mismatch.example',
  });
  registry.upsertToken({ chainKey: 'mismatch', symbol: 'TGR', name: 'Tiger Coin', decimals: 18 });

  const chain = registry.getChain('mismatch');
  await assert.rejects(
    () => onchain.readChainBalances(chain, '0x00000000000000000000000000000000000000AA', {
      fetchImpl: fakeNode({ chainId: '0x1' }),
    }),
    (error) => error instanceof rpc.EvmRpcError && error.code === 'CHAIN_ID_MISMATCH',
  );
});

test('a non-EVM chain is not read on-chain', async () => {
  registry.upsertChain({
    chainKey: 'solana',
    name: 'Solana',
    chainType: 'non-evm',
    chainId: 0,
    nativeSymbol: 'SOL',
    rpcUrl: 'https://rpc.solana.example',
  });
  const chain = registry.getChain('solana');
  await assert.rejects(
    () => onchain.readChainBalances(chain, 'someaddress', { fetchImpl: fakeNode() }),
    (error) => error instanceof rpc.EvmRpcError && error.code === 'CHAIN_NOT_EVM',
  );
});

test('a user with a wallet address on a chain reads that chain balance', async () => {
  const userId = generateId();
  const walletId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status, kyc_level, kyc_status)
     VALUES (?, ?, 'x', 'active', 'level_1', 'approved')`,
  ).run(userId, `${userId}@example.com`);
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, address, status)
     VALUES (?, ?, 'spot', 'TGR', 'READTEST', '0x00000000000000000000000000000000000000AA', 'active')`,
  ).run(walletId, userId);

  const { results, errors } = await onchain.readUserOnChainBalances(userId, {
    fetchImpl: fakeNode({ balances: { native: '0xde0b6b3a7640000' } }),
  });
  assert.equal(errors.length, 0);
  const readtest = results.find((r) => r.chainKey === 'readtest');
  assert.ok(readtest);
  assert.equal(readtest.balances.find((b) => b.symbol === 'TGR').amount, '1');
});
