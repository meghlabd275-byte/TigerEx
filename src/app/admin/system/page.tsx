'use client';

import { useState } from 'react';

interface Service {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
  latency: string;
  requests: string;
}

export default function AdminSystemPage() {
  const [services, setServices] = useState<Service[]>([
    { name: 'API Gateway', status: 'healthy', uptime: '99.99%', latency: '12ms', requests: '2.4M/min' },
    { name: 'Trading Engine', status: 'healthy', uptime: '99.99%', latency: '2ms', requests: '850K/min' },
    { name: 'Order Matching', status: 'healthy', uptime: '99.99%', latency: '1ms', requests: '1.2M/min' },
    { name: 'Wallet Service', status: 'healthy', uptime: '99.95%', latency: '8ms', requests: '450K/min' },
    { name: 'Database', status: 'healthy', uptime: '99.99%', latency: '5ms', requests: '1.8M/min' },
    { name: 'Redis Cache', status: 'healthy', uptime: '99.99%', latency: '1ms', requests: '5.2M/min' },
    { name: 'WebSocket', status: 'degraded', uptime: '99.50%', latency: '25ms', requests: '890K/min' },
    { name: 'KYC Service', status: 'healthy', uptime: '99.90%', latency: '150ms', requests: '12K/min' },
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">System Status</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Services</div>
            <div className="text-2xl font-bold">{services.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Healthy</div>
            <div className="text-2xl font-bold text-green-600">{services.filter(s => s.status === 'healthy').length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Degraded</div>
            <div className="text-2xl font-bold text-yellow-600">{services.filter(s => s.status === 'degraded').length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Down</div>
            <div className="text-2xl font-bold text-red-600">{services.filter(s => s.status === 'down').length}</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Uptime</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Latency</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Requests</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {services.map((service) => (
                <tr key={service.name}>
                  <td className="px-6 py-4 font-medium">{service.name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      service.status === 'healthy' ? 'bg-green-100 text-green-800' :
                      service.status === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {service.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">{service.uptime}</td>
                  <td className="px-6 py-4 text-right">{service.latency}</td>
                  <td className="px-6 py-4 text-right">{service.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">System Resources</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>CPU Usage</span>
                <span>45%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '45%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Memory Usage</span>
                <span>68%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '68%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Disk Usage</span>
                <span>32%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-yellow-600 h-2 rounded-full" style={{ width: '32%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
