'use client';

import { useState } from 'react';

interface APIKey {
  id: string;
  name: string;
  user: string;
  key: string;
  permissions: string[];
  rateLimit: number;
  createdAt: string;
  lastUsed: string;
  status: 'active' | 'revoked';
}

export default function AdminAPIPage() {
  const [apiKeys, setAPIKeys] = useState<APIKey[]>([
    { id: '1', name: 'Trading Bot', user: 'trader@example.com', key: 'tk_abc123...xyz', permissions: ['trade', 'read'], rateLimit: 1000, createdAt: '2024-01-10', lastUsed: '2024-01-15', status: 'active' },
    { id: '2', name: 'Analytics App', user: 'analyst@example.com', key: 'tk_def456...uvw', permissions: ['read'], rateLimit: 500, createdAt: '2024-01-08', lastUsed: '2024-01-14', status: 'active' },
    { id: '3', name: 'Old Script', user: 'olduser@example.com', key: 'tk_ghi789...rst', permissions: ['read'], rateLimit: 100, createdAt: '2023-12-01', lastUsed: '2024-01-01', status: 'revoked' },
  ]);

  const revokeKey = (keyId: string) => {
    if (confirm('Are you sure you want to revoke this API key?')) {
      setAPIKeys(prev => prev.map(k => k.id === keyId ? {...k, status: 'revoked'} : k));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">API Key Management</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total API Keys</div>
            <div className="text-2xl font-bold">{apiKeys.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Active Keys</div>
            <div className="text-2xl font-bold text-green-600">{apiKeys.filter(k => k.status === 'active').length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">API Requests (24h)</div>
            <div className="text-2xl font-bold">2.4M</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">API Keys</h2>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Create New Key
            </button>
          </div>
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Permissions</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate Limit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Used</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {apiKeys.map((key) => (
                <tr key={key.id}>
                  <td className="px-6 py-4 font-medium">{key.name}</td>
                  <td className="px-6 py-4 text-sm">{key.user}</td>
                  <td className="px-6 py-4 font-mono text-sm">{key.key}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1">
                      {key.permissions.map((perm, i) => (
                        <span key={i} className="px-2 py-1 text-xs bg-gray-100 rounded">{perm}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">{key.rateLimit}/min</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{key.createdAt}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{key.lastUsed}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      key.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {key.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {key.status === 'active' && (
                      <button
                        onClick={() => revokeKey(key.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Revoke
                      </button>
                    )}
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
