"use client";

import { useState } from 'react';
import Link from 'next/link';
import { 
  Wallet, 
  TrendingUp, 
  Lock, 
  Clock, 
  Gift, 
  Coins, 
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Zap,
  Shield,
  Percent,
  Calendar,
  Star,
  Users,
  BarChart3,
  PiggyBank,
  Rocket
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Staking product
interface StakingProduct {
  id: string;
  coin: string;
  symbol: string;
  apy: number;
  lockPeriod: number;
  minAmount: number;
  maxAmount: number;
  totalStaked: number;
  rewards: number;
  icon: string;
}

// Launchpad project
interface LaunchpadProject {
  id: string;
  name: string;
  symbol: string;
  description: string;
  price: number;
  hardCap: number;
  raiseAmount: number;
  startDate: string;
  endDate: string;
  participants: number;
  status: 'upcoming' | 'active' | 'completed';
  icon: string;
}

// Earn product
interface EarnProduct {
  id: string;
  name: string;
  type: 'fixed' | 'flexible' | 'activity';
  coin: string;
  apy: number;
  duration: number;
  minAmount: number;
  icon: string;
}

const stakingProducts: StakingProduct[] = [
  { id: '1', coin: 'TGR', symbol: 'TGR', apy: 25.5, lockPeriod: 30, minAmount: 100, maxAmount: 100000, totalStaked: 2500000, rewards: 156000, icon: '🐯' },
  { id: '2', coin: 'BTC', symbol: 'BTC', apy: 4.2, lockPeriod: 60, minAmount: 0.001, maxAmount: 100, totalStaked: 15000, rewards: 45000, icon: '₿' },
  { id: '3', coin: 'ETH', symbol: 'ETH', apy: 6.8, lockPeriod: 30, minAmount: 0.01, maxAmount: 1000, totalStaked: 85000, rewards: 285000, icon: 'Ξ' },
  { id: '4', coin: 'BNB', symbol: 'BNB', apy: 8.5, lockPeriod: 15, minAmount: 0.1, maxAmount: 500, totalStaked: 125000, rewards: 52000, icon: '⬡' },
  { id: '5', coin: 'SOL', symbol: 'SOL', apy: 12.3, lockPeriod: 7, minAmount: 1, maxAmount: 10000, totalStaked: 450000, rewards: 85000, icon: '◎' },
];

const launchpadProjects: LaunchpadProject[] = [
  { 
    id: '1', 
    name: 'TigerLaunch', 
    symbol: 'TGR2', 
    description: 'Next generation DeFi protocol with AI-powered analytics',
    price: 0.05, 
    hardCap: 500000, 
    raiseAmount: 250000,
    startDate: '2026-08-01', 
    endDate: '2026-08-07', 
    participants: 12500,
    status: 'upcoming',
    icon: '🚀'
  },
  { 
    id: '2', 
    name: 'ChainVerse', 
    symbol: 'CVT', 
    description: 'Cross-chain NFT marketplace with social features',
    price: 0.12, 
    hardCap: 300000, 
    raiseAmount: 300000,
    startDate: '2026-07-10', 
    endDate: '2026-07-17', 
    participants: 28500,
    status: 'active',
    icon: '⛓️'
  },
];

const earnProducts: EarnProduct[] = [
  { id: '1', name: 'Fixed Savings', type: 'fixed', coin: 'USDT', apy: 18.5, duration: 90, minAmount: 100, icon: '$' },
  { id: '2', name: 'Flexible Savings', type: 'flexible', coin: 'USDT', apy: 8.2, duration: 0, minAmount: 10, icon: '$' },
  { id: '3', name: 'Dual Staking', type: 'activity', coin: 'ETH', apy: 25.0, duration: 14, minAmount: 0.1, icon: 'Ξ' },
  { id: '4', name: 'Lock Staking', type: 'fixed', coin: 'BNB', apy: 15.2, duration: 60, minAmount: 1, icon: '⬡' },
  { id: '5', name: 'Launchpool', type: 'activity', coin: 'TGR', apy: 35.0, duration: 30, minAmount: 100, icon: '🐯' },
];

export default function EarnPage() {
  const [activeTab, setActiveTab] = useState<'staking' | 'launchpad' | 'earn'>('staking');
  const [selectedStake, setSelectedStake] = useState<StakingProduct | null>(null);

  // Format number
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">T</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx</span>
              </Link>
              <nav className="hidden md:flex items-center space-x-4 ml-8">
                <Link href="/markets" className="text-gray-600 dark:text-gray-300 hover:text-orange-500">Markets</Link>
                <Link href="/spot" className="text-gray-600 dark:text-gray-300 hover:text-orange-500">Spot</Link>
                <Link href="/futures" className="text-gray-600 dark:text-gray-300 hover:text-orange-500">Futures</Link>
                <Link href="/p2p" className="text-gray-600 dark:text-gray-300 hover:text-orange-500">P2P</Link>
                <span className="text-orange-500 font-medium">Earn</span>
              </nav>
            </div>
            <div className="flex items-center space-x-3">
              <Link href="/wallet" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <Wallet className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Banner */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Earn Crypto Rewards</h1>
              <p className="text-white/90 mb-4">Stake, save, and earn up to 35% APY on your crypto assets</p>
              <div className="flex items-center space-x-6">
                <div className="flex items-center">
                  <Shield className="w-5 h-5 mr-2" />
                  <span>Secure Staking</span>
                </div>
                <div className="flex items-center">
                  <Zap className="w-5 h-5 mr-2" />
                  <span>Instant Rewards</span>
                </div>
                <div className="flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  <span>500K+ Users</span>
                </div>
              </div>
            </div>
            <Rocket className="w-32 h-32 text-white/30" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-4 mb-8">
          {[
            { key: 'staking', label: 'Staking', icon: Lock },
            { key: 'launchpad', label: 'Launchpad', icon: Rocket },
            { key: 'earn', label: 'Earn', icon: PiggyBank },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${
                activeTab === tab.key 
                  ? 'bg-orange-500 text-white' 
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <tab.icon className="w-5 h-5 mr-2" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Staking Tab */}
        {activeTab === 'staking' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Staking Products</h2>
              <div className="flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-gray-500" />
                <span className="text-sm text-gray-500">Total Staked: $125M+</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {stakingProducts.map(product => (
                <div 
                  key={product.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 hover:border-orange-500 transition-all cursor-pointer"
                  onClick={() => setSelectedStake(product)}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <span className="text-3xl">{product.icon}</span>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">{product.coin}</h3>
                        <p className="text-sm text-gray-500">Stake & Earn</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-500">{product.apy}%</p>
                      <p className="text-xs text-gray-500">APY</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Lock Period</span>
                      <span className="text-gray-900 dark:text-white font-medium">{product.lockPeriod} days</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Min Amount</span>
                      <span className="text-gray-900 dark:text-white font-medium">{product.minAmount} {product.symbol}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total Staked</span>
                      <span className="text-gray-900 dark:text-white font-medium">{formatNumber(product.totalStaked)} {product.symbol}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Est. Rewards</span>
                      <span className="text-green-500 font-medium">{formatNumber(product.rewards)} {product.symbol}</span>
                    </div>
                  </div>

                  <button className="w-full mt-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium rounded-lg hover:from-orange-600 hover:to-red-600 transition-all">
                    Stake Now
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Launchpad Tab */}
        {activeTab === 'launchpad' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Launchpad Projects</h2>
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-gray-500" />
                <span className="text-sm text-gray-500">250K+ Participants</span>
              </div>
            </div>

            <div className="space-y-4">
              {launchpadProjects.map(project => (
                <div 
                  key={project.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4">
                      <span className="text-4xl">{project.icon}</span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{project.name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            project.status === 'upcoming' ? 'bg-blue-100 text-blue-600' :
                            project.status === 'active' ? 'bg-green-100 text-green-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                          </span>
                        </div>
                        <p className="text-gray-500 mt-1">{project.description}</p>
                        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                          <span>Price: ${project.price}</span>
                          <span>Hard Cap: ${formatNumber(project.hardCap)}</span>
                          <span>Participants: {formatNumber(project.participants)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-sm text-gray-500 mb-1">Progress</p>
                      <div className="w-32">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-orange-500 to-red-500"
                            style={{ width: `${(project.raiseAmount / project.hardCap) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {Math.round((project.raiseAmount / project.hardCap) * 100)}% sold
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 mr-1" />
                        {project.startDate} - {project.endDate}
                      </div>
                    </div>
                    <button className="flex items-center px-4 py-2 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600">
                      {project.status === 'upcoming' ? 'Subscribe' : 'View'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Earn Tab */}
        {activeTab === 'earn' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Earn Products</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {earnProducts.map(product => (
                <div 
                  key={product.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <span className="text-3xl">{product.icon}</span>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">{product.name}</h3>
                        <p className="text-sm text-gray-500">{product.coin}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      product.type === 'fixed' ? 'bg-blue-100 text-blue-600' :
                      product.type === 'flexible' ? 'bg-green-100 text-green-600' :
                      'bg-purple-100 text-purple-600'
                    }`}>
                      {product.type.charAt(0).toUpperCase() + product.type.slice(1)}
                    </span>
                  </div>

                  <div className="text-center py-4">
                    <p className="text-3xl font-bold text-green-500">{product.apy}%</p>
                    <p className="text-sm text-gray-500">APY</p>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Duration</span>
                      <span className="text-gray-900 dark:text-white">
                        {product.duration > 0 ? `${product.duration} days` : 'Flexible'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Min Amount</span>
                      <span className="text-gray-900 dark:text-white">{product.minAmount} {product.coin}</span>
                    </div>
                  </div>

                  <button className="w-full mt-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium rounded-lg hover:from-orange-600 hover:to-red-600 transition-all">
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Users', value: '500K+', icon: Users },
            { label: 'Total Staked', value: '$125M+', icon: Lock },
            { label: 'Avg. APY', value: '18.5%', icon: Percent },
            { label: 'Countries', value: '150+', icon: Globe },
          ].map((stat, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <stat.icon className="w-8 h-8 mx-auto mb-2 text-orange-500" />
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function Globe({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
