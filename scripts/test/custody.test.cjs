'use strict';
/**
 * Deposit scanning and withdrawal settlement, end to end.
 *
 * These drive the real code paths against an injected JSON-RPC transport, so the
 * requests the exchange builds and the responses it accepts are the real ones.
 * The properties that matter for customer funds are pinned: a deposit is
 * credited exactly once, a withdrawal is signed with the user's own custody key
 * and sent from their own address, the reservation is consumed exactly once, and
 * a reverted transaction returns it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-custody-')), 'custody.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_SCAN_START_BLOCK_TESTCHAIN = '5';
process.env.TIGEREX_DEFAULT_CONFIRMATIONS = '3';

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const { getDb, generateId, hashPassword } = require(path.join(BUILD, 'index.js'));
const { creditAvailable, lockAvailable } = require(path.join(BUILD, 'ledger.js'));
const { deriveEvmAddress } = require(path.join(BUILD, 'hd.js'));
const { scanChain, confirmDeposits } = require(path.join(BUILD, 'scanner.js'));
const { broadcastWithdrawal, syncBroadcastWithdrawals, PayoutError } = require(path.join(BUILD, 'payout.js'));

// A fixed, well-known test mnemonic. Never used outside tests.
const MNEMONIC = 'test test test test test test test test test test test junk';
const CUSTODY_ADDRESS = deriveEvmAddress(MNEMONIC, 0);
process.env.TIGEREX_CUSTODY_MNEMONIC = MNEMONIC;

const db = getDb();
const HEAD = 10;
// A well-formed 32-byte hash, the shape a node returns for a sent transaction.

function fakeNode(overrides = {}) {
  // Each node instance mints a distinct hash; chain_transactions is unique on
  // (chain_key, tx_hash), so a shared constant would collide across tests.
  const txHash = `0x${require('node:crypto').randomBytes(32).toString('hex')}`;
  return async (url, init) => {
    const request = JSON.parse(init.body);
    const respond = (result) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) });
    if (overrides[request.method]) return respond(overrides[request.method](request.params));
    switch (request.method) {
      case 'eth_blockNumber':
        return respond(`0x${HEAD.toString(16)}`);
      case 'eth_getLogs':
        return respond(overrides.logs ?? []);
      case 'eth_getBlockByNumber':
        return respond(overrides.block ?? { number: '0x5', transactions: [] });
      case 'eth_getTransactionReceipt':
        return respond(overrides.receipt ?? { status: '0x1', blockNumber: '0x8' });
      case 'eth_getTransactionCount':
        return respond('0x0');
      case 'eth_gasPrice':
        return respond('0x3b9aca00');
      case 'eth_estimateGas':
        return respond('0x5208');
      case 'eth_sendRawTransaction':
        return respond(txHash);
      default:
        return respond('0x0');
    }
  };
}

function seedChain() {
  db.prepare(
    `INSERT INTO blockchain_chains (chain_key, name, chain_type, chain_id, native_symbol, native_decimals, rpc_url, explorer_url, status)
     VALUES ('testchain', 'Test Chain', 'evm', 1234, 'ETH', 18, 'https://rpc.example.com', '', 'active')`,
  ).run();
}

function seedUser() {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.test`,
    hashPassword('pw'),
    'active',
  );
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, address, address_index)
     VALUES (?, ?, 'spot', 'ETH', 'TESTCHAIN', ?, '0')`,
  ).run(walletId, userId, CUSTODY_ADDRESS);
  return { userId, walletId };
}

seedChain();

test('the scanner records an ERC-20 and a native deposit without crediting yet', async () => {
  const { userId } = seedUser();

  // A Transfer log to the user's own custody address, at block 8 (3 confirmations).
  const log = {
    address: '0x00000000000000000000000000000000000000aa',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      `0x${'00'.repeat(32)}`,
      `0x${CUSTODY_ADDRESS.slice(2).toLowerCase().padStart(64, '0')}`,
    ],
    data: `0x${(1500000n).toString(16).padStart(64, '0')}`,
    blockNumber: '0x8',
    transactionHash: '0xtoken',
    logIndex: '0x0',
  };
  // List the token so the log is recognised.
  db.prepare(
    `INSERT INTO blockchain_tokens (token_id, chain_key, symbol, name, contract_address, decimals, status)
     VALUES (?, 'testchain', 'USDT', 'Tether', ?, 6, 'active')`,
  ).run(generateId(), '0x00000000000000000000000000000000000000aa');
  db.prepare(
    `INSERT INTO deposit_networks (network_id, asset, network, display_name, min_deposit, confirmations)
     VALUES (?, 'USDT', 'TESTCHAIN', 'Test Chain', 1, 3)`,
  ).run(generateId());

  // A native transfer to the same address, in block 9.
  const block = {
    number: '0x9',
    transactions: [{ hash: '0xnative', to: CUSTODY_ADDRESS, value: `0x${(10n ** 18n).toString(16)}` }],
  };

  const chain = { chainKey: 'testchain', chainType: 'evm', rpcUrl: 'https://rpc.example.com', nativeSymbol: 'ETH', nativeDecimals: 18 };
  const report = await scanChain(chain, { fetchImpl: fakeNode({ logs: [log], block }) });
    assert.equal(report.error, undefined);
  assert.equal(report.found, 2);

  const rows = db.prepare('SELECT currency, amount, status FROM deposits ORDER BY currency').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.currency), ['ETH', 'USDT']);
  assert.ok(rows.every((r) => r.status === 'pending'));
  assert.equal(Number(rows.find((r) => r.currency === 'USDT').amount), 1.5);

  // The cursor advanced, so a re-scan does not re-read the same blocks.
  const cursor = db.prepare("SELECT last_scanned_block FROM chain_cursors WHERE chain_key = 'testchain'").get();
  assert.equal(cursor.last_scanned_block, 10);

  // Nothing is credited until confirmations are met.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM balances').get().c, 0);

  const confirm = await confirmDeposits({ fetchImpl: fakeNode() });
  assert.equal(confirm.credited, 2);
  const balances = db.prepare("SELECT currency, available FROM balances ORDER BY currency").all();
  assert.equal(Number(balances.find((b) => b.currency === 'USDT').available), 1.5);
  assert.equal(Number(balances.find((b) => b.currency === 'ETH').available), 1);

  // A second confirm credits nothing.
  const again = await confirmDeposits({ fetchImpl: fakeNode() });
  assert.equal(again.credited, 0);
});

test('a reverted deposit transaction is marked failed, not credited', async () => {
  const { userId } = seedUser();
  db.prepare(
    `INSERT INTO deposits (deposit_id, user_id, wallet_id, currency, network, amount, tx_hash, address, confirmations, required_confirmations, status)
     VALUES (?, ?, NULL, 'ETH', 'TESTCHAIN', 2, '0xreverted', ?, 5, 3, 'pending')`,
  ).run(generateId(), userId, CUSTODY_ADDRESS);

  await confirmDeposits({ fetchImpl: fakeNode({ receipt: { status: '0x0', blockNumber: '0x8' } }) });
  const row = db.prepare("SELECT status FROM deposits WHERE tx_hash = '0xreverted'").get();
  assert.equal(row.status, 'failed');
});

test('a withdrawal is signed with the user custody key and sent from their own address', async () => {
  const { userId } = seedUser();
  creditAvailable(userId, 'ETH', 5);
  lockAvailable(userId, 'ETH', 1.1);

  const withdrawalId = generateId();
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, status)
     VALUES (?, ?, (SELECT wallet_id FROM wallets WHERE user_id = ? LIMIT 1), 'ETH', 'TESTCHAIN', 1, 0.1, ?, 'pending')`,
  ).run(withdrawalId, userId, userId, '0x1111111111111111111111111111111111111111');

  const result = await broadcastWithdrawal(withdrawalId, { fetchImpl: fakeNode() });
  assert.ok(/^0x[0-9a-f]{64}$/.test(result.txHash));

  const row = db.prepare('SELECT status, tx_hash FROM withdrawals WHERE withdrawal_id = ?').get(withdrawalId);
  assert.equal(row.status, 'broadcast');
  assert.ok(/^0x[0-9a-f]{64}$/.test(row.tx_hash));

  // The reservation was consumed, not returned: the funds have left.
  const balance = db.prepare(
    `SELECT available, locked FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
      WHERE w.user_id = ? AND b.currency = 'ETH'`,
  ).get(userId);
  assert.equal(Number(balance.locked), 0);
  assert.equal(Number(balance.available), 3.9);

  // The recorded sender is the user's own custody address.
  const tx = db.prepare("SELECT from_address, status FROM chain_transactions WHERE reference_id = ?").get(withdrawalId);
  assert.equal(tx.from_address.toLowerCase(), CUSTODY_ADDRESS.toLowerCase());
  assert.equal(tx.status, 'broadcast');

  // A second broadcast is refused, which is what prevents a double send.
  await assert.rejects(() => broadcastWithdrawal(withdrawalId, { fetchImpl: fakeNode() }), (e) => e.code === 'ALREADY_BROADCAST');

  // Once mined, the sweep completes it.
  const sync = await syncBroadcastWithdrawals({ fetchImpl: fakeNode({ receipt: { status: '0x1', blockNumber: '0x8' } }) });
  assert.equal(sync.confirmed, 1);
  assert.equal(db.prepare('SELECT status FROM withdrawals WHERE withdrawal_id = ?').get(withdrawalId).status, 'completed');
});

test('a withdrawal with no custody key fails closed', async () => {
  const { userId } = seedUser();
  creditAvailable(userId, 'ETH', 2);
  lockAvailable(userId, 'ETH', 1);
  db.prepare("UPDATE wallets SET address_index = NULL WHERE user_id = ?").run(userId);

  const withdrawalId = generateId();
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, status)
     VALUES (?, ?, NULL, 'ETH', 'TESTCHAIN', 1, 0, ?, 'pending')`,
  ).run(withdrawalId, userId, '0x1111111111111111111111111111111111111111');

  await assert.rejects(
    () => broadcastWithdrawal(withdrawalId, { fetchImpl: fakeNode() }),
    (e) => e instanceof PayoutError && e.code === 'CUSTODY_KEY_UNAVAILABLE',
  );
});

test('a reverted withdrawal transaction returns the reservation', async () => {
  const { userId } = seedUser();
  creditAvailable(userId, 'ETH', 5);
  lockAvailable(userId, 'ETH', 1);

  const withdrawalId = generateId();
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, status)
     VALUES (?, ?, (SELECT wallet_id FROM wallets WHERE user_id = ? LIMIT 1), 'ETH', 'TESTCHAIN', 1, 0, ?, 'pending')`,
  ).run(withdrawalId, userId, userId, '0x2222222222222222222222222222222222222222');

  await broadcastWithdrawal(withdrawalId, { fetchImpl: fakeNode() });
  const sync = await syncBroadcastWithdrawals({ fetchImpl: fakeNode({ receipt: { status: '0x0', blockNumber: '0x8' } }) });
  assert.equal(sync.failed, 1);

  assert.equal(db.prepare('SELECT status FROM withdrawals WHERE withdrawal_id = ?').get(withdrawalId).status, 'failed');
  const balance = db.prepare(
    `SELECT available, locked FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
      WHERE w.user_id = ? AND b.currency = 'ETH'`,
  ).get(userId);
  assert.equal(Number(balance.locked), 0);
  assert.equal(Number(balance.available), 5);
});

// --- Hot-wallet nonce allocation --------------------------------------------

test('two concurrent payouts from one address receive distinct nonces', async () => {
  const { Transaction } = require('ethers');
  const { userId } = seedUser();
  creditAvailable(userId, 'ETH', 10);
  lockAvailable(userId, 'ETH', 4);

  const ids = [];
  for (let i = 0; i < 2; i += 1) {
    const withdrawalId = generateId();
    ids.push(withdrawalId);
    db.prepare(
      `INSERT INTO withdrawals (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, status)
       VALUES (?, ?, (SELECT wallet_id FROM wallets WHERE user_id = ? LIMIT 1), 'ETH', 'TESTCHAIN', 1, 0, ?, 'pending')`,
    ).run(withdrawalId, userId, userId, `0x333333333333333333333333333333333333333${i}`);
  }

  // The node reports nonce 5 for the custody address. Both payouts are signed
  // from that one address, so they must be given 5 and 6 — never 5 and 5.
  const sent = [];
  const node = fakeNode({
    eth_getTransactionCount: () => '0x5',
    eth_sendRawTransaction: (params) => {
      sent.push(params[0]);
      return `0x${require('node:crypto').randomBytes(32).toString('hex')}`;
    },
  });

  await Promise.all(ids.map((id) => broadcastWithdrawal(id, { fetchImpl: node })));

  assert.equal(sent.length, 2);
  const nonces = sent.map((raw) => Transaction.from(raw).nonce).sort((a, b) => a - b);
  assert.deepEqual(nonces, [5, 6], 'the two payouts must not reuse a nonce');
});

test('the nonce counter advances across separate payouts', async () => {
  const { Transaction } = require('ethers');
  const { userId } = seedUser();
  creditAvailable(userId, 'ETH', 10);
  lockAvailable(userId, 'ETH', 4);

  const sent = [];
  const node = fakeNode({
    eth_getTransactionCount: () => '0x2',
    eth_sendRawTransaction: (params) => {
      sent.push(params[0]);
      return `0x${require('node:crypto').randomBytes(32).toString('hex')}`;
    },
  });

  for (let i = 0; i < 3; i += 1) {
    const withdrawalId = generateId();
    db.prepare(
      `INSERT INTO withdrawals (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, status)
       VALUES (?, ?, (SELECT wallet_id FROM wallets WHERE user_id = ? LIMIT 1), 'ETH', 'TESTCHAIN', 1, 0, ?, 'pending')`,
    ).run(withdrawalId, userId, userId, `0x444444444444444444444444444444444444444${i}`);
    await broadcastWithdrawal(withdrawalId, { fetchImpl: node });
  }

  const nonces = sent.map((raw) => Transaction.from(raw).nonce);
  assert.equal(nonces.length, 3);
  // Every test in this file shares the index-0 custody address, so the absolute
  // values depend on earlier allocations. The invariant is that each payout
  // takes a strictly greater nonce than the last, even though the node keeps
  // reporting the same pending nonce.
  assert.ok(nonces[1] > nonces[0] && nonces[2] > nonces[1], `nonces must increase, got ${nonces}`);
  assert.equal(nonces[1] - nonces[0], 1);
  assert.equal(nonces[2] - nonces[1], 1);
});

// --- Deposit reorg reversal --------------------------------------------------

const { reverseReorgedDeposits } = require(path.join(BUILD, 'scanner.js'));

/** Credit a deposit directly at a known block, the state a reorg must reverse. */
function creditedDeposit(userId, asset, amount, txHash, blockNumber) {
  // The reorg sweep is global (it looks at every credited deposit), so clear
  // deposits left credited by earlier tests to keep each count exact.
  db.prepare("UPDATE deposits SET status = 'settled' WHERE status = 'credited'").run();
  const depositId = generateId();
  db.prepare(
    `INSERT INTO deposits (deposit_id, user_id, wallet_id, currency, network, amount, tx_hash, address, confirmations, required_confirmations, block_number, status, credited_at)
     VALUES (?, ?, NULL, ?, 'TESTCHAIN', ?, ?, ?, 12, 3, ?, 'credited', datetime('now'))`,
  ).run(depositId, userId, asset, amount, txHash, CUSTODY_ADDRESS, blockNumber);
  creditAvailable(userId, asset, amount);
  return depositId;
}

test('a credited deposit whose transaction vanished is reversed', async () => {
  const { userId } = seedUser();
  const depositId = creditedDeposit(userId, 'ETH', 3, '0xvanished', 42);
  assert.equal(db.prepare("SELECT available FROM balances b JOIN wallets w ON w.wallet_id=b.wallet_id WHERE w.user_id=? AND b.currency='ETH'").get(userId).available, 3);

  // The node no longer knows the transaction: a reorg orphaned it.
  const report = await reverseReorgedDeposits({ fetchImpl: fakeNode({ receipt: null }) });
  assert.equal(report.reversed, 1);
  assert.equal(report.held, 0);

  assert.equal(db.prepare('SELECT status FROM deposits WHERE deposit_id = ?').get(depositId).status, 'reorged');
  assert.equal(
    Number(db.prepare("SELECT available FROM balances b JOIN wallets w ON w.wallet_id=b.wallet_id WHERE w.user_id=? AND b.currency='ETH'").get(userId).available),
    0,
  );

  // Idempotent: a second sweep reverses nothing and debits nothing again.
  const again = await reverseReorgedDeposits({ fetchImpl: fakeNode({ receipt: null }) });
  assert.equal(again.reversed, 0);
});

test('a deposit still on the chain at its recorded block is left alone', async () => {
  const { userId } = seedUser();
  creditedDeposit(userId, 'ETH', 2, '0xstable', 50);

  const report = await reverseReorgedDeposits({
    fetchImpl: fakeNode({ receipt: { status: '0x1', blockNumber: '0x32' } }), // 0x32 = 50
  });
  assert.equal(report.reversed, 0);
  assert.equal(report.held, 0);
  assert.equal(
    Number(db.prepare("SELECT available FROM balances b JOIN wallets w ON w.wallet_id=b.wallet_id WHERE w.user_id=? AND b.currency='ETH'").get(userId).available),
    2,
  );
});

test('a deposit moved to a different block is treated as reorged', async () => {
  const { userId } = seedUser();
  const depositId = creditedDeposit(userId, 'ETH', 1, '0xmoved', 60);

  const report = await reverseReorgedDeposits({
    fetchImpl: fakeNode({ receipt: { status: '0x1', blockNumber: '0x3f' } }), // 0x3f = 63
  });
  assert.equal(report.reversed, 1);
  assert.equal(db.prepare('SELECT status FROM deposits WHERE deposit_id = ?').get(depositId).status, 'reorged');
});

test('a reorged deposit whose funds were already spent holds the account', async () => {
  const { userId } = seedUser();
  creditedDeposit(userId, 'ETH', 5, '0xspent', 70);
  // The user spends the credit before the reorg is noticed.
  const { debitAvailable } = require(path.join(BUILD, 'ledger.js'));
  debitAvailable(userId, 'ETH', 5);

  const report = await reverseReorgedDeposits({ fetchImpl: fakeNode({ receipt: null }) });
  assert.equal(report.reversed, 0);
  assert.equal(report.held, 1);

  // The account is held rather than left with a negative balance.
  const user = db.prepare('SELECT withdrawal_hold_until FROM users WHERE user_id = ?').get(userId);
  assert.ok(user.withdrawal_hold_until, 'a withdrawal hold must be placed');
  assert.equal(
    Number(db.prepare("SELECT available FROM balances b JOIN wallets w ON w.wallet_id=b.wallet_id WHERE w.user_id=? AND b.currency='ETH'").get(userId).available),
    0,
  );
});
