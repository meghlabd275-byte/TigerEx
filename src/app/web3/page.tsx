'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  Copy,
  Check,
  Eye,
  EyeOff,
  QrCode,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  Globe,
  Coins,
  Send,
  Receipt,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/components/auth/AuthContext';

/**
 * Web3 wallet view.
 *
 * The chain list and every balance come from the exchange's own chain registry
 * (`/api/chains`) and its on-chain reader (`/api/wallet/onchain`): a balance is
 * read live from the node the operator configured for that chain, at the
 * address the exchange derived for the account. Nothing is hard-coded and
 * nothing is estimated — a chain whose node cannot be reached is shown as
 * unavailable rather than as a zero balance.
 */

interface ChainToken {
  symbol: string;
  name: string;
  decimals: number;
  contractAddress: string | null;
  isNative: boolean;
}

interface Chain {
  chainKey: string;
  name: string;
  chainType: 'evm' | 'non-evm';
  chainId: number;
  nativeSymbol: string;
  explorerUrl: string;
  tokens: ChainToken[];
}

interface OnChainBalance {
  symbol: string;
  amount: string;
  decimals: number;
  contractAddress: string | null;
  isNative: boolean;
}

interface ChainBalances {
  chainKey: string;
  chainName: string;
  address: string;
  chainId: number;
  balances: OnChainBalance[];
}

interface ChainError {
  chainKey: string;
  code: string;
  message: string;
}

interface AssetRow {
  symbol: string;
  name: string;
  amount: string;
  usdValue: number | null;
  chainKey: string;
  chainName: string;
}

interface ActivityRow {
  id: string;
  direction: 'in' | 'out';
  asset: string;
  amount: number;
  status: string;
  createdAt: string;
  txHash: string | null;
}

function messageOf(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return fallback;
}

export default function Web3WalletPage() {
  const { accessToken } = useAuth();

  const [showBalance, setShowBalance] = useState(true);
  const [copied, setCopied] = useState(false);
  const [chains, setChains] = useState<Chain[]>([]);
  const [selectedChainKey, setSelectedChainKey] = useState<string>('');
  const [showChains, setShowChains] = useState(false);
  const [activeTab, setActiveTab] = useState<'assets' | 'activity' | 'custody'>('assets');
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [chainErrors, setChainErrors] = useState<ChainError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sendForm, setSendForm] = useState({ address: '', amount: '', asset: '' });
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);

  const selectedChain = chains.find((chain) => chain.chainKey === selectedChainKey) ?? null;

  // The chain registry is public, so it is loaded whether or not a user is
  // signed in; balances and addresses need a session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/chains', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        const list: Chain[] = Array.isArray(body?.chains) ? body.chains : [];
        if (cancelled) return;
        setChains(list);
        setSelectedChainKey((current) => current || list[0]?.chainKey || '');
      } catch {
        if (!cancelled) setChains([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadWallet = useCallback(async () => {
    if (!accessToken) {
      setWalletAddress('');
      setAssets([]);
      setActivity([]);
      setChainErrors([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const auth = { Authorization: `Bearer ${accessToken}` };
      const [onchainResponse, balancesResponse, activityResponse] = await Promise.all([
        fetch('/api/wallet/onchain', { headers: auth, cache: 'no-store' }),
        fetch('/api/wallet/balances', { headers: auth, cache: 'no-store' }),
        fetch('/api/wallet/transfers?limit=20', { headers: auth, cache: 'no-store' }),
      ]);

      // USD prices come from the exchange's own market data, keyed by asset.
      const prices = new Map<string, number | null>();
      if (balancesResponse.ok) {
        const balancesBody = await balancesResponse.json().catch(() => null);
        for (const row of Array.isArray(balancesBody?.balances) ? balancesBody.balances : []) {
          prices.set(String(row.currency).toUpperCase(), row.usdPrice ?? null);
        }
      }

      if (onchainResponse.ok) {
        const body = await onchainResponse.json().catch(() => null);
        const chainResults: ChainBalances[] = Array.isArray(body?.chains) ? body.chains : [];
        setChainErrors(Array.isArray(body?.errors) ? body.errors : []);

        const nameBySymbol = new Map<string, string>();
        for (const chain of chains) {
          for (const token of chain.tokens) nameBySymbol.set(`${chain.chainKey}:${token.symbol}`, token.name);
        }

        const rows: AssetRow[] = [];
        for (const result of chainResults) {
          for (const balance of result.balances) {
            const price = prices.get(balance.symbol) ?? null;
            const amount = Number(balance.amount);
            rows.push({
              symbol: balance.symbol,
              name: nameBySymbol.get(`${result.chainKey}:${balance.symbol}`) ?? balance.symbol,
              amount: balance.amount,
              usdValue: price === null || !Number.isFinite(amount) ? null : amount * price,
              chainKey: result.chainKey,
              chainName: result.chainName,
            });
          }
        }
        setAssets(rows);

        const selected = chainResults.find((result) => result.chainKey === selectedChainKey) ?? chainResults[0];
        setWalletAddress(selected?.address ?? '');
      } else {
        const body = await onchainResponse.json().catch(() => null);
        setChainErrors([]);
        setAssets([]);
        if (onchainResponse.status !== 401) {
          setError(messageOf(body, 'On-chain balances could not be read.'));
        }
      }

      if (activityResponse.ok) {
        const body = await activityResponse.json().catch(() => null);
        const list = Array.isArray(body?.transfers) ? body.transfers : [];
        setActivity(
          list.map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ''),
            direction: row.direction === 'out' ? 'out' : 'in',
            asset: String(row.asset ?? row.coin ?? ''),
            amount: Number(row.amount) || 0,
            status: String(row.status ?? ''),
            createdAt: String(row.createdAt ?? row.created_at ?? ''),
            txHash: row.txHash ? String(row.txHash) : null,
          })),
        );
      } else {
        setActivity([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet data could not be loaded.');
      setAssets([]);
      setActivity([]);
      setWalletAddress('');
    } finally {
      setLoading(false);
    }
  }, [accessToken, chains, selectedChainKey]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  // The receive address for the selected chain is resolved on demand, so the
  // view never shows another chain's address.
  useEffect(() => {
    if (!accessToken || !selectedChain) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/wallet/address?network=${encodeURIComponent(selectedChain.chainKey)}&currency=${encodeURIComponent(
            selectedChain.nativeSymbol,
          )}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
        );
        if (!response.ok) return;
        const body = await response.json().catch(() => null);
        if (!cancelled && body?.address) setWalletAddress(String(body.address));
      } catch {
        /* the address simply stays as it was */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedChain]);

  const chainAssets = selectedChain ? assets.filter((asset) => asset.chainKey === selectedChain.chainKey) : assets;
  const totalBalance = assets.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0);

  const copyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  const formatNumber = (num: number): string =>
    num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatAddress = (addr: string): string => {
    if (!addr) return 'No address issued yet';
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const submitSend = async () => {
    setSendStatus(null);
    if (!selectedChain) {
      setSendStatus({ ok: false, text: 'Select a chain first.' });
      return;
    }
    if (!sendForm.address.trim() || !sendForm.amount.trim()) {
      setSendStatus({ ok: false, text: 'A destination address and an amount are required.' });
      return;
    }
    setSendBusy(true);
    try {
      const response = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` },
        body: JSON.stringify({
          coin: sendForm.asset || selectedChain.nativeSymbol,
          network: selectedChain.chainKey,
          address: sendForm.address.trim(),
          amount: Number(sendForm.amount),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setSendStatus({ ok: false, text: messageOf(body, 'The withdrawal was refused.') });
        return;
      }
      setSendStatus({ ok: true, text: 'Withdrawal submitted and queued for approval.' });
      setSendForm({ address: '', amount: '', asset: '' });
      await loadWallet();
    } catch (cause) {
      setSendStatus({ ok: false, text: cause instanceof Error ? cause.message : 'The withdrawal was refused.' });
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">T</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx</span>
              </Link>
              <span className="text-gray-500">/</span>
              <span className="font-medium text-gray-900 dark:text-white">Web3 Wallet</span>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={loadWallet} className="p-2 text-gray-500 hover:text-gray-900 dark:hover:text-white">
                <RefreshCw className="w-5 h-5" />
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Wallet className="w-6 h-6" />
              <span className="font-medium">On-chain Wallet</span>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-white/70 text-sm mb-1">Total Value</p>
            <div className="flex items-center">
              <h1 className="text-3xl font-bold">
                {showBalance ? `$${formatNumber(totalBalance)}` : '********'}
              </h1>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="ml-3 p-1.5 bg-white/20 rounded-lg hover:bg-white/30"
              >
                {showBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="bg-white/10 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <code className="text-sm font-mono">{formatAddress(walletAddress)}</code>
              <button onClick={copyAddress} className="p-1 hover:bg-white/20 rounded" disabled={!walletAddress}>
                {copied ? <Check className="w-4 h-4 text-green-300" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={() => setShowReceive(true)}
              className="flex items-center space-x-1 text-sm bg-white/20 px-3 py-1.5 rounded-lg hover:bg-white/30"
            >
              <QrCode className="w-4 h-4" />
              <span>Receive</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <button
              onClick={() => setShowSend(true)}
              className="flex flex-col items-center justify-center py-3 bg-white text-indigo-600 rounded-xl font-medium hover:bg-white/90"
            >
              <Send className="w-5 h-5 mb-1" />
              Withdraw
            </button>
            <Link
              href="/dex"
              className="flex flex-col items-center justify-center py-3 bg-white/20 text-white rounded-xl font-medium hover:bg-white/30"
            >
              <ArrowRightLeft className="w-5 h-5 mb-1" />
              TigerSwap
            </Link>
            <Link
              href="/earn"
              className="flex flex-col items-center justify-center py-3 bg-white/20 text-white rounded-xl font-medium hover:bg-white/30"
            >
              <Globe className="w-5 h-5 mb-1" />
              Earn
            </Link>
          </div>
        </div>

        <div className="relative mb-6">
          <button
            onClick={() => setShowChains(!showChains)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl"
          >
            <div className="flex items-center space-x-3">
              <Coins className="w-6 h-6 text-gray-400" />
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white">
                  {selectedChain?.name ?? (chains.length === 0 ? 'No chains listed' : 'Select a chain')}
                </p>
                <p className="text-sm text-gray-500">{selectedChain ? `Chain ID ${selectedChain.chainId}` : ''}</p>
              </div>
            </div>
            <ChevronDown className="w-5 h-5 text-gray-500" />
          </button>

          {showChains && chains.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50">
              <div className="p-2 max-h-80 overflow-y-auto">
                {chains.map((chain) => (
                  <button
                    key={chain.chainKey}
                    onClick={() => {
                      setSelectedChainKey(chain.chainKey);
                      setShowChains(false);
                    }}
                    className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    <span className="font-medium text-gray-900 dark:text-white">{chain.name}</span>
                    <span className="text-xs text-gray-500">{chain.chainKey}</span>
                    {chain.chainKey === selectedChainKey && <Check className="w-5 h-5 text-orange-500 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {chainErrors.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <p className="font-medium mb-1">Some chains are unavailable</p>
            {chainErrors.map((chainError) => (
              <p key={chainError.chainKey}>
                {chainError.chainKey}: {chainError.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex space-x-2 mb-4 bg-white dark:bg-gray-800 rounded-xl p-1">
          {[
            { key: 'assets', label: 'Assets', icon: Coins },
            { key: 'activity', label: 'Activity', icon: Receipt },
            { key: 'custody', label: 'Custody', icon: Globe },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'assets' | 'activity' | 'custody')}
              className={`flex-1 flex items-center justify-center py-2 rounded-lg font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'assets' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                <span className="ml-2 text-gray-500">Reading balances from the chain…</span>
              </div>
            ) : error ? (
              <div className="p-4 text-center text-red-500">{error}</div>
            ) : !accessToken ? (
              <div className="p-8 text-center text-gray-500">
                <Wallet className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Sign in to see your balances.</p>
              </div>
            ) : chainAssets.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Coins className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No assets found on {selectedChain?.name ?? 'this chain'}</p>
              </div>
            ) : (
              chainAssets.map((asset) => (
                <div key={`${asset.chainKey}:${asset.symbol}`} className="flex items-center justify-between p-4">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full">
                      {asset.symbol.charAt(0)}
                    </span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{asset.name}</p>
                      <p className="text-sm text-gray-500">
                        {asset.symbol} • {asset.chainName}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {asset.amount} {asset.symbol}
                    </p>
                    <p className="text-sm text-gray-500">
                      {asset.usdValue === null ? '—' : `$${formatNumber(asset.usdValue)}`}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                <span className="ml-2 text-gray-500">Loading activity…</span>
              </div>
            ) : activity.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Receipt className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No transfers found</p>
              </div>
            ) : (
              activity.map((row) => (
                <div key={row.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-10 h-10 flex items-center justify-center rounded-full ${
                        row.direction === 'out'
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                      }`}
                    >
                      {row.direction === 'out' ? (
                        <ArrowUpRight className="w-5 h-5" />
                      ) : (
                        <ArrowDownLeft className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {row.direction === 'out' ? 'Sent' : 'Received'}
                      </p>
                      <p className="text-sm text-gray-500">{row.createdAt}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${row.direction === 'out' ? 'text-red-500' : 'text-green-500'}`}>
                      {row.direction === 'out' ? '-' : '+'}
                      {row.amount} {row.asset}
                    </p>
                    <div className="flex items-center justify-end space-x-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          row.status === 'completed'
                            ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                            : row.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {row.status}
                      </span>
                      {row.txHash && selectedChain?.explorerUrl && (
                        <a
                          href={`${selectedChain.explorerUrl}/tx/${row.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-orange-500"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'custody' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-white">How custody works</p>
            <p>
              Balances on this page are read live from each chain&apos;s node at the address the exchange derived for your
              account. TigerEx holds the keys in its own custody; you never receive a seed phrase and never need to store
              one.
            </p>
            <p>
              To add funds, use Receive to copy the address for a chain, or deposit through the exchange account. To move
              funds out, use Withdraw; every withdrawal is queued for operator approval before it is broadcast.
            </p>
          </div>
        )}

        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-3 flex-shrink-0" />
            <div className="text-sm text-yellow-800 dark:text-yellow-300">
              <p className="font-medium mb-1">Send only the chain&apos;s own assets</p>
              <p>
                Each address belongs to one chain. Sending an asset on a different chain, or to an address for another
                network, may result in permanent loss.
              </p>
            </div>
          </div>
        </div>
      </main>

      {showReceive && selectedChain && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Receive on {selectedChain.name}</h3>
              <button onClick={() => setShowReceive(false)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 text-center mb-4">
              <div className="w-32 h-32 bg-white mx-auto mb-4 flex items-center justify-center">
                <QrCode className="w-24 h-24 text-gray-400" />
              </div>
              <code className="text-sm font-mono break-all">{walletAddress || 'No address issued yet'}</code>
            </div>

            <button
              onClick={copyAddress}
              disabled={!walletAddress}
              className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {copied ? 'Copied!' : 'Copy Address'}
            </button>

            <p className="text-sm text-gray-500 mt-4 text-center">
              Only send assets issued on {selectedChain.name} to this address.
            </p>
          </div>
        </div>
      )}

      {showSend && selectedChain && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Withdraw from {selectedChain.name}</h3>
              <button onClick={() => setShowSend(false)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Destination address
                </label>
                <input
                  type="text"
                  value={sendForm.address}
                  onChange={(event) => setSendForm((form) => ({ ...form, address: event.target.value }))}
                  placeholder="0x…"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={sendForm.amount}
                    onChange={(event) => setSendForm((form) => ({ ...form, amount: event.target.value }))}
                    placeholder="0.00"
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-l-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <select
                    value={sendForm.asset || selectedChain.nativeSymbol}
                    onChange={(event) => setSendForm((form) => ({ ...form, asset: event.target.value }))}
                    className="px-4 py-3 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {selectedChain.tokens.map((token) => (
                      <option key={token.symbol} value={token.symbol}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {sendStatus && (
                <div
                  className={`rounded-lg px-4 py-3 text-sm ${
                    sendStatus.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {sendStatus.text}
                </div>
              )}

              <button
                onClick={submitSend}
                disabled={sendBusy}
                className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {sendBusy ? 'Submitting…' : 'Submit withdrawal'}
              </button>
              <p className="text-xs text-gray-500">
                A withdrawal is queued for operator approval; it is not broadcast until it is approved.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
