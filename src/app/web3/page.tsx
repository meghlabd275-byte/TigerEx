"use client";

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Swap, 
  Copy, 
  Check, 
  Eye, 
  EyeOff,
  QrCode,
  Settings,
  Plus,
  RefreshCw,
  ExternalLink,
  Search,
  Filter,
  ChevronDown,
  Zap,
  Shield,
  Key,
  Browser,
  Link as LinkIcon,
  Coins,
  Send,
  Receipt,
  Gift,
  Star,
  AlertTriangle
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Supported networks
interface Network {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  type: 'EVM' | 'non-EVM';
}

const networks: Network[] = [
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', icon: 'Ξ', type: 'EVM' },
  { id: 'bsc', name: 'BNB Smart Chain', symbol: 'BNB', icon: '⬡', type: 'EVM' },
  { id: 'polygon', name: 'Polygon', symbol: 'MATIC', icon: '⬟', type: 'EVM' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ETH', icon: '🔴', type: 'EVM' },
  { id: 'optimism', name: 'Optimism', symbol: 'ETH', icon: '🔵', type: 'EVM' },
  { id: 'avax', name: 'Avalanche', symbol: 'AVAX', icon: '🔺', type: 'EVM' },
  { id: 'sol', name: 'Solana', symbol: 'SOL', icon: '◎', type: 'non-EVM' },
  { id: 'ton', name: 'Toncoin', symbol: 'TON', icon: '🟢', type: 'non-EVM' },
  { id: 'tron', name: 'TRON', symbol: 'TRX', icon: '⭕', type: 'non-EVM' },
];

// Token
interface Token {
  id: string;
  name: string;
  symbol: string;
  balance: number;
  usdValue: number;
  network: string;
  icon: string;
  isNative: boolean;
}

// Demo tokens
const demoTokens: Token[] = [
  { id: '1', name: 'Ethereum', symbol: 'ETH', balance: 2.5432, usdValue: 8792.45, network: 'Ethereum', icon: 'Ξ', isNative: true },
  { id: '2', name: 'Tether', symbol: 'USDT', balance: 5432.10, usdValue: 5432.10, network: 'Ethereum', icon: '$', isNative: false },
  { id: '3', name: 'BNB', symbol: 'BNB', balance: 12.5, usdValue: 7250.00, network: 'BNB Smart Chain', icon: '⬡', isNative: true },
  { id: '4', name: 'Solana', symbol: 'SOL', balance: 85.3, usdValue: 8398.54, network: 'Solana', icon: '◎', isNative: true },
  { id: '5', name: 'Wrapped Bitcoin', symbol: 'WBTC', balance: 0.15, usdValue: 10087.50, network: 'Ethereum', icon: '₿', isNative: false },
];

// Transaction
interface Transaction {
  id: string;
  type: 'send' | 'receive' | 'swap' | 'approve';
  token: string;
  amount: number;
  usdValue: number;
  status: 'pending' | 'completed' | 'failed';
  date: string;
  hash: string;
}

const demoTransactions: Transaction[] = [
  { id: '1', type: 'receive', token: 'ETH', amount: 1.5, usdValue: 5182.50, status: 'completed', date: '2026-07-15 14:30', hash: '0x1234...5678' },
  { id: '2', type: 'send', token: 'USDT', amount: 1000, usdValue: 1000, status: 'completed', date: '2026-07-14 09:15', hash: '0xabcd...efgh' },
  { id: '3', type: 'swap', token: 'ETH→USDT', amount: 0.5, usdValue: 1727.50, status: 'completed', date: '2026-07-13 18:45', hash: '0x9876...5432' },
  { id: '4', type: 'receive', token: 'SOL', amount: 25, usdValue: 2462.50, status: 'pending', date: '2026-07-17 10:00', hash: '0xdef0...1234' },
];

export default function Web3WalletPage() {
  // State
  const [showBalance, setShowBalance] = useState(true);
  const [copied, setCopied] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<Network>(networks[0]);
  const [showNetworks, setShowNetworks] = useState(false);
  const [activeTab, setActiveTab] = useState<'assets' | 'activity' | 'dapps'>('assets');
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);
  
  // Demo wallet address
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f4B2E1';

  // Copy address
  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [walletAddress]);

  // Total balance
  const totalBalance = demoTokens.reduce((sum, t) => sum + t.usdValue, 0);

  // Format number
  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Format address
  const formatAddress = (addr: string): string => {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
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
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Wallet Card */}
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Wallet className="w-6 h-6" />
              <span className="font-medium">Main Wallet</span>
            </div>
            <button className="p-2 bg-white/20 rounded-lg hover:bg-white/30">
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {/* Balance */}
          <div className="mb-4">
            <p className="text-white/70 text-sm mb-1">Total Balance</p>
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

          {/* Address */}
          <div className="bg-white/10 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <code className="text-sm font-mono">{formatAddress(walletAddress)}</code>
              <button onClick={copyAddress} className="p-1 hover:bg-white/20 rounded">
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

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <button 
              onClick={() => setShowSend(true)}
              className="flex flex-col items-center justify-center py-3 bg-white text-indigo-600 rounded-xl font-medium hover:bg-white/90"
            >
              <Send className="w-5 h-5 mb-1" />
              Send
            </button>
            <button className="flex flex-col items-center justify-center py-3 bg-white/20 text-white rounded-xl font-medium hover:bg-white/30">
              <Swap className="w-5 h-5 mb-1" />
              Swap
            </button>
            <button className="flex flex-col items-center justify-center py-3 bg-white/20 text-white rounded-xl font-medium hover:bg-white/30">
              <Browser className="w-5 h-5 mb-1" />
              DApps
            </button>
          </div>
        </div>

        {/* Network Selector */}
        <div className="relative mb-6">
          <button
            onClick={() => setShowNetworks(!showNetworks)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl"
          >
            <div className="flex items-center space-x-3">
              <span className="text-2xl">{selectedNetwork.icon}</span>
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white">{selectedNetwork.name}</p>
                <p className="text-sm text-gray-500">{selectedNetwork.type}</p>
              </div>
            </div>
            <ChevronDown className="w-5 h-5 text-gray-500" />
          </button>

          {showNetworks && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50">
              <div className="p-2">
                <p className="px-3 py-2 text-sm text-gray-500 font-medium">EVM Chains</p>
                {networks.filter(n => n.type === 'EVM').map(network => (
                  <button
                    key={network.id}
                    onClick={() => {
                      setSelectedNetwork(network);
                      setShowNetworks(false);
                    }}
                    className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    <span className="text-2xl">{network.icon}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{network.name}</span>
                    {network.id === selectedNetwork.id && <Check className="w-5 h-5 text-orange-500 ml-auto" />}
                  </button>
                ))}
                <p className="px-3 py-2 text-sm text-gray-500 font-medium mt-2">Non-EVM Chains</p>
                {networks.filter(n => n.type === 'non-EVM').map(network => (
                  <button
                    key={network.id}
                    onClick={() => {
                      setSelectedNetwork(network);
                      setShowNetworks(false);
                    }}
                    className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    <span className="text-2xl">{network.icon}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{network.name}</span>
                    {network.id === selectedNetwork.id && <Check className="w-5 h-5 text-orange-500 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 mb-4 bg-white dark:bg-gray-800 rounded-xl p-1">
          {[
            { key: 'assets', label: 'Assets', icon: Coins },
            { key: 'activity', label: 'Activity', icon: Receipt },
            { key: 'dapps', label: 'DApps', icon: Browser },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
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

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {demoTokens.map(token => (
              <div key={token.id} className="flex items-center justify-between p-4">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full">
                    {token.icon}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{token.name}</p>
                    <p className="text-sm text-gray-500">{token.symbol} • {token.network}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900 dark:text-white">{formatNumber(token.balance)} {token.symbol}</p>
                  <p className="text-sm text-gray-500">${formatNumber(token.usdValue)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {demoTransactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between p-4">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 flex items-center justify-center rounded-full ${
                    tx.type === 'send' ? 'bg-red-100 text-red-600' :
                    tx.type === 'receive' ? 'bg-green-100 text-green-600' :
                    tx.type === 'swap' ? 'bg-purple-100 text-purple-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    {tx.type === 'send' ? <ArrowUpRight className="w-5 h-5" /> :
                     tx.type === 'receive' ? <ArrowDownLeft className="w-5 h-5" /> :
                     tx.type === 'swap' ? <Swap className="w-5 h-5" /> :
                     <Check className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {tx.type === 'send' ? 'Sent' : 
                       tx.type === 'receive' ? 'Received' : 
                       tx.type === 'swap' ? 'Swapped' : 'Approved'}
                    </p>
                    <p className="text-sm text-gray-500">{tx.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${
                    tx.type === 'send' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {tx.type === 'send' ? '-' : '+'}{tx.amount} {tx.token}
                  </p>
                  <div className="flex items-center justify-end space-x-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      tx.status === 'completed' ? 'bg-green-100 text-green-600' :
                      tx.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {tx.status}
                    </span>
                    <a href="#" className="text-gray-400 hover:text-orange-500">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DApps Tab */}
        {activeTab === 'dapps' && (
          <div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { name: 'Uniswap', icon: '🦄', category: 'DEX' },
                { name: 'Aave', icon: '👻', category: 'Lending' },
                { name: 'OpenSea', icon: '🌊', category: 'NFT' },
                { name: 'Compound', icon: '🔷', category: 'Lending' },
                { name: '1inch', icon: '⚡', category: 'Aggregator' },
                { name: 'Curve', icon: '💎', category: 'DEX' },
                { name: 'Yearn', icon: '🦄', category: 'Yield' },
                { name: 'Lens', icon: '📸', category: 'Social' },
              ].map((dapp, i) => (
                <button key={i} className="flex flex-col items-center p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-orange-500 transition-all">
                  <span className="text-3xl mb-2">{dapp.icon}</span>
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{dapp.name}</span>
                  <span className="text-xs text-gray-500">{dapp.category}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Warning */}
        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-3 flex-shrink-0" />
            <div className="text-sm text-yellow-800 dark:text-yellow-300">
              <p className="font-medium mb-1">Security Notice</p>
              <p>Never share your seed phrase. TigerEx will never ask for your private keys or seed phrase. All transactions require your explicit confirmation.</p>
            </div>
          </div>
        </div>

        {/* Seed Phrase Warning */}
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div className="flex items-center">
            <Key className="w-5 h-5 text-red-600 dark:text-red-400 mr-3" />
            <div>
              <p className="font-medium text-red-600 dark:text-red-400">Backup Your Seed Phrase</p>
              <p className="text-sm text-red-500 dark:text-red-400">Your wallet is generated from a 24-word seed phrase. Write it down and store it safely.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Receive {selectedNetwork.symbol}</h3>
              <button onClick={() => setShowReceive(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            
            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 text-center mb-4">
              <div className="w-32 h-32 bg-white mx-auto mb-4 flex items-center justify-center">
                <QrCode className="w-24 h-24 text-gray-400" />
              </div>
              <code className="text-sm font-mono break-all">{walletAddress}</code>
            </div>

            <button 
              onClick={copyAddress}
              className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600"
            >
              {copied ? 'Copied!' : 'Copy Address'}
            </button>

            <p className="text-sm text-gray-500 mt-4 text-center">
              Only send {selectedNetwork.symbol} to this address. Sending other tokens may result in permanent loss.
            </p>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {showSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Send</h3>
              <button onClick={() => setShowSend(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipient Address</label>
                <input 
                  type="text" 
                  placeholder="0x..."
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
                <div className="flex items-center">
                  <input 
                    type="number" 
                    placeholder="0.00"
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-l-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <select className="px-4 py-3 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white">
                    <option>ETH</option>
                    <option>USDT</option>
                    <option>BNB</option>
                  </select>
                </div>
              </div>

              <button className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600">
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
