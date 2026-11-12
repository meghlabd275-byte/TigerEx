'use client';

import { useCallback, useEffect, useState } from 'react';
import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';
import { readAdminToken } from '@/lib/auth/token';

/**
 * Blockchain listing administration.
 *
 * A chain exists only once it is listed here. The node URL is the endpoint the
 * exchange dials to read balances, and the chain id is what that node must
 * report before a balance is trusted.
 */
const spec: ListingSpec = {
  title: 'Chains',
  description:
    'List the blockchains the exchange serves. The node URL is dialled directly for balances and must report the chain id recorded here. No chain is served until it is listed.',
  endpoint: '/api/admin/chains',
  listKey: 'chains',
  symbolField: 'chainKey',
  deleteQuery: 'chainKey',
  fields: [
    { name: 'chainKey', label: 'Chain key', type: 'text', required: true, placeholder: 'tigersmartchain', help: 'lowercase letters, digits, dash or underscore' },
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'TigerSmartChain' },
    { name: 'chainType', label: 'Type', type: 'select', options: ['evm', 'non-evm'], required: true },
    { name: 'chainId', label: 'Chain ID', type: 'number', step: '1', required: true, placeholder: '9001', help: 'the id the node reports on eth_chainId (TigerSmartChain mainnet 9001, testnet 9000)' },
    { name: 'nativeSymbol', label: 'Native symbol', type: 'text', required: true, placeholder: 'TGR' },
    { name: 'nativeDecimals', label: 'Native decimals', type: 'number', step: '1', placeholder: '18' },
    { name: 'rpcUrl', label: 'Node URL', type: 'text', required: true, placeholder: 'https://rpc.example.org', help: 'https only; no credentials in the URL' },
    { name: 'explorerUrl', label: 'Explorer URL', type: 'text', placeholder: 'https://scan.example.org' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting'], required: true },
  ],
  defaults: { chainType: 'evm', nativeDecimals: 18, status: 'active' },
};

interface TigerSmartChainState {
  network: string;
  configured: boolean;
  registered: boolean;
  chainKey: string;
  chainId: number;
  name: string | null;
  hasRusdAddress: boolean;
  tokens: Array<{ symbol: string; name: string; decimals: number; status: string }>;
}

function TigerSmartChainPanel() {
  const [state, setState] = useState<{ mainnet: TigerSmartChainState; testnet: TigerSmartChainState } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = readAdminToken();
    const response = await fetch('/api/admin/chains/tiger-smart-chain', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) {
      setState({ mainnet: body.mainnet, testnet: body.testnet });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const register = async (network: 'mainnet' | 'testnet') => {
    setBusy(true);
    setStatus(null);
    try {
      const token = readAdminToken();
      const response = await fetch('/api/admin/chains/tiger-smart-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ network }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setStatus({ ok: false, text: body?.error?.message ?? 'Registration was refused.' });
        return;
      }
      setStatus({ ok: true, text: `TigerSmartChain ${network} registered.` });
      await load();
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : 'Registration was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-6 mt-6 rounded-lg bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">TigerSmartChain</h2>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">
        The exchange&apos;s own EVM chain (TGR native, RUSD stablecoin). Its node URL comes from the deployment
        environment; registering applies that configuration to the registry and enables the deposit networks for its
        tokens.
      </p>

      {status && (
        <div
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            status.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {state &&
          (['mainnet', 'testnet'] as const).map((network) => {
            const entry = state[network];
            return (
              <div key={network} className="rounded border p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{network}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      entry.registered
                        ? 'bg-green-100 text-green-700'
                        : entry.configured
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {entry.registered ? 'listed' : entry.configured ? 'configured, not listed' : 'not configured'}
                  </span>
                </div>
                <p className="mt-2 text-gray-500">Chain key: {entry.chainKey}</p>
                <p className="text-gray-500">Chain id: {entry.chainId}</p>
                <p className="text-gray-500">RUSD address: {entry.hasRusdAddress ? 'configured' : 'not set'}</p>
                {entry.tokens.length > 0 && (
                  <p className="mt-1 text-gray-500">
                    Tokens: {entry.tokens.map((token) => token.symbol).join(', ')}
                  </p>
                )}
                <button
                  onClick={() => register(network)}
                  disabled={busy || !entry.configured}
                  className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
                >
                  {entry.registered ? 'Re-register' : 'Register'}
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default function AdminChainsPage() {
  return (
    <div>
      <ListingManager spec={spec} />
      <TigerSmartChainPanel />
    </div>
  );
}
