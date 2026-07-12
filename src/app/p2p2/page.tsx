'use client';

import React, { useState } from 'react';
import { Search, Filter, RefreshCw, Star, ChevronDown, User, Shield, Clock, ArrowRight } from 'lucide-react';

const P2P_ADS = [
  { id: 1, user: 'CryptoTrader1', rating: 4.9, orders: 1250, completion: 98%, price: 67.45, limit: '100-5000', payment: 'Bank Transfer', crypto: 'BTC', amount: 'USDT', side: 'buy' },
  { id: 2, user: 'FastTradePro', rating: 4.8, orders: 890, completion: 96%, price: 67.52, limit: '50-2000', payment: 'PayPal', crypto: 'BTC', amount: 'USDT', side: 'sell' },
  { id: 3, user: 'SecureCoins', rating: 5.0, orders: 2100, completion: 100%, price: 67.38, limit: '200-10000', payment: 'Wise', crypto: 'BTC', amount: 'USDT', side: 'buy' },
  { id: 4, user: 'P2PMaster', rating: 4.7, orders: 650, completion: 94%, price: 67.55, limit: '100-3000', payment: ' Revolut', crypto: 'BTC', amount: 'USDT', side: 'sell' },
  { id: 5, user: 'TraderJoe', rating: 4.9, orders: 1800, completion: 99%, price: 67.42, limit: '50-5000', payment: 'Bank Transfer', crypto: 'ETH', amount: 'USDT', side: 'buy' },
  { id: 6, user: 'CoinDealer', rating: 4.6, orders: 420, completion: 92%, price: 3450, limit: '100-8000', payment: 'PayPal', crypto: 'ETH', amount: 'USDT', side: 'sell' },
];

const PAYMENT_METHODS = ['All', 'Bank Transfer', 'PayPal', 'Wise', 'Revolut', 'Cash'];
const CRYPTOS = ['All', 'BTC', 'ETH', 'USDT', 'BNB', 'SOL'];

export default function P2PTrading() {
  const [selectedCrypto, setSelectedCrypto] = useState('All');
  const [selectedPayment, setSelectedPayment] = useState('All');
  const [buySell, setBuySell] = useState<'buy' | 'sell'>('buy');
  const [fiatAmount, setFiatAmount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAds = P2P_ADS.filter(ad => {
    const matchesCrypto = selectedCrypto === 'All' || ad.crypto === selectedCrypto;
    const matchesPayment = selectedPayment === 'All' || ad.payment === selectedPayment;
    const matchesSide = ad.side === buySell;
    return matchesCrypto && matchesPayment && matchesSide;
  });

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">P2P Trading</h1>
          <p className="text-gray-400">Buy and sell crypto directly with no fees</p>
        </div>

        {/* Buy/Sell Tabs */}
        <div className="flex rounded-lg overflow-hidden mb-4 w-fit">
          <button onClick={() => setBuySell('buy')} className={`px-6 py-2 ${buySell === 'buy' ? 'bg-green-600' : 'bg-[#14141A]'}`}>Buy</button>
          <button onClick={() => setBuySell('sell')} className={`px-6 py-2 ${buySell === 'sell' ? 'bg-red-600' : 'bg-[#14141A]'}`}>Sell</button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex gap-2">
            {CRYPTOS.map(crypto => (
              <button key={crypto} onClick={() => setSelectedCrypto(crypto)} className={`px-4 py-2 rounded-lg text-sm ${selectedCrypto === crypto ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
                {crypto}
              </button>
            ))}
          </div>
          <select className="bg-[#14141A] rounded-lg px-4 py-2 text-sm" value={selectedPayment} onChange={(e) => setSelectedPayment(e.target.value)}>
            {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
        </div>

        {/* Amount Input */}
        <div className="bg-[#14141A] rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-gray-400 text-sm">I want to spend</label>
              <input type="number" value={fiatAmount} onChange={(e) => setFiatAmount(e.target.value)} placeholder="0.00" className="bg-transparent text-2xl font-bold outline-none w-full" />
            </div>
            <ArrowRight className="w-6 h-6 text-gray-500" />
            <div>
              <label className="text-gray-400 text-sm">I will receive</label>
              <p className="text-2xl font-bold text-[#FF6B35]">0.00 USDT</p>
            </div>
          </div>
        </div>

        {/* P2P Ads */}
        <div className="grid gap-3">
          {filteredAds.map(ad => (
            <div key={ad.id} className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between hover:bg-[#1E1E24] transition">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-[#FF6B35]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ad.user}</span>
                    <div className="flex items-center gap-1 text-yellow-500"><Star className="w-3 h-3" /><span className="text-xs">{ad.rating}</span></div>
                  </div>
                  <p className="text-xs text-gray-500">{ad.orders} orders · {ad.completion}% completion</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-lg">{ad.price} {ad.amount}</p>
                <p className="text-xs text-gray-500">{ad.limit} {ad.amount}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{ad.payment}</span>
                <button className={`px-4 py-2 rounded-lg ${ad.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  {ad.side === 'buy' ? 'Buy' : 'Sell'} {ad.crypto}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Protection Notice */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">P2P Trading Protection</p>
            <p className="text-xs text-gray-500 mt-1">All transactions are protected by escrow. Funds are held securely until the trade is completed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
