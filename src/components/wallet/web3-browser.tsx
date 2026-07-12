'use client';

import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Search, 
  Star, 
  History, 
  TrendingUp, 
  ExternalLink,
  X,
  Plus,
  Minus,
  RefreshCw,
  Home,
  ArrowLeft,
  MoreVertical,
  Share2,
  Bookmark,
  BookmarkCheck,
  Clock,
  Zap,
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';

// Popular dApps
const POPULAR_DAPPS = [
  { id: 'uniswap', name: 'Uniswap', category: 'DEX', url: 'https://app.uniswap.org', icon: '🦄', description: 'Decentralized Trading' },
  { id: 'pancakeswap', name: 'PancakeSwap', category: 'DEX', url: 'https://pancakeswap.finance', icon: '🥞', description: 'AMM DEX' },
  { id: 'opensea', name: 'OpenSea', category: 'NFT', url: 'https://opensea.io', icon: '🌊', description: 'NFT Marketplace' },
  { id: 'aave', name: 'Aave', category: 'Lending', url: 'https://app.aave.com', icon: '👻', description: 'Lending Protocol' },
  { id: 'compound', name: 'Compound', category: 'Lending', url: 'https://app.compound.finance', icon: '🏦', description: 'Lending Market' },
  { id: 'curve', name: 'Curve', category: 'DEX', url: 'https://curve.fi', icon: '📈', description: 'Stablecoin DEX' },
  { id: '1inch', name: '1inch', category: 'Aggregator', url: 'https://app.1inch.io', icon: '🥇', description: 'DEX Aggregator' },
  { id: 'sushiswap', name: 'SushiSwap', category: 'DEX', url: 'https://sushi.com', icon: '🍣', description: 'AMM DEX' },
  { id: 'lido', name: 'Lido', category: 'Staking', url: 'https://lido.fi', icon: '💧', description: 'Liquid Staking' },
  { id: 'rocketpool', name: 'Rocket Pool', category: 'Staking', url: 'https://rocketpool.net', icon: '🚀', description: 'ETH Staking' },
  { id: 'yearn', name: 'Yearn', category: 'Yield', url: 'https://yearn.finance', icon: '📊', description: 'Yield Aggregator' },
  { id: 'balancer', name: 'Balancer', category: 'DEX', url: 'https://balancer.fi', icon: '⚖️', description: 'AMM DEX' },
];

// Categories
const CATEGORIES = [
  { id: 'all', name: 'All', icon: <Globe className="w-4 h-4" /> },
  { id: 'dex', name: 'DEX', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'nft', name: 'NFT', icon: <Star className="w-4 h-4" /> },
  { id: 'lending', name: 'Lending', icon: <Shield className="w-4 h-4" /> },
  { id: 'staking', name: 'Staking', icon: <Zap className="w-4 h-4" /> },
  { id: 'yield', name: 'Yield', icon: <TrendingUp className="w-4 h-4" /> },
];

interface BrowserHistory {
  id: string;
  title: string;
  url: string;
  timestamp: number;
}

interface BookmarkedDApp {
  id: string;
  addedAt: number;
}

export default function Web3Browser() {
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'dapps'>('home');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showUrlBar, setShowUrlBar] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [history, setHistory] = useState<BrowserHistory[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkedDApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('tigerex_browser_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
    const savedBookmarks = localStorage.getItem('tigerex_browser_bookmarks');
    if (savedBookmarks) {
      setBookmarks(JSON.parse(savedBookmarks));
    }
  }, []);

  // Save history to localStorage
  const addToHistory = (title: string, url: string) => {
    const newHistory = [
      { id: Date.now().toString(), title, url, timestamp: Date.now() },
      ...history.filter(h => h.url !== url).slice(0, 49)
    ];
    setHistory(newHistory);
    localStorage.setItem('tigerex_browser_history', JSON.stringify(newHistory));
  };

  // Toggle bookmark
  const toggleBookmark = (dappId: string) => {
    let newBookmarks;
    if (bookmarks.find(b => b.id === dappId)) {
      newBookmarks = bookmarks.filter(b => b.id !== dappId);
    } else {
      newBookmarks = [...bookmarks, { id: dappId, addedAt: Date.now() }];
    }
    setBookmarks(newBookmarks);
    localStorage.setItem('tigerex_browser_bookmarks', JSON.stringify(newBookmarks));
  };

  // Open URL
  const openUrl = (url: string) => {
    setIsLoading(true);
    setUrl(url);
    // Simulate loading
    setTimeout(() => {
      setIsLoading(false);
      addToHistory(url, url);
      setActiveTab('home');
    }, 1500);
  };

  // Filtered dApps
  const filteredDApps = POPULAR_DAPPS.filter(dapp => {
    const matchesCategory = selectedCategory === 'all' || 
      dapp.category.toLowerCase() === selectedCategory;
    const matchesSearch = searchQuery === '' ||
      dapp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dapp.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Recent history (last 5)
  const recentHistory = history.slice(0, 5);

  return (
    <div className="h-full flex flex-col bg-[#0A0A0F]">
      {/* URL Bar */}
      <div className="bg-[#14141A] p-3 border-b border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-2 bg-[#0A0A0F] rounded-xl px-3 py-2">
          {activeTab === 'search' ? (
            <Search className="w-4 h-4 text-gray-500" />
          ) : (
            <button onClick={() => setActiveTab('home')}>
              <Home className="w-4 h-4 text-gray-500" />
            </button>
          )}
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={() => setActiveTab('search')}
            placeholder="Search or enter URL"
            className="flex-1 bg-transparent text-white text-sm outline-none"
          />
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-[#FF6B35] animate-spin" />
          ) : url && (
            <button onClick={() => openUrl(url.startsWith('http') ? url : `https://${url}`)}>
              <ArrowRight className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'home' && (
          <>
            {/* Quick Access */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400">Quick Access</h3>
                <button 
                  onClick={() => setActiveTab('dapps')}
                  className="text-xs text-[#FF6B35] hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {POPULAR_DAPPS.slice(0, 8).map((dapp) => (
                  <button
                    key={dapp.id}
                    onClick={() => openUrl(dapp.url)}
                    className="flex flex-col items-center gap-1 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
                  >
                    <span className="text-2xl">{dapp.icon}</span>
                    <span className="text-xs text-gray-400 truncate w-full">{dapp.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bookmarks */}
            {bookmarks.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Bookmarks</h3>
                <div className="grid grid-cols-2 gap-2">
                  {bookmarks.slice(0, 4).map((bookmark) => {
                    const dapp = POPULAR_DAPPS.find(d => d.id === bookmark.id);
                    if (!dapp) return null;
                    return (
                      <button
                        key={dapp.id}
                        onClick={() => openUrl(dapp.url)}
                        className="flex items-center gap-2 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
                      >
                        <span className="text-xl">{dapp.icon}</span>
                        <span className="text-sm text-white truncate">{dapp.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent */}
            {recentHistory.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-medium text-gray-400">Recent</h3>
                </div>
                <div className="space-y-1">
                  {recentHistory.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openUrl(item.url)}
                      className="w-full flex items-center justify-between p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
                    >
                      <span className="text-sm text-white truncate">{item.title}</span>
                      <ExternalLink className="w-4 h-4 text-gray-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'dapps' && (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dApps..."
                className="w-full bg-[#14141A] border border-[rgba(255,255,255,0.1)] rounded-xl py-2.5 pl-9 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B35]"
              />
            </div>

            {/* Categories */}
            <div className="flex gap-2 overflow-x-auto pb-4 mb-4">
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
                    selectedCategory === category.id 
                      ? 'bg-[#FF6B35] text-white' 
                      : 'bg-[#14141A] text-gray-400 hover:bg-[#1E1E24]'
                  }`}
                >
                  {category.icon}
                  {category.name}
                </button>
              ))}
            </div>

            {/* dApps Grid */}
            <div className="grid grid-cols-2 gap-3">
              {filteredDApps.map((dapp) => (
                <div
                  key={dapp.id}
                  className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{dapp.icon}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBookmark(dapp.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition"
                    >
                      {bookmarks.find(b => b.id === dapp.id) ? (
                        <BookmarkCheck className="w-4 h-4 text-[#FF6B35]" />
                      ) : (
                        <Bookmark className="w-4 h-4 text-gray-500" />
                      )}
                    </button>
                  </div>
                  <h4 className="font-medium text-white mb-1">{dapp.name}</h4>
                  <p className="text-xs text-gray-500 mb-2">{dapp.description}</p>
                  <button
                    onClick={() => openUrl(dapp.url)}
                    className="text-xs text-[#FF6B35] hover:underline"
                  >
                    Open →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'search' && (
          <div className="space-y-4">
            {searchQuery && (
              <div>
                <p className="text-sm text-gray-400 mb-2">Search Results</p>
                <button
                  onClick={() => openUrl(`https://www.google.com/search?q=${searchQuery}`)}
                  className="w-full flex items-center gap-3 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition"
                >
                  <Search className="w-5 h-5 text-gray-500" />
                  <span className="text-white">Search: {searchQuery}</span>
                </button>
              </div>
            )}

            {/* Suggested dApps */}
            {!searchQuery && (
              <div>
                <p className="text-sm text-gray-400 mb-2">Popular Searches</p>
                {POPULAR_DAPPS.slice(0, 6).map((dapp) => (
                  <button
                    key={dapp.id}
                    onClick={() => openUrl(dapp.url)}
                    className="w-full flex items-center gap-3 p-3 bg-[#14141A] rounded-xl hover:bg-[#1E1E24] transition mb-2"
                  >
                    <span className="text-xl">{dapp.icon}</span>
                    <div className="text-left">
                      <p className="text-sm text-white">{dapp.name}</p>
                      <p className="text-xs text-gray-500">{dapp.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Security Notice */}
      <div className="p-3 border-t border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Shield className="w-4 h-4" />
          <span>Web3 Browser - Verify URLs before connecting wallet</span>
        </div>
      </div>
    </div>
  );
}
