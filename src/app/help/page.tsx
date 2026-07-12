'use client';

import React, { useState } from 'react';
import { Search, ChevronDown, ChevronRight, MessageCircle, Mail, Phone, FileText, Book, Shield, Wallet, CreditCard, TrendingUp } from 'lucide-react';

const FAQ_CATEGORIES = [
  { id: 'account', name: 'Account & Security', icon: <Shield className="w-5 h-5" />, count: 12 },
  { id: 'wallet', name: 'Wallet & Deposits', icon: <Wallet className="w-5 h-5" />, count: 8 },
  { id: 'trading', name: 'Trading', icon: <TrendingUp className="w-5 h-5" />, count: 15 },
  { id: 'payment', name: 'Payment & Cards', icon: <CreditCard className="w-5 h-5" />, count: 10 },
  { id: 'fees', name: 'Fees & Limits', icon: <FileText className="w-5 h-5" />, count: 6 },
];

const FAQS = [
  { id: 1, category: 'account', question: 'How do I enable 2FA?', answer: 'Go to Settings > Security > Two-Factor Authentication and follow the setup instructions.' },
  { id: 2, category: 'account', question: 'How do I reset my password?', answer: 'Click "Forgot Password" on the login page and follow the email instructions.' },
  { id: 3, category: 'wallet', question: 'How do I deposit crypto?', answer: 'Go to Wallet > Deposit, select the cryptocurrency and network, then send to the displayed address.' },
  { id: 4, category: 'wallet', question: 'How long do deposits take?', answer: 'Bitcoin: ~1 hour, Ethereum: ~15 minutes, Tokens: ~5-30 minutes depending on network.' },
  { id: 5, category: 'trading', question: 'What are the trading fees?', answer: 'Spot trading: 0.1% maker/taker. Futures: 0.02% maker, 0.04% taker.' },
  { id: 6, category: 'trading', question: 'How do I set up stop-loss?', answer: 'When placing an order, select "Stop-Limit" type and set your stop price and limit price.' },
  { id: 7, category: 'payment', question: 'How do I buy crypto with card?', answer: 'Go to Buy Crypto, select card payment, choose the cryptocurrency and amount.' },
  { id: 8, category: 'fees', question: 'What are withdrawal fees?', answer: 'Withdrawal fees vary by network. BTC: 0.0005 BTC, ETH: 0.005 ETH, USDT: 1 USDT.' },
];

export default function HelpCenter() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  const filteredFAQs = FAQS.filter(faq => {
    const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;
    const matchesSearch = search === '' || 
      faq.question.toLowerCase().includes(search.toLowerCase()) || 
      faq.answer.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">Help Center</h1>
          <p className="text-gray-400">Find answers to your questions</p>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} 
            placeholder="Search for help..."
            className="w-full bg-[#14141A] rounded-xl py-4 pl-12 pr-4 text-lg focus:outline-none focus:border-[#FF6B35]" />
        </div>

        {/* Quick Contact */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <button className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
            <MessageCircle className="w-6 h-6 text-[#FF6B35] mx-auto mb-2" />
            <p className="text-sm font-medium">Live Chat</p>
            <p className="text-xs text-gray-500">24/7 Support</p>
          </button>
          <button className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
            <Mail className="w-6 h-6 text-[#FF6B35] mx-auto mb-2" />
            <p className="text-sm font-medium">Email</p>
            <p className="text-xs text-gray-500">24h response</p>
          </button>
          <button className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
            <Phone className="w-6 h-6 text-[#FF6B35] mx-auto mb-2" />
            <p className="text-sm font-medium">Phone</p>
            <p className="text-xs text-gray-500">VIP only</p>
          </button>
        </div>

        {/* Categories */}
        <div className="grid grid-cols-5 gap-3 mb-8">
          {FAQ_CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
              className={`p-4 rounded-xl text-center transition ${selectedCategory === cat.id ? 'bg-[#FF6B35]' : 'bg-[#14141A] hover:bg-[#1E1E24]'}`}>
              <div className="mx-auto mb-2">{cat.icon}</div>
              <p className="text-xs font-medium">{cat.name}</p>
              <p className="text-xs text-gray-500">{cat.count} articles</p>
            </button>
          ))}
        </div>

        {/* FAQs */}
        <div className="space-y-2">
          {filteredFAQs.map(faq => (
            <div key={faq.id} className="bg-[#14141A] rounded-xl overflow-hidden">
              <button onClick={() => setExpandedFAQ(expandedFAQ === faq.id ? null : faq.id)}
                className="w-full p-4 flex items-center justify-between text-left">
                <span className="font-medium">{faq.question}</span>
                {expandedFAQ === faq.id ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
              {expandedFAQ === faq.id && (
                <div className="p-4 pt-0 text-gray-400 text-sm">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredFAQs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No results found</p>
            <p className="text-sm">Try different keywords</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 bg-[#14141A] rounded-xl p-6 text-center">
          <p className="font-medium mb-2">Still need help?</p>
          <p className="text-sm text-gray-400 mb-4">Our support team is available 24/7</p>
          <button className="px-6 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg">
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );
}
