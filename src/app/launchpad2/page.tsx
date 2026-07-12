'use client';

import React, { useState } from 'react';
import { Rocket, Clock, ChevronRight, Users, TrendingUp, Shield, Lock, Check, ExternalLink } from 'lucide-react';

const LAUNCHPAD_PROJECTS = [
  { id: 1, name: 'TigerChain', symbol: 'TIGER', price: '$0.025', allocation: '500-5000', hardCap: '$2M', participants: 12500, status: 'live', description: 'Next-gen blockchain for gaming', website: 'tigerchain.io' },
  { id: 2, name: 'DeFiUniverse', symbol: 'DEFU', price: '$0.15', allocation: '100-2000', hardCap: '$5M', participants: 8900, status: 'upcoming', description: 'Cross-chain DeFi aggregation', website: 'defiuniverse.com' },
  { id: 3, name: 'NFTWorlds', symbol: 'NFTW', price: '$0.08', allocation: '200-3000', hardCap: '$3M', participants: 15600, status: 'ended', description: 'Metaverse NFT marketplace', website: 'nftworlds.io' },
];

const MY_SUBSCRIPTIONS = [
  { id: 1, name: 'TigerChain', symbol: 'TIGER', amount: '2500', allocation: '5000', status: 'Claimed' },
];

export default function Launchpad() {
  const [selectedTab, setSelectedTab] = useState('all');

  const filteredProjects = selectedTab === 'all' ? LAUNCHPAD_PROJECTS : LAUNCHPAD_PROJECTS.filter(p => p.status === selectedTab);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Launchpad</h1>
        <p className="text-gray-400 mb-6">Discover and participate in new token sales</p>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Raised</p>
            <p className="text-xl font-bold">$45.6M</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Participants</p>
            <p className="text-xl font-bold">125K</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Projects</p>
            <p className="text-xl font-bold">24</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg. ROI</p>
            <p className="text-xl font-bold text-green-500">+180%</p>
          </div>
        </div>

        {/* My Subscriptions */}
        {MY_SUBSCRIPTIONS.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">My Subscriptions</h2>
            <div className="grid gap-3">
              {MY_SUBSCRIPTIONS.map(sub => (
                <div key={sub.id} className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                      <Rocket className="w-5 h-5 text-[#FF6B35]" />
                    </div>
                    <div>
                      <p className="font-medium">{sub.name}</p>
                      <p className="text-xs text-gray-500">{sub.symbol}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div><p className="text-xs text-gray-500">Committed</p><p className="font-medium">${sub.amount}</p></div>
                    <div><p className="text-xs text-gray-500">Allocation</p><p className="font-medium">${sub.allocation}</p></div>
                    <div><p className="text-xs text-gray-500">Status</p><p className="font-medium text-green-500">{sub.status}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'All' },
            { id: 'live', label: 'Live' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'ended', label: 'Ended' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setSelectedTab(tab.id)} className={`px-4 py-2 rounded-lg text-sm ${selectedTab === tab.id ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Projects */}
        <div className="grid gap-4">
          {filteredProjects.map(project => (
            <div key={project.id} className="bg-[#14141A] rounded-xl p-5 hover:bg-[#1E1E24] transition">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-[#FF6B35] to-[#ff8f65] rounded-xl flex items-center justify-center text-2xl font-bold">
                    {project.symbol.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-bold">{project.name}</p>
                      <span className={`px-2 py-0.5 rounded text-xs ${project.status === 'live' ? 'bg-green-500/20 text-green-500' : project.status === 'upcoming' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-gray-500/20 text-gray-500'}`}>
                        {project.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{project.description}</p>
                  </div>
                </div>
                {project.status === 'live' && (
                  <button className="px-6 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium">
                    Subscribe Now
                  </button>
                )}
                {project.status === 'upcoming' && (
                  <button className="px-6 py-2 bg-[#14141A] border border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10 rounded-lg font-medium">
                    Notify Me
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-5 gap-4 pt-4 border-t border-[rgba(255,255,255,0.1)]">
                <div>
                  <p className="text-xs text-gray-500">Price</p>
                  <p className="font-medium">{project.price}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Allocation</p>
                  <p className="font-medium">{project.allocation}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Hard Cap</p>
                  <p className="font-medium">{project.hardCap}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Participants</p>
                  <p className="font-medium">{project.participants.toLocaleString()}</p>
                </div>
                <div>
                  <a href={`https://${project.website}`} target="_blank" className="flex items-center gap-1 text-[#FF6B35] text-sm hover:underline">
                    Website <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Protection */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Launchpad Protection</p>
            <p className="text-xs text-gray-500 mt-1">All projects are vetted. Funds are held in escrow until project milestones are achieved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
