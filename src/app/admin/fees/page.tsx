'use client';

import { useState } from 'react';

interface FeeTier {
  volume: string;
  makerFee: number;
  takerFee: number;
}

export default function AdminFeesPage() {
  const [feeTiers, setFeeTiers] = useState<FeeTier[]>([
    { volume: '< 10,000', makerFee: 0.1, takerFee: 0.1 },
    { volume: '10,000 - 100,000', makerFee: 0.09, takerFee: 0.1 },
    { volume: '100,000 - 1,000,000', makerFee: 0.08, takerFee: 0.09 },
    { volume: '1,000,000 - 10,000,000', makerFee: 0.06, takerFee: 0.08 },
    { volume: '> 10,000,000', makerFee: 0.04, takerFee: 0.06 },
  ]);

  const [saving, setSaving] = useState(false);

  const saveFees = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Fee Configuration</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Trading Fee Tiers (Spot)</h2>
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500">
                  <th className="pb-2">Volume (30d)</th>
                  <th className="pb-2 text-right">Maker</th>
                  <th className="pb-2 text-right">Taker</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {feeTiers.map((tier, i) => (
                  <tr key={i}>
                    <td className="py-2">{tier.volume}</td>
                    <td className="py-2 text-right">{tier.makerFee}%</td>
                    <td className="py-2 text-right">{tier.takerFee}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Trading Fee Tiers (Futures)</h2>
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500">
                  <th className="pb-2">Volume (30d)</th>
                  <th className="pb-2 text-right">Maker</th>
                  <th className="pb-2 text-right">Taker</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {feeTiers.map((tier, i) => (
                  <tr key={i}>
                    <td className="py-2">{tier.volume}</td>
                    <td className="py-2 text-right">{(tier.makerFee * 0.6).toFixed(3)}%</td>
                    <td className="py-2 text-right">{(tier.takerFee * 0.6).toFixed(3)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Withdrawal Fees</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">BTC Withdrawal Fee</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" defaultValue="0.0005" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ETH Withdrawal Fee</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" defaultValue="0.005" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">USDT Withdrawal Fee</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" defaultValue="1" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Deposit Fees</h2>
          <div className="flex items-center gap-4">
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" defaultChecked />
              Free deposits enabled
            </label>
          </div>
        </div>

        <button
          onClick={saveFees}
          disabled={saving}
          className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>
    </div>
  );
}
