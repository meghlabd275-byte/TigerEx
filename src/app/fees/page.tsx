'use client';

import React, { useState } from 'react';
import { Percent, Info, TrendingUp, Download } from 'lucide-react';

const TRADING_FEES = [
  { volume: '$0 - $10,000', maker: '0.10%', taker: '0.10%' },
  { volume: '$10,001 - $50,000', maker: '0.09%', taker: '0.10%' },
  { volume: '$50,001 - $200,000', maker: '0.08%', taker: '0.09%' },
  { volume: '$200,001 - $1,000,000', maker: '0.06%', taker: '0.08%' },
  { volume: '$1,000,001 - $5,000,000', maker: '0.04%', taker: '0.06%' },
  { volume: '$5,000,001 - $25,000,000', maker: '0.02%', taker: '0.04%' },
  { volume: '> $25,000,000', maker: '0.00%', taker: '0.02%' },
];

const WITHDRAWAL_FEES = [
  { crypto: 'BTC', network: 'Bitcoin', fee: '0.0005 BTC', min: '0.001 BTC' },
  { crypto: 'ETH', network: 'Ethereum', fee: '0.005 ETH', min: '0.01 ETH' },
  { crypto: 'USDT', network: 'TRC20', fee: '1 USDT', min: '10 USDT' },
  { crypto: 'USDT', network: 'ERC20', fee: '5 USDT', min: '20 USDT' },
  { crypto: 'BNB', network: 'BEP20', fee: '0.001 BNB', min: '0.01 BNB' },
  { crypto: 'SOL', network: 'Solana', fee: '0.01 SOL', min: '0.1 SOL' },
];

const DEPOSIT_INFO = [
  { method: 'Crypto Deposit', fee: 'Free', time: 'Network dependent' },
  { method: 'Bank Transfer (SWIFT)', fee: '$15', time: '2-5 business days' },
  { method: 'Bank Transfer (SEPA)', fee: '€1', time: '1-2 business days' },
  { method: 'Credit/Debit Card', fee: '2.5%', time: 'Instant' },
];

export default function FeesPage() {
  const [activeTab, setActiveTab] = useState('trading');

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Fees</h1>
            <p className="text-gray-400">Transparent fee structure</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#14141A] rounded-lg hover:bg-[#1E1E24]">
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {['trading', 'withdrawal', 'deposit'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm capitalize ${activeTab === tab ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'trading' && (
          <>
            {/* Trading Fees */}
            <div className="bg-[#14141A] rounded-xl p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Percent className="w-5 h-5 text-[#FF6B35]" /> Spot Trading Fees
              </h2>
              <p className="text-sm text-gray-400 mb-4">Fees are calculated based on your 30-day trading volume</p>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[rgba(255,255,255,0.1)]">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">30-Day Volume</th>
                      <th className="text-center py-3 px-4 text-gray-400 font-medium">Maker Fee</th>
                      <th className="text-center py-3 px-4 text-gray-400 font-medium">Taker Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TRADING_FEES.map((row, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                        <td className="py-3 px-4">{row.volume}</td>
                        <td className="py-3 px-4 text-center text-green-500">{row.maker}</td>
                        <td className="py-3 px-4 text-center text-green-500">{row.taker}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Futures Fees */}
            <div className="bg-[#14141A] rounded-xl p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Futures Trading Fees</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
                  <p className="text-gray-400 text-sm mb-1">Maker</p>
                  <p className="text-xl font-bold text-green-500">0.02%</p>
                </div>
                <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
                  <p className="text-gray-400 text-sm mb-1">Taker</p>
                  <p className="text-xl font-bold text-green-500">0.04%</p>
                </div>
                <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
                  <p className="text-gray-400 text-sm mb-1">Funding Rate</p>
                  <p className="text-xl font-bold">0.01%</p>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'withdrawal' && (
          <div className="bg-[#14141A] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Withdrawal Fees</h2>
            <p className="text-sm text-gray-400 mb-4">Network fees may change due to network conditions</p>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.1)]">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Cryptocurrency</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Network</th>
                    <th className="text-center py-3 px-4 text-gray-400 font-medium">Fee</th>
                    <th className="text-center py-3 px-4 text-gray-400 font-medium">Min Withdrawal</th>
                  </tr>
                </thead>
                <tbody>
                  {WITHDRAWAL_FEES.map((row, i) => (
                    <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                      <td className="py-3 px-4 font-medium">{row.crypto}</td>
                      <td className="py-3 px-4 text-gray-400">{row.network}</td>
                      <td className="py-3 px-4 text-center">{row.fee}</td>
                      <td className="py-3 px-4 text-center">{row.min}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'deposit' && (
          <div className="bg-[#14141A] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Deposit Methods</h2>
            
            <div className="space-y-3">
              {DEPOSIT_INFO.map((info, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg">
                  <div>
                    <p className="font-medium">{info.method}</p>
                    <p className="text-xs text-gray-500">{info.time}</p>
                  </div>
                  <p className="font-bold text-green-500">{info.fee}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-500">Fee Update Schedule</p>
            <p className="text-xs text-gray-400 mt-1">Trading fees are recalculated every hour based on your 30-day volume. Withdrawal fees may vary based on network conditions.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
