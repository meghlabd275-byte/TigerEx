'use client';

import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Send, 
  Receive, 
  ArrowLeftRight, 
  History, 
  Settings,
  ChevronRight,
  Copy,
  ExternalLink,
  AlertTriangle,
  Check,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Lock,
  Unlock,
  Key,
  QrCode,
  Download,
  Upload,
  X,
  AlertCircle,
  Info,
  Zap,
  Layers,
  Globe,
  TrendingUp,
  DollarSign,
  CreditCard,
  Gift,
  Coins,
  Box,
  Network
} from 'lucide-react';

// Token icons (simplified - would use actual icons in production)
const TOKEN_ICONS: Record<string, string> = {
  ETH: '🔷',
  BTC: '₿',
  USDT: '₮',
  USDC: '$',
  BNB: '⬡',
  MATIC: '⬟',
  SOL: '☀️',
  TRX: '⚡',
  DOGE: 'Ð',
  ADA: '₳',
  XRP: '✕',
  DOT: '●',
  AVAX: '▲',
  LINK: '⬡',
  UNI: '🦄',
  ATOM: '⚛️',
};

// Supported networks
const NETWORKS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', color: '#627EEA', type: 'EVM' },
  { id: 'bsc', name: 'BNB Chain', symbol: 'BNB', color: '#F3BA2F', type: 'EVM' },
  { id: 'polygon', name: 'Polygon', symbol: 'MATIC', color: '#8247E5', type: 'EVM' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ETH', color: '#28A0F0', type: 'EVM' },
  { id: 'optimism', name: 'Optimism', symbol: 'ETH', color: '#FF0420', type: 'EVM' },
  { id: 'avalanche', name: 'Avalanche', symbol: 'AVAX', color: '#E84142', type: 'EVM' },
  { id: 'base', name: 'Base', symbol: 'ETH', color: '#0052FF', type: 'EVM' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', color: '#14F195', type: 'SOL' },
  { id: 'tron', name: 'Tron', symbol: 'TRX', color: '#FF0013', type: 'TRON' },
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', color: '#F7931A', type: 'BTC' },
  { id: 'aptos', name: 'Aptos', symbol: 'APT', color: '#14F195', type: 'APTOS' },
  { id: 'ton', name: 'Toncoin', symbol: 'TON', color: '#0098EA', type: 'TON' },
];

// Token balances (mock data)
const MOCK_BALANCES = [
  { network: 'ethereum', symbol: 'ETH', name: 'Ethereum', balance: '1.245', value: 2450.00, decimals: 18 },
  { network: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', balance: '0.025', value: 1125.00, decimals: 8 },
  { network: 'ethereum', symbol: 'USDT', name: 'Tether USD', balance: '5000.00', value: 5000.00, decimals: 6 },
  { network: 'ethereum', symbol: 'USDC', name: 'USD Coin', balance: '2500.00', value: 2500.00, decimals: 6 },
  { network: 'bsc', symbol: 'BNB', name: 'BNB', balance: '5.5', value: 1650.00, decimals: 18 },
  { network: 'polygon', symbol: 'MATIC', name: 'Polygon', balance: '2500', value: 1875.00, decimals: 18 },
  { network: 'solana', symbol: 'SOL', name: 'Solana', balance: '25', value: 3000.00, decimals: 9 },
  { network: 'tron', symbol: 'TRX', name: 'Tron', balance: '10000', value: 900.00, decimals: 6 },
  { network: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', balance: '50000', value: 4500.00, decimals: 8 },
  { network: 'cardano', symbol: 'ADA', name: 'Cardano', balance: '5000', value: 2250.00, decimals: 6 },
];

interface WalletComponentProps {
  // Props interface
}

export function WalletHeader() {
  const [showBalance, setShowBalance] = useState(true);
  
  const totalBalance = MOCK_BALANCES.reduce((sum, t) => sum + t.value, 0);

  return (
    <div className="bg-gradient-to-r from-[#1a1a2e] to-[#16213e] p-6 rounded-2xl mb-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-gray-400 text-sm mb-1">Total Balance</p>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold text-white">
              {showBalance ? `$${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '******'}
            </h2>
            <button 
              onClick={() => setShowBalance(!showBalance)}
              className="p-1.5 hover:bg-white/10 rounded-lg transition"
            >
              {showBalance ? <Eye className="w-4 h-4 text-gray-400" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition">
            <Settings className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-2">
        <button className="flex flex-col items-center gap-1 p-3 bg-[#1e3a5f] rounded-xl hover:bg-[#2a4a70] transition">
          <Receive className="w-5 h-5 text-[#4A9EEB]" />
          <span className="text-xs text-gray-300">Receive</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-3 bg-[#3d1e5f] rounded-xl hover:bg-[#4a2870] transition">
          <Send className="w-5 h-5 text-[#9B51E0]" />
          <span className="text-xs text-gray-300">Send</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-3 bg-[#1e5f3d] rounded-xl hover:bg-[#2a704a] transition">
          <ArrowLeftRight className="w-5 h-5 text-[#4AE39E]" />
          <span className="text-xs text-gray-300">Swap</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-3 bg-[#5f3d1e] rounded-xl hover:bg-[#704a2a] transition">
          <CreditCard className="w-5 h-5 text-[#E39E4A]" />
          <span className="text-xs text-gray-300">Buy</span>
        </button>
      </div>
    </div>
  );
}

export function NetworkSelector() {
  const [selectedNetwork, setSelectedNetwork] = useState('all');
  const [showNetworks, setShowNetworks] = useState(false);

  return (
    <div className="mb-4">
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <button
          onClick={() => setSelectedNetwork('all')}
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
            selectedNetwork === 'all' 
              ? 'bg-[#FF6B35] text-white' 
              : 'bg-[#1a1a2e] text-gray-400 hover:bg-[#2a2a3e]'
          }`}
        >
          All Networks
        </button>
        {NETWORKS.map((network) => (
          <button
            key={network.id}
            onClick={() => setSelectedNetwork(network.id)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-1.5 ${
              selectedNetwork === network.id 
                ? 'text-white' 
                : 'bg-[#1a1a2e] text-gray-400 hover:bg-[#2a2a3e]'
            }`}
            style={selectedNetwork === network.id ? { backgroundColor: network.color } : {}}
          >
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: network.color }} />
            {network.symbol}
          </button>
        ))}
        <button className="px-3 py-1.5 bg-[#1a1a2e] rounded-lg text-sm text-gray-400 hover:bg-[#2a2a3e]">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function TokenList() {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'value' | 'name'>('value');

  const filteredTokens = MOCK_BALANCES
    .filter(token => 
      searchQuery === '' || 
      token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => sortBy === 'value' ? b.value - a.value : a.symbol.localeCompare(b.symbol));

  return (
    <div>
      {/* Search and Filter */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1a2e] border border-[rgba(255,255,255,0.1)] rounded-xl py-2.5 pl-9 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B35]"
          />
        </div>
        <button className="p-2.5 bg-[#1a1a2e] border border-[rgba(255,255,255,0.1)] rounded-xl hover:bg-[#2a2a3e] transition">
          <Filter className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Token List */}
      <div className="space-y-2">
        {filteredTokens.map((token) => (
          <div 
            key={`${token.network}-${token.symbol}`}
            className="bg-[#1a1a2e] rounded-xl p-4 flex items-center justify-between hover:bg-[#2a2a3e] transition cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: NETWORKS.find(n => n.id === token.network)?.color || '#666' }}
              >
                {TOKEN_ICONS[token.symbol] || token.symbol.slice(0, 2)}
              </div>
              <div>
                <p className="font-medium text-white">{token.symbol}</p>
                <p className="text-xs text-gray-500">{token.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-medium text-white">{token.balance}</p>
                <p className="text-xs text-gray-500">${token.value.toLocaleString()}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TransactionHistory() {
  const [transactions, setTransactions] = useState([
    { id: '1', type: 'receive', symbol: 'ETH', amount: '0.5', from: '0x1234...5678', status: 'completed', date: '2024-01-15' },
    { id: '2', type: 'send', symbol: 'USDT', amount: '100', to: '0xabcd...efgh', status: 'completed', date: '2024-01-14' },
    { id: '3', type: 'swap', fromSymbol: 'ETH', toSymbol: 'USDT', amount: '0.1', status: 'completed', date: '2024-01-13' },
    { id: '4', type: 'receive', symbol: 'BTC', amount: '0.01', from: 'bc1q...xyz', status: 'pending', date: '2024-01-12' },
  ]);

  return (
    <div className="bg-[#1a1a2e] rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-white">Recent Transactions</h3>
        <button className="text-[#FF6B35] text-sm hover:underline">View All</button>
      </div>
      
      <div className="space-y-3">
        {transactions.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between py-2 border-b border-[rgba(255,255,255,0.05)] last:border-0">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                tx.type === 'receive' ? 'bg-[#1e5f3d]' : 
                tx.type === 'send' ? 'bg-[#3d1e5f]' : 'bg-[#5f3d1e]'
              }`}>
                {tx.type === 'receive' ? <Receive className="w-4 h-4 text-[#4AE39E]" /> :
                 tx.type === 'send' ? <Send className="w-4 h-4 text-[#9B51E0]" /> :
                 <ArrowLeftRight className="w-4 h-4 text-[#E39E4A]" />}
              </div>
              <div>
                <p className="text-sm font-medium text-white capitalize">{tx.type}</p>
                <p className="text-xs text-gray-500">{tx.date}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-white">
                {tx.type === 'receive' ? '+' : '-'}{tx.amount} {tx.symbol}
              </p>
              <p className={`text-xs ${tx.status === 'completed' ? 'text-green-500' : 'text-yellow-500'}`}>
                {tx.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuickActions() {
  const actions = [
    { icon: <Globe className="w-5 h-5" />, label: 'Browser', color: '#4A9EEB' },
    { icon: <Layers className="w-5 h-5" />, label: 'DeFi', color: '#9B51E0' },
    { icon: <TrendingUp className="w-5 h-5" />, label: 'Trade', color: '#4AE39E' },
    { icon: <DollarSign className="w-5 h-5" />, label: 'Earn', color: '#E39E4A' },
    { icon: <Gift className="w-5 h-5" />, label: 'Rewards', color: '#FF6B35' },
    { icon: <Box className="w-5 h-5" />, label: 'NFTs', color: '#F7931A' },
  ];

  return (
    <div className="grid grid-cols-6 gap-2 mt-6">
      {actions.map((action, index) => (
        <button 
          key={index}
          className="flex flex-col items-center gap-1 p-3 bg-[#1a1a2e] rounded-xl hover:bg-[#2a2a3e] transition"
        >
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${action.color}20` }}
          >
            <span style={{ color: action.color }}>{action.icon}</span>
          </div>
          <span className="text-xs text-gray-400">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

export function WalletAddress() {
  const [address, setAddress] = useState('0x742d35Cc6634C0532925a3b844Bc9e7595f...');
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#1a1a2e] rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-2">Wallet Address</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400" />
          <span className="font-mono text-sm text-white">{address}</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={copyAddress}
            className="p-1.5 hover:bg-white/10 rounded-lg transition"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-400" />}
          </button>
          <button className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <QrCode className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <ExternalLink className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function SecurityAlert() {
  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-yellow-500">Security Notice</p>
        <p className="text-xs text-gray-400 mt-1">
          Never share your seed phrase with anyone. TigerEx will never ask for your private keys or seed phrase.
        </p>
      </div>
    </div>
  );
}

export function WalletBackup() {
  return (
    <div className="bg-[#1a1a2e] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-[#FF6B35]" />
          <span className="font-medium text-white">Backup Phrase</span>
        </div>
        <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">Important</span>
      </div>
      <p className="text-sm text-gray-400 mb-3">
        Your 24-word recovery phrase is the only way to restore your wallet. Write it down and store it safely.
      </p>
      <div className="flex gap-2">
        <button className="flex-1 flex items-center justify-center gap-2 bg-[#FF6B35] hover:bg-[#ff8f65] text-white py-2 rounded-lg text-sm transition">
          <Download className="w-4 h-4" />
          Export
        </button>
        <button className="flex-1 flex items-center justify-center gap-2 bg-[#2a2a3e] hover:bg-[#3a3a4e] text-white py-2 rounded-lg text-sm transition">
          <Upload className="w-4 h-4" />
          Import
        </button>
      </div>
    </div>
  );
}
