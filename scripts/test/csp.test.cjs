'use strict';
/**
 * Regression tests for the Content-Security-Policy.
 *
 * The policy shipped with `script-src 'self' 'unsafe-inline'`, which lets any
 * injected inline script run: a reflected or stored value that reached the DOM
 * as markup would execute. These cases pin the property that makes XSS inert —
 * a nonce plus `strict-dynamic` and no `unsafe-inline` in `script-src` — so a
 * future edit that reintroduces the old directive fails here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCsp, connectSources } = require('../../.test-build/csp.js');

function scriptSrc(policy) {
  const directive = policy.split('; ').find((part) => part.startsWith('script-src'));
  assert.ok(directive, `no script-src in policy: ${policy}`);
  return directive;
}

test('script-src carries the nonce and strict-dynamic', () => {
  const policy = buildCsp('NONCE123', { production: true });
  const directive = scriptSrc(policy);
  assert.match(directive, /'nonce-NONCE123'/);
  assert.match(directive, /'strict-dynamic'/);
});

test('script-src never allows unsafe-inline', () => {
  for (const production of [true, false]) {
    const policy = buildCsp('abc', { production });
    assert.ok(
      !scriptSrc(policy).includes("'unsafe-inline'"),
      `unsafe-inline must not appear in script-src (production=${production})`,
    );
  }
});

test('the nonce is unique per policy and not a constant', () => {
  const a = buildCsp('AAAA', { production: true });
  const b = buildCsp('BBBB', { production: true });
  assert.notEqual(a, b);
  assert.match(a, /'nonce-AAAA'/);
  assert.match(b, /'nonce-BBBB'/);
});

test('frame-ancestors and object-src are locked down', () => {
  const policy = buildCsp('n', { production: true });
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
});

test('a configured API origin is added to connect-src, a relative one is not', () => {
  const withOrigin = buildCsp('n', { production: true, apiUrl: 'https://api.tigerex.example/v1' });
  assert.match(withOrigin, /connect-src[^;]*https:\/\/api\.tigerex\.example/);

  const relative = connectSources('/api', true);
  assert.match(relative, /'self'/);
  assert.ok(!relative.includes('/api'), 'a relative base must not be added as an origin');
});

test('upgrade-insecure-requests only in production', () => {
  assert.match(buildCsp('n', { production: true }), /upgrade-insecure-requests/);
  assert.ok(!buildCsp('n', { production: false }).includes('upgrade-insecure-requests'));
});
