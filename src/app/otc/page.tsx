'use client';

import { useState } from 'react';

interface OTCOffer {
  id: string;
  type: 'buy' | 'sell';
  asset: string;
  fiat: string;
  price: number;
  limit: string;
  paymentMethods: string[];
  trader: string;
  trades: number;
  completion: number;
}

export default function OTCPage() {
  const [offers, setOffers] = useState<OTCOffer[]>([
    { id: '1', type: 'buy', asset: 'USDT', fiat: 'USD', price: 1.002, limit: '$1,000-$50,000', paymentMethods: ['Bank Transfer'], trader: 'TraderJohn', trades: 450, completion: 98 },
    { id: '2', type: 'sell', asset: 'BTC', fiat: 'USD', price: 43200, limit: '$100-$10,000', paymentMethods: ['PayPal', 'Bank Transfer'], trader: 'CryptoPro', trades: 1200, completion: 99 },
    { id: '3', type: 'buy', asset: 'ETH', fiat: 'USD', price: 2285, limit: '$500-$25,000', paymentMethods: ['Bank Transfer'], trader: 'EthTrader', trades: 320, completion: 95 },
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">OTC Trading</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total OTC Volume (24h)</div>
            <div className="text-2xl font-bold">$12.5M</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Active Traders</div>
            <div className="text-2xl font-bold">1,245</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Completed Trades</div>
            <div className="text-2xl font-bold">8,920</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Avg. Trade Size</div>
            <div className="text-2xl font-bold">$15,000</div>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <select className="px-4 py-2 border rounded-lg">
            <option value="all">All Assets</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="USDT">USDT</option>
          </select>
          <select className="px-4 py-2 border rounded-lg">
            <option value="all">All Fiat</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>

        <div className="bg-white rounded-lg shadow">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Limit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trader</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Trades</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      offer.type === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {offer.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium">{offer.asset}/{offer.fiat}</td>
                  <td className="px-6 py-4 text-right">${offer.price.toLocaleString()}</td>
                  <td className="px-6 py-4">{offer.limit}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1">
                      {offer.paymentMethods.map((method, i) => (
                        <span key={i} className="px-2 py-1 text-xs bg-gray-100 rounded">{method}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium">{offer.trader}</div>
                    <div className="text-sm text-gray-500">{offer.completion}% completion</div>
                  </td>
                  <td className="px-6 py-4 text-right">{offer.trades}</td>
                  <td className="px-6 py-4 text-right">
                    <button className="px-4 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
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
