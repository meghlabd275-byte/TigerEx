'use client';

import { useState } from 'react';

export default function InstitutionPage() {
  const [formData, setFormData] = useState({
    companyName: '',
    email: '',
    phone: '',
    inquiryType: ' custody',
    message: '',
  });

  const submitInquiry = async () => {
    alert('Thank you for your inquiry. Our team will contact you shortly.');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-2">Institutional Services</h1>
        <p className="text-gray-600 mb-8">Tailored solutions for institutions, hedge funds, and family offices</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-blue-600 mb-2">$5B+</div>
            <div className="text-gray-600">Assets Under Custody</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-blue-600 mb-2">150+</div>
            <div className="text-gray-600">Institutional Clients</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-blue-600 mb-2">99.99%</div>
            <div className="text-gray-600">Uptime SLA</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Custody Solutions</h2>
            <ul className="space-y-2 text-gray-600">
              <li>✓ Multi-signature cold storage</li>
              <li>✓ SOC 2 Type II certified</li>
              <li>✓ Insurance coverage up to $500M</li>
              <li>✓ 24/7 segregated wallet access</li>
            </ul>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Prime Brokerage</h2>
            <ul className="space-y-2 text-gray-600">
              <li>✓ Deep liquidity pools</li>
              <li>✓ Custom fee structures</li>
              <li>✓ Dedicated account manager</li>
              <li>✓ API access for algo trading</li>
            </ul>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">OTC Desk</h2>
            <ul className="space-y-2 text-gray-600">
              <li>✓ Large block trades</li>
              <li>✓ Competitive spreads</li>
              <li>✓ Multiple settlement options</li>
              <li>✓ Staking and lending services</li>
            </ul>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">API & FIX</h2>
            <ul className="space-y-2 text-gray-600">
              <li>✓ FIX 4.4/5.0 connectivity</li>
              <li>✓ REST and WebSocket APIs</li>
              <li>✓ Custom integration support</li>
              <li>✓ Low latency execution</li>
            </ul>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Request Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Company Name</label>
              <input 
                type="text" 
                className="w-full px-3 py-2 border rounded-lg"
                value={formData.companyName}
                onChange={(e) => setFormData({...formData, companyName: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input 
                type="email" 
                className="w-full px-3 py-2 border rounded-lg"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input 
                type="tel" 
                className="w-full px-3 py-2 border rounded-lg"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Inquiry Type</label>
              <select 
                className="w-full px-3 py-2 border rounded-lg"
                value={formData.inquiryType}
                onChange={(e) => setFormData({...formData, inquiryType: e.target.value})}
              >
                <option value="custody">Custody Solutions</option>
                <option value="prime">Prime Brokerage</option>
                <option value="otc">OTC Desk</option>
                <option value="api">API & FIX</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea 
                className="w-full px-3 py-2 border rounded-lg" 
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({...formData, message: e.target.value})}
              ></textarea>
            </div>
          </div>
          <button 
            onClick={submitInquiry}
            className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Submit Inquiry
          </button>
        </div>
      </div>
    </div>
  );
}
