'use client';

import { useState } from 'react';

interface Derivative {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  nextFunding: string;
}

export default function FuturesDerivativesPage() {
  const [selectedType, setSelectedType] = useState('perpetual');
  const [derivatives, setDerivatives] = useState<Derivative[]>([
    { symbol: 'BTC-USDT-PERP', price: 43250.00, change24h: 2.5, volume24h: 125000000, openInterest: 450000000, fundingRate: 0.01, nextFunding: '4h 30m' },
    { symbol: 'ETH-USDT-PERP', price: 2280.00, change24h: 1.8, volume24h: 85000000, openInterest: 280000000, fundingRate: 0.01, nextFunding: '4h 30m' },
    { symbol: 'SOL-USDT-PERP', price: 98.50, change24h: -1.2, volume24h: 45000000, openInterest: 120000000, fundingRate: -0.01, nextFunding: '4h 30m' },
  ]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Futures Derivatives</h1>
        
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setSelectedType('perpetual')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'perpetual' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Perpetual
          </button>
          <button
            onClick={() => setSelectedType('delivery')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'delivery' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Delivery
          </button>
          <button
            onClick={() => setSelectedType('quarterly')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'quarterly' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Quarterly
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Price</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">24h Change</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">24h Volume</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Open Interest</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Funding Rate</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Next Funding</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-300 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {derivatives.map((d) => (
                <tr key={d.symbol} className="hover:bg-gray-750">
                  <td className="px-6 py-4 font-medium">{d.symbol}</td>
                  <td className="px-6 py-4 text-right">${d.price.toLocaleString()}</td>
                  <td className={`px-6 py-4 text-right ${d.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {d.change24h >= 0 ? '+' : ''}{d.change24h}%
                  </td>
                  <td className="px-6 py-4 text-right">${(d.volume24h / 1000000).toFixed(1)}M</td>
                  <td className="px-6 py-4 text-right">${(d.openInterest / 1000000).toFixed(0)}M</td>
                  <td className={`px-6 py-4 text-right ${d.fundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {d.fundingRate}%
                  </td>
                  <td className="px-6 py-4 text-right">{d.nextFunding}</td>
                  <td className="px-6 py-4 text-center">
                    <button className="px-4 py-1 bg-blue-600 rounded hover:bg-blue-700">
                      Trade
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
