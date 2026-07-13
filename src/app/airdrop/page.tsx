'use client';

import { useState } from 'react';

interface Airdrop {
  id: string;
  name: string;
  description: string;
  reward: string;
  status: 'active' | 'upcoming' | 'ended';
  participants: number;
  endsAt: string;
}

export default function AirdropPage() {
  const [airdrops, setAirdrops] = useState<Airdrop[]>([
    { id: '1', name: 'TigerEx Token Launch', description: 'Join our token generation event', reward: '500 TGR', status: 'active', participants: 12500, endsAt: 'Feb 28, 2024' },
    { id: '2', name: 'Early Bird Bonus', description: 'First 10,000 users get bonus', reward: '100 TGR', status: 'active', participants: 8500, endsAt: 'Jan 31, 2024' },
    { id: '3', name: 'Referral Program', description: 'Invite friends and earn', reward: '50 TGR per referral', status: 'active', participants: 25000, endsAt: 'Dec 31, 2024' },
    { id: '4', name: 'Community Rewards', description: 'Discord community members', reward: '200 TGR', status: 'upcoming', participants: 0, endsAt: 'Mar 15, 2024' },
  ]);

  const [myAirdrops, setMyAirdrops] = useState([
    { name: 'TigerEx Token Launch', status: 'claimed', amount: '500 TGR' },
    { name: 'Early Bird Bonus', status: 'pending', amount: '100 TGR' },
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Airdrop Center</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Rewards Claimed</div>
            <div className="text-2xl font-bold text-green-600">500 TGR</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Pending Rewards</div>
            <div className="text-2xl font-bold text-yellow-600">100 TGR</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Airdrops Joined</div>
            <div className="text-2xl font-bold">2</div>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Active Airdrops</h2>
          <div className="space-y-4">
            {airdrops.map((airdrop) => (
              <div key={airdrop.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-lg">{airdrop.name}</h3>
                    <p className="text-gray-500 text-sm">{airdrop.description}</p>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    airdrop.status === 'active' ? 'bg-green-100 text-green-800' :
                    airdrop.status === 'upcoming' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {airdrop.status}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-3">
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Reward:</span>
                      <span className="font-semibold ml-1">{airdrop.reward}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Participants:</span>
                      <span className="font-semibold ml-1">{airdrop.participants.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Ends:</span>
                      <span className="font-semibold ml-1">{airdrop.endsAt}</span>
                    </div>
                  </div>
                  {airdrop.status === 'active' && (
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Join
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">My Airdrop History</h2>
          <div className="space-y-3">
            {myAirdrops.map((item, i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-gray-500">{item.amount}</div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  item.status === 'claimed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
