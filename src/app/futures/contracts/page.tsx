'use client';

import { useState } from 'react';

interface Contract {
  symbol: string;
  type: 'USDT-M' | 'USDC-M' | 'COIN-M';
  size: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;
  maxQty: number;
  leverage: string;
}

export default function FuturesContractsPage() {
  const [selectedType, setSelectedType] = useState('all');
  const [contracts, setContracts] = useState<Contract[]>([
    { symbol: 'BTCUSDT', type: 'USDT-M', size: '0.001BTC', pricePrecision: 2, quantityPrecision: 3, minQty: 0.001, maxQty: 100, leverage: '1-125x' },
    { symbol: 'ETHUSDT', type: 'USDT-M', size: '0.01ETH', pricePrecision: 2, quantityPrecision: 3, minQty: 0.01, maxQty: 1000, leverage: '1-100x' },
    { symbol: 'BNBUSDT', type: 'USDT-M', size: '0.01BNB', pricePrecision: 2, quantityPrecision: 2, minQty: 0.01, maxQty: 10000, leverage: '1-75x' },
  ]);

  const filteredContracts = selectedType === 'all' 
    ? contracts 
    : contracts.filter(c => c.type === selectedType);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Futures Contract Specifications</h1>
        
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'all' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            All Contracts
          </button>
          <button
            onClick={() => setSelectedType('USDT-M')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'USDT-M' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            USDT-M
          </button>
          <button
            onClick={() => setSelectedType('USDC-M')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'USDC-M' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            USDC-M
          </button>
          <button
            onClick={() => setSelectedType('COIN-M')}
            className={`px-4 py-2 rounded-lg ${selectedType === 'COIN-M' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            COIN-M
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Contract Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Price Precision</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Quantity Precision</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Min Qty</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Max Qty</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Leverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredContracts.map((c) => (
                <tr key={c.symbol} className="hover:bg-gray-750">
                  <td className="px-6 py-4 font-medium">{c.symbol}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${c.type === 'USDT-M' ? 'bg-green-900 text-green-300' : c.type === 'USDC-M' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'}`}>
                      {c.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">{c.size}</td>
                  <td className="px-6 py-4 text-right">{c.pricePrecision}</td>
                  <td className="px-6 py-4 text-right">{c.quantityPrecision}</td>
                  <td className="px-6 py-4 text-right">{c.minQty}</td>
                  <td className="px-6 py-4 text-right">{c.maxQty.toLocaleString()}</td>
                  <td className="px-6 py-4">{c.leverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
