'use client';

import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Send, 
  Receive, 
  ArrowLeftRight, 
  Coins, 
  ChevronDown, 
  Copy, 
  ExternalLink, 
  RefreshCw,
  Plus,
  Settings,
  Shield,
  Layers,
  Zap,
  TrendingUp,
  Globe,
  Key,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Search,
  Menu,
  X,
  Activity,
  Hexagon
} from 'lucide-react';

// Supported blockchains
const BLOCKCHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', color: '#627EEA', type: 'evm' },
  { id: 'bsc', name: 'BNB Chain', symbol: 'BNB', color: '#F3BA2F', type: 'evm' },
  { id: 'polygon', name: 'Polygon', symbol: 'MATIC', color: '#8247E5', type: 'evm' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ETH', color: '#28A0F0', type: 'evm' },
  { id: 'optimism', name: 'Optimism', symbol: 'ETH', color: '#FF0420', type: 'evm' },
  { id: 'avalanche', name: 'Avalanche', symbol: 'AVAX', color: '#E84142', type: 'evm' },
  { id: 'base', name: 'Base', symbol: 'ETH', color: '#0052FF', type: 'evm' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', color: '#14F195', type: 'solana' },
  { id: 'tron', name: 'Tron', symbol: 'TRX', color: '#FF0013', type: 'tron' },
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', color: '#F7931A', type: 'bitcoin' },
  { id: 'aptos', name: 'Aptos', symbol: 'APT', color: '#14F195', type: 'aptos' },
  { id: 'ton', name: 'Toncoin', symbol: 'TON', color: '#0098EA', type: 'ton' },
  { id: 'cosmos', name: 'Cosmos', symbol: 'ATOM', color: '#2E3148', type: 'cosmos' },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA', color: '#0033AD', type: 'cardano' },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', color: '#C3A634', type: 'bitcoin' },
  { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', color: '#E6007A', type: 'cosmos' },
  { id: 'near', name: 'NEAR', symbol: 'NEAR', color: '#00C08B', type: 'near' },
  { id: 'pi', name: 'Pi Network', symbol: 'PI', color: '#F3BA2F', type: 'pi' },
  { id: 'pulsechain', name: 'PulseChain', symbol: 'PLS', color: '#7B2BF9', type: 'evm' },
  { id: 'fantom', name: 'Fantom', symbol: 'FTM', color: '#1969FF', type: 'evm' },
];

// Mock token data
const MOCK_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', balance: '1.245', value: 2450.00, chain: 'ethereum' },
  { symbol: 'BTC', name: 'Bitcoin', balance: '0.025', value: 1125.00, chain: 'bitcoin' },
  { symbol: 'USDT', name: 'Tether USD', balance: '5000.00', value: 5000.00, chain: 'ethereum' },
  { symbol: 'USDC', name: 'USD Coin', balance: '2500.00', value: 2500.00, chain: 'ethereum' },
  { symbol: 'BNB', name: 'BNB', balance: '5.5', value: 1650.00, chain: 'bsc' },
  { symbol: 'MATIC', name: 'Polygon', balance: '2500', value: 1875.00, chain: 'polygon' },
  { symbol: 'SOL', name: 'Solana', balance: '25', value: 3000.00, chain: 'solana' },
  { symbol: 'TRX', name: 'Tron', balance: '10000', value: 900.00, chain: 'tron' },
  { symbol: 'DOGE', name: 'Dogecoin', balance: '50000', value: 4500.00, chain: 'dogecoin' },
  { symbol: 'ADA', name: 'Cardano', balance: '5000', value: 2250.00, chain: 'cardano' },
];

interface WalletState {
  isUnlocked: boolean;
  showSeed: boolean;
  activeTab: string;
  selectedChain: string;
  searchQuery: string;
}

export default function WalletPage() {
  const [state, setState] = useState<WalletState>({
    isUnlocked: true,
    showSeed: false,
    activeTab: 'assets',
    selectedChain: 'all',
    searchQuery: '',
  });

  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const totalBalance = MOCK_TOKENS.reduce((sum, token) => sum + token.value, 0);

  const filteredTokens = MOCK_TOKENS.filter(token => {
    const matchesChain = state.selectedChain === 'all' || token.chain === state.selectedChain;
    const matchesSearch = state.searchQuery === '' || 
      token.symbol.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
      token.name.toLowerCase().includes(state.searchQuery.toLowerCase());
    return matchesChain && matchesSearch;
  });

  const getChainColor = (chainId: string) => {
    const chain = BLOCKCHAINS.find(c => c.id === chainId);
    return chain?.color || '#888';
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    alert('Address copied!');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="bg-[#14141A] border-b border-[rgba(255,255,255,0.1)] p-4 sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#FF6B35] to-[#FF8F65] rounded-full flex items-center justify-center">
              <span className="font-bold text-white">T</span>
            </div>
            <div>
              <p className="text-xs text-gray-400">Total Balance</p>
              <p className="text-xl font-bold">${totalBalance.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-[#1E1E24] rounded-lg transition"
            >
              <Settings className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="max-w-md mx-auto p-4">
        <div className="grid grid-cols-4 gap-2">
          <button 
            onClick={() => setShowReceive(true)}
            className="flex flex-col items-center gap-1 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
          >
            <div className="w-10 h-10 bg-[#1E3A5F] rounded-full flex items-center justify-center">
              <Receive className="w-5 h-5 text-[#4A9EEB]" />
            </div>
            <span className="text-xs text-gray-400">Receive</span>
          </button>
          <button 
            onClick={() => setShowSend(true)}
            className="flex flex-col items-center gap-1 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
          >
            <div className="w-10 h-10 bg-[#3D1E5F] rounded-full flex items-center justify-center">
              <Send className="w-5 h-5 text-[#9B51E0]" />
            </div>
            <span className="text-xs text-gray-400">Send</span>
          </button>
          <button 
            onClick={() => setShowSwap(true)}
            className="flex flex-col items-center gap-1 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
          >
            <div className="w-10 h-10 bg-[#1E5F3D] rounded-full flex items-center justify-center">
              <ArrowLeftRight className="w-5 h-5 text-[#4AE39E]" />
            </div>
            <span className="text-xs text-gray-400">Swap</span>
          </button>
          <button className="flex flex-col items-center gap-1 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition">
            <div className="w-10 h-10 bg-[#5F3D1E] rounded-full flex items-center justify-center">
              <Coins className="w-5 h-5 text-[#E39E4A]" />
            </div>
            <span className="text-xs text-gray-400">Buy</span>
          </button>
        </div>
      </div>

      {/* Chain Filter */}
      <div className="max-w-md mx-auto px-4">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setState({ ...state, selectedChain: 'all' })}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
              state.selectedChain === 'all' 
                ? 'bg-[#FF6B35] text-white' 
                : 'bg-[#14141A] text-gray-400 hover:bg-[#1E1E24]'
            }`}
          >
            All Chains
          </button>
          {BLOCKCHAINS.slice(0, 8).map((chain) => (
            <button
              key={chain.id}
              onClick={() => setState({ ...state, selectedChain: chain.id })}
              className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-1 ${
                state.selectedChain === chain.id 
                  ? 'text-white' 
                  : 'bg-[#14141A] text-gray-400 hover:bg-[#1E1E24]'
              }`}
              style={state.selectedChain === chain.id ? { backgroundColor: chain.color } : {}}
            >
              <div 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: chain.color }}
              />
              {chain.symbol}
            </button>
          ))}
          <button className="px-3 py-1.5 bg-[#14141A] rounded-lg text-sm text-gray-400 hover:bg-[#1E1E24]">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-md mx-auto p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search tokens..."
            value={state.searchQuery}
            onChange={(e) => setState({ ...state, searchQuery: e.target.value })}
            className="w-full bg-[#14141A] border border-[rgba(255,255,255,0.1)] rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B35]"
          />
        </div>
      </div>

      {/* Token List */}
      <div className="max-w-md mx-auto px-4 pb-24">
        <div className="space-y-2">
          {filteredTokens.map((token) => (
            <div 
              key={token.symbol}
              className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between hover:bg-[#1E1E24] transition cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: getChainColor(token.chain) }}
                >
                  {token.symbol.slice(0, 2)}
                </div>
                <div>
                  <p className="font-medium">{token.symbol}</p>
                  <p className="text-xs text-gray-500">{token.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium">{token.balance}</p>
                <p className="text-xs text-gray-500">${token.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#14141A] border-t border-[rgba(255,255,255,0.1)] p-4">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button className="flex flex-col items-center gap-1 text-[#FF6B35]">
            <Wallet className="w-6 h-6" />
            <span className="text-xs">Wallet</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition">
            <Globe className="w-6 h-6" />
            <span className="text-xs">Browser</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition">
            <Layers className="w-6 h-6" />
            <span className="text-xs">DeFi</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition">
            <Zap className="w-6 h-6" />
            <span className="text-xs">Activity</span>
          </button>
        </div>
      </div>

      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#14141A] rounded-2xl p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Receive</h3>
              <button onClick={() => setShowReceive(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            <div className="mb-4">
              <label className="text-sm text-gray-400">Select Network</label>
              <select className="w-full bg-[#0A0A0F] border border-[rgba(255,255,255,0.1)] rounded-lg p-3 mt-1">
                {BLOCKCHAINS.map((chain) => (
                  <option key={chain.id} value={chain.id}>{chain.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-[#0A0A0F] rounded-xl p-6 text-center mb-4">
              <div className="w-32 h-32 bg-white mx-auto rounded-lg mb-4 flex items-center justify-center">
                <span className="text-gray-300 text-xs">QR Code</span>
              </div>
              <p className="text-xs text-gray-400 break-all font-mono">
                0x1234...5678
              </p>
              <button 
                onClick={() => copyAddress('0x1234567890abcdef')}
                className="mt-2 text-[#FF6B35] text-sm flex items-center justify-center gap-1"
              >
                <Copy className="w-4 h-4" /> Copy Address
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {showSend && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#14141A] rounded-2xl p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Send</h3>
              <button onClick={() => setShowSend(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">Asset</label>
                <div className="flex items-center gap-2 bg-[#0A0A0F] border border-[rgba(255,255,255,0.1)] rounded-lg p-3 mt-1">
                  <div className="w-8 h-8 bg-[#627EEA] rounded-full flex items-center justify-center text-xs font-bold">ETH</div>
                  <span>Ethereum</span>
                  <ChevronDown className="w-4 h-4 ml-auto text-gray-400" />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-400">Recipient Address</label>
                <input 
                  type="text"
                  placeholder="Enter address or ENS"
                  className="w-full bg-[#0A0A0F] border border-[rgba(255,255,255,0.1)] rounded-lg p-3 mt-1 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400">Amount</label>
                <div className="flex items-center gap-2 bg-[#0A0A0F] border border-[rgba(255,255,255,0.1)] rounded-lg p-3 mt-1">
                  <input 
                    type="number"
                    placeholder="0.00"
                    className="flex-1 bg-transparent text-white outline-none"
                  />
                  <span className="text-gray-400">ETH</span>
                  <button className="text-[#FF6B35] text-sm">MAX</button>
                </div>
              </div>

              <div className="flex justify-between text-sm text-gray-400">
                <span>Network Fee</span>
                <span>~$2.50</span>
              </div>

              <button className="w-full bg-[#FF6B35] hover:bg-[#FF8F65] rounded-lg py-3 font-medium transition">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap Modal */}
      {showSwap && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#14141A] rounded-2xl p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Swap</h3>
              <button onClick={() => setShowSwap(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="bg-[#0A0A0F] rounded-xl p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400">From</span>
                <span className="text-gray-400">Balance: 1.245 ETH</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  placeholder="0"
                  className="text-2xl font-bold bg-transparent outline-none w-full"
                />
                <div className="flex items-center gap-1 bg-[#1E1E24] px-2 py-1 rounded-lg">
                  <div className="w-5 h-5 bg-[#627EEA] rounded-full" />
                  <span>ETH</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center -my-2 relative z-10">
              <div className="w-8 h-8 bg-[#FF6B35] rounded-full flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#0A0A0F] rounded-xl p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400">To</span>
                <span className="text-gray-400">~ $0.00</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  placeholder="0"
                  className="text-2xl font-bold bg-transparent outline-none w-full"
                />
                <div className="flex items-center gap-1 bg-[#1E1E24] px-2 py-1 rounded-lg">
                  <div className="w-5 h-5 bg-[#26A17B] rounded-full" />
                  <span>USDT</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between text-sm text-gray-400 mb-4">
              <span>Rate</span>
              <span>1 ETH = 2,450 USDT</span>
            </div>

            <div className="flex justify-between text-sm text-gray-400 mb-4">
              <span>Fee</span>
              <span>~$3.50</span>
            </div>

            <button className="w-full bg-[#FF6B35] hover:bg-[#FF8F65] rounded-lg py-3 font-medium transition">
              Swap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
